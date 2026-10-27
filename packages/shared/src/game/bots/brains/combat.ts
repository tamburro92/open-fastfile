// Call of Duty MW3 Tactical Combat Bot Brain.
//
// Models authentic Call of Duty bot combat behavior across four difficulty tiers:
// - Recruit (Recluta): Slow reaction, poor accuracy, short bursts, long pauses, mostly walking.
// - Regular (Soldato): Balanced reactions and accuracy, ADS at mid/long range, occasional crouch.
// - Hardened (Esperto): Fast reactions, high accuracy, tactical crouching, agile bursts.
// - Veteran (Veterano): Lightning-fast reflexes, pinpoint accuracy, aggressive fire, tactical stance.
//
// Uses raycast line-of-sight to acquire targets, aims yaw and pitch with recoil compensation,
// handles burst cadence, ADS, tactical crouch and ammo/reloading discipline.

import type { PlayerId } from "../../../net/messages/fields.js";
import type { Vec3 } from "../../../sim/capsule.js";
import { STAND_EYE_HEIGHT } from "../../../sim/movement.js";
import { eyeHeight } from "../../../sim/stance.js";
import { defineBrain, IDLE, type BotSelf, type BrainContext, type Goal } from "../brain.js";

export const COMBAT_BRAIN = "combat";

export type BotDifficulty = "recruit" | "regular" | "hardened" | "veteran";

export interface CombatConfig {
  reactionTime: number;
  aimErrorMin: number;
  aimErrorMax: number;
  burstMinDuration: number;
  burstMaxDuration: number;
  burstPauseMin: number;
  burstPauseMax: number;
  crouchProbability: number;
  adsMinDistance: number;
  runInCombat: boolean;
}

export const COMBAT_DIFFICULTIES: Record<BotDifficulty, CombatConfig> = {
  recruit: {
    reactionTime: 0.55,
    aimErrorMin: 0.6,
    aimErrorMax: 1.1,
    burstMinDuration: 0.2,
    burstMaxDuration: 0.35,
    burstPauseMin: 0.45,
    burstPauseMax: 0.65,
    crouchProbability: 0.05,
    adsMinDistance: 12,
    runInCombat: false,
  },
  regular: {
    reactionTime: 0.30,
    aimErrorMin: 0.25,
    aimErrorMax: 0.45,
    burstMinDuration: 0.3,
    burstMaxDuration: 0.55,
    burstPauseMin: 0.22,
    burstPauseMax: 0.35,
    crouchProbability: 0.25,
    adsMinDistance: 5,
    runInCombat: true,
  },
  hardened: {
    reactionTime: 0.16,
    aimErrorMin: 0.08,
    aimErrorMax: 0.18,
    burstMinDuration: 0.5,
    burstMaxDuration: 0.85,
    burstPauseMin: 0.12,
    burstPauseMax: 0.20,
    crouchProbability: 0.50,
    adsMinDistance: 3,
    runInCombat: true,
  },
  veteran: {
    reactionTime: 0.07,
    aimErrorMin: 0.0,
    aimErrorMax: 0.05,
    burstMinDuration: 0.8,
    burstMaxDuration: 1.5,
    burstPauseMin: 0.05,
    burstPauseMax: 0.10,
    crouchProbability: 0.70,
    adsMinDistance: 2,
    runInCombat: true,
  },
};

export interface CombatMemory {
  difficulty: BotDifficulty;
  config: CombatConfig;
  targetId: PlayerId | null;
  targetVisible: boolean;
  targetSpottedAt: number;
  burstUntil: number;
  pauseUntil: number;
  aimOffset: Vec3;
  crouchActive: boolean;
  rng: () => number;
}

export const combatBrain = defineBrain<CombatMemory>({
  id: COMBAT_BRAIN,
  // 100ms think period for responsive combat AI:
  period: 0.1,
  init: (_self, rng, params) => {
    const rawDiff = String(params.difficulty ?? "regular").toLowerCase();
    const difficulty: BotDifficulty =
      rawDiff === "recruit" || rawDiff === "hardened" || rawDiff === "veteran" ? rawDiff : "regular";
    const config = COMBAT_DIFFICULTIES[difficulty];
    return {
      difficulty,
      config,
      targetId: null,
      targetVisible: false,
      targetSpottedAt: 0,
      burstUntil: 0,
      pauseUntil: 0,
      aimOffset: { x: 0, y: 0, z: 0 },
      crouchActive: false,
      rng,
    };
  },
  think: (ctx, self, memory) => thinkCombat(ctx, self, memory),
});

