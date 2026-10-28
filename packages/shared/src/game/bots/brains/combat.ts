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
  aimTurnSpeed: number;
  initialMissShots: number;
  convergenceTime: number;
  triggerDiscipline: number;
}

export const COMBAT_DIFFICULTIES: Record<BotDifficulty, CombatConfig> = {
  recruit: {
    reactionTime: 0.55,
    aimErrorMin: 0.65,
    aimErrorMax: 1.25,
    burstMinDuration: 0.18,
    burstMaxDuration: 0.30,
    burstPauseMin: 0.55,
    burstPauseMax: 0.85,
    crouchProbability: 0.05,
    adsMinDistance: 12,
    runInCombat: false,
    aimTurnSpeed: 2.5,
    initialMissShots: 4,
    convergenceTime: 1.8,
    triggerDiscipline: 0.18,
  },
  regular: {
    reactionTime: 0.35,
    aimErrorMin: 0.35,
    aimErrorMax: 0.58,
    burstMinDuration: 0.25,
    burstMaxDuration: 0.42,
    burstPauseMin: 0.35,
    burstPauseMax: 0.55,
    crouchProbability: 0.20,
    adsMinDistance: 5,
    runInCombat: true,
    aimTurnSpeed: 3.8,
    initialMissShots: 2,
    convergenceTime: 1.0,
    triggerDiscipline: 0.14,
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
    aimTurnSpeed: 6.5,
    initialMissShots: 1,
    convergenceTime: 0.5,
    triggerDiscipline: 0.10,
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
    aimTurnSpeed: 10.5,
    initialMissShots: 0,
    convergenceTime: 0.2,
    triggerDiscipline: 0.06,
  },
};

export interface CombatMemory {
  difficulty: BotDifficulty;
  config: CombatConfig;
  targetId: PlayerId | null;
  targetVisible: boolean;
  targetSpottedAt: number;
  lastKnownPosition: Vec3 | null;
  lastSeenAt: number;
  burstUntil: number;
  pauseUntil: number;
  aimOffset: Vec3;
  crouchActive: boolean;
  lastGrenadeAt: number;
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
      lastKnownPosition: null,
      lastSeenAt: -20,
      burstUntil: 0,
      pauseUntil: 0,
      aimOffset: { x: 0, y: 0, z: 0 },
      crouchActive: false,
      lastGrenadeAt: -20,
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
  const facingX = -Math.sin(self.movement.yaw);
  const facingZ = -Math.cos(self.movement.yaw);

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

    // Field of View (FOV) check: authentic Call of Duty bot vision cone (~130 degrees),
    // unless target is heard (close proximity <= 3.5m).
    let inVisionCone = true;
    const dx = state.feet.x - selfFeet.x;
    const dz = state.feet.z - selfFeet.z;
    const hDist = Math.hypot(dx, dz);
    if (hDist > 0.1 && dist > 3.5) {
      const dot = (facingX * dx + facingZ * dz) / hDist;
      inVisionCone = dot >= 0.42;
    }

    opponents.push({ id: player.id, feet: state.feet, distance: dist, visible: los && inVisionCone });
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
    memory.lastKnownPosition = { x: bestTarget.feet.x, y: bestTarget.feet.y, z: bestTarget.feet.z };
    memory.lastSeenAt = ctx.now;
  } else {
    memory.targetId = null;
    memory.burstUntil = 0;
    memory.pauseUntil = 0;
  }

  const isVisible = bestTarget.visible;

  // 3. Combat engagement (Line of Sight established):
  if (isVisible) {
    const timeSpotted = ctx.now - memory.targetSpottedAt;
    const canFireAfterReaction = timeSpotted >= memory.config.reactionTime - 0.005;

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

    // Camera-plane orthogonal basis relative to line of sight:
    const toTargetX = bestTarget.feet.x - selfEye.x;
    const toTargetZ = bestTarget.feet.z - selfEye.z;
    const hDist = Math.hypot(toTargetX, toTargetZ);
    let rightX = 1;
    let rightZ = 0;
    if (hDist > 0.01) {
      rightX = toTargetZ / hDist;
      rightZ = -toTargetX / hDist;
    }

    // Authentic MW3 Aim Convergence and Initial Misses:
    // Initial shots intentionally miss or have wider spread, then converge as the bot zeroes in.
    let missFactor = 1.0;
    if (timeSpotted < memory.config.convergenceTime) {
      const convT = timeSpotted / memory.config.convergenceTime;
      const initialMissScale = memory.config.initialMissShots > 0
        ? (memory.difficulty === "recruit" ? 1.6 : memory.difficulty === "regular" ? 0.9 : 0.3)
        : 0;
      missFactor += (1 - convT) * initialMissScale;
    }

    // Dynamic recoil sway while firing
    const swayAmp = memory.config.aimErrorMin * 0.25;
    const swayLateral = Math.sin(timeSpotted * 8) * swayAmp;
    const swayVertical = Math.abs(Math.cos(timeSpotted * 11)) * swayAmp * 0.5;

    const latOffset = memory.aimOffset.x * missFactor + swayLateral;
    const vertOffset = memory.aimOffset.y * missFactor + swayVertical;

    const targetChest: Vec3 = {
      x: bestTarget.feet.x + rightX * latOffset,
      y: bestTarget.feet.y + bestTargetEyeHeight * 0.75 + vertOffset,
      z: bestTarget.feet.z + rightZ * latOffset,
    };

    const melee = bestTarget.distance <= 2.0;
    let lethal = false;
    let tactical = false;
    if (canFireAfterReaction && !melee && bestTarget.distance >= 10 && bestTarget.distance <= 22 && ctx.now - memory.lastGrenadeAt > 15) {
      const throwProb = memory.difficulty === "veteran" ? 0.35 : memory.difficulty === "hardened" ? 0.25 : 0.15;
      if (memory.rng() < throwProb) {
        memory.lastGrenadeAt = ctx.now;
        if (memory.rng() > 0.5) {
          lethal = true;
        } else {
          tactical = true;
        }
      }
    }

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
        turnSpeed: memory.config.aimTurnSpeed,
        triggerDiscipline: memory.config.triggerDiscipline,
        fire,
        ads,
        crouch: canFireAfterReaction && memory.crouchActive,
        reload,
        melee,
        lethal,
        tactical,
      };
    }

    // Within primary engagement distance: aim and fire:
    return {
      kind: "look",
      point: targetChest,
      aimAt: targetChest,
      turnSpeed: memory.config.aimTurnSpeed,
      triggerDiscipline: memory.config.triggerDiscipline,
      fire,
      ads,
      crouch: canFireAfterReaction && memory.crouchActive,
      reload,
      melee,
      lethal,
      tactical,
    };
  }

  // 4. Target hidden (No Line of Sight): pursue last known position (no wallhack!)
  let reload = false;
  if (selfState?.weapon && selfState.weapon.ammo < selfState.weapon.clipSize * 0.7 && selfState.weapon.state !== "reloading") {
    reload = true;
  }

  const pursuePoint = memory.lastKnownPosition ?? bestTarget.feet;
  const route = ctx.nav.route(selfFeet, pursuePoint);
  if (route) {
    return {
      kind: "moveTo",
      point: pursuePoint,
      // Note: Omit track: bestTarget.id so bot does not follow enemy movements through walls!
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