export function thinkCombat(ctx: BrainContext, self: BotSelf, memory: CombatMemory): Goal {
  const selfFeet = self.movement.feet;
  const selfEye: Vec3 = { x: selfFeet.x, y: selfFeet.y + eyeHeight(self.movement), z: selfFeet.z };
  const selfState = ctx.state(self.id);

  // 1. Gather all living opponents:
  const opponents: { id: PlayerId; feet: Vec3; distance: number; visible: boolean }[] = [];
  for (const player of ctx.players) {
    if (player.id === self.id || isTeammate(self, player.team)) {
      continue;
    }
    const state = ctx.state(player.id);
    if (!state || !state.alive) {
      continue;
    }
    const dist = distance(selfFeet, state.feet);
    const targetEyeHeight = state.eyeHeight ?? STAND_EYE_HEIGHT;
    const targetChest: Vec3 = { x: state.feet.x, y: state.feet.y + targetEyeHeight * 0.75, z: state.feet.z };
    const targetHead: Vec3 = { x: state.feet.x, y: state.feet.y + targetEyeHeight, z: state.feet.z };
    const los = ctx.hasLineOfSight
      ? ctx.hasLineOfSight(selfEye, targetChest) || ctx.hasLineOfSight(selfEye, targetHead)
      : true;
    opponents.push({ id: player.id, feet: state.feet, distance: dist, visible: los });
  }

  // 2. Select target: visible ones take priority over non-visible:
  opponents.sort((a, b) => {
    if (a.visible !== b.visible) {
      return a.visible ? -1 : 1;
    }
    return a.distance - b.distance;
  });

  const bestTarget = opponents[0] ?? null;

  if (!bestTarget) {
    memory.targetId = null;
    memory.targetVisible = false;
    memory.burstUntil = 0;
    memory.pauseUntil = 0;
    // No opponents left; reload if safe and needed:
    if (selfState?.weapon && selfState.weapon.ammo < selfState.weapon.clipSize && selfState.weapon.state !== "reloading") {
      return { kind: "idle", reload: true };
    }
    return IDLE;
  }

  // Target acquisition tracking:
  const newlyAcquired = bestTarget.id !== memory.targetId || !memory.targetVisible;
  memory.targetVisible = bestTarget.visible;

  if (bestTarget.visible) {
    if (newlyAcquired) {
      memory.targetId = bestTarget.id;
      memory.targetSpottedAt = ctx.now;
      memory.burstUntil = 0;
      memory.pauseUntil = 0;
      // Calculate aim dispersion offset based on difficulty:
      const err = memory.config.aimErrorMin + (memory.config.aimErrorMax - memory.config.aimErrorMin) * memory.rng();
      const angle = memory.rng() * Math.PI * 2;
      memory.aimOffset = {
        x: Math.cos(angle) * err,
        y: (memory.rng() - 0.5) * err * 0.5,
        z: Math.sin(angle) * err,
      };
      // Roll tactical crouch decision:
      memory.crouchActive = memory.rng() < memory.config.crouchProbability;
    }
  } else {
    memory.targetId = null;
    memory.burstUntil = 0;
    memory.pauseUntil = 0;
  }

  const isVisible = bestTarget.visible;

  // 3. Combat engagement (Line of Sight established):
  if (isVisible) {
    const timeSpotted = ctx.now - memory.targetSpottedAt;
    const canFireAfterReaction = timeSpotted >= memory.config.reactionTime;

    let fire = false;
    let reload = false;

    // Ammo checking:
    if (selfState?.weapon) {
      if (selfState.weapon.ammo === 0 && selfState.weapon.state !== "reloading") {
        reload = true;
      }
    }

    if (canFireAfterReaction && !reload) {
      if (ctx.now < memory.burstUntil) {
        // Actively firing current burst
        fire = true;
      } else if (ctx.now < memory.pauseUntil) {
        // Pausing between bursts
        fire = false;
      } else {
        // Trigger new burst:
        const burstDur =
          memory.config.burstMinDuration +
          (memory.config.burstMaxDuration - memory.config.burstMinDuration) * memory.rng();
        const pauseDur =
          memory.config.burstPauseMin + (memory.config.burstPauseMax - memory.config.burstPauseMin) * memory.rng();
        memory.burstUntil = ctx.now + burstDur;
        memory.pauseUntil = memory.burstUntil + pauseDur;
        fire = true;
      }
    }

    const ads = bestTarget.distance >= memory.config.adsMinDistance;
    const bestTargetEyeHeight = ctx.state(bestTarget.id)?.eyeHeight ?? STAND_EYE_HEIGHT;
    const targetChest: Vec3 = {
      x: bestTarget.feet.x + memory.aimOffset.x,
      y: bestTarget.feet.y + bestTargetEyeHeight * 0.75 + memory.aimOffset.y,
      z: bestTarget.feet.z + memory.aimOffset.z,
    };

    // Movement while engaged:
    if (bestTarget.distance > 18) {
      // Advance to effective combat range:
      const route = ctx.nav.route(selfFeet, bestTarget.feet);
      return {
        kind: "moveTo",
        point: bestTarget.feet,
        track: bestTarget.id,
        route: route ?? undefined,
        run: memory.config.runInCombat,
        aimAt: targetChest,
        fire,
        ads,
        crouch: memory.crouchActive,
        reload,
      };
    }

    // Within primary engagement distance: aim and fire:
    return {
      kind: "look",
      point: targetChest,
      aimAt: targetChest,
      fire,
      ads,
      crouch: memory.crouchActive,
      reload,
    };
  }

  // 4. Target hidden (No Line of Sight): pursue and reload if needed:
  let reload = false;
  if (selfState?.weapon && selfState.weapon.ammo < selfState.weapon.clipSize * 0.7 && selfState.weapon.state !== "reloading") {
    reload = true;
  }

  const route = ctx.nav.route(selfFeet, bestTarget.feet);
  if (route) {
    return {
      kind: "moveTo",
      point: bestTarget.feet,
      track: bestTarget.id,
      route,
      run: true,
      reload,
    };
  }

  return IDLE;
}

function isTeammate(self: BotSelf, team: string | undefined): boolean {
  return self.team !== undefined && team === self.team;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
