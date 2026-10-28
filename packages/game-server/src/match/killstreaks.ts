// Authentic Call of Duty: Modern Warfare 3 Strike Packages & Killstreak System.
//
// Supports:
// - Assault Package: Resets on death. Streaks: UAV (3 kills), Predator Missile (5 kills), Sentry Gun (5 kills).
// - Support Package: Does NOT reset on death. Streaks: UAV (4 kills), Vest (5 kills), SAM Turret (8 kills).
// - Specialist Package: Unlocks bonus perks at 2, 4, 6 kills and All-Perk bonus at 8 kills.
// - Perks: Sleight of Hand, Quickdraw, Stalker, Extreme Conditioning, Hardline, Blast Shield, Blind Eye, Assassin, Steady Aim.

import type { PlayerId } from "@3d/shared/net/messages/fields.js";
import type { CapsuleWorld, Vec3 } from "@3d/shared/sim/capsule.js";
import { eyeHeight } from "@3d/shared/sim/stance.js";
import type { KillstreakId, StrikePackageId } from "@3d/shared/sim/loadout.js";
import type { MatchClock } from "./clock.js";
import type { Damage } from "./damage.js";
import type { EventOutbox } from "./outbox.js";
import type { Member, Roster } from "./roster.js";

/** Authentic MW3 Killstreak kill costs */
export const STREAK_COSTS: Record<KillstreakId, { assault: number; support: number }> = {
  uav: { assault: 3, support: 4 },
  counter_uav: { assault: 4, support: 5 },
  predator_missile: { assault: 5, support: 6 },
  sentry_gun: { assault: 5, support: 8 },
  ims: { assault: 5, support: 8 },
  sam_turret: { assault: 4, support: 8 },
  strafe_run: { assault: 9, support: 10 },
  reaper: { assault: 9, support: 12 },
  ac130: { assault: 12, support: 15 },
};

export interface ActiveSentry {
  id: string;
  ownerId: PlayerId;
  team: number | null;
  position: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  lastFiredAt: number;
  targetId: PlayerId | null;
}

export interface ActiveMissile {
  id: string;
  ownerId: PlayerId;
  position: Vec3;
  velocity: Vec3;
  timeRemaining: number;
}

export class Killstreaks {
  private readonly uavActiveUntil = new Map<number | null, number>();
  private readonly sentries: ActiveSentry[] = [];
  private readonly missiles: ActiveMissile[] = [];
  private nextEntityId = 1;

  constructor(
    private readonly clock: MatchClock,
    private readonly roster: Roster,
    private readonly outbox: EventOutbox,
    private readonly damage: Damage,
    private readonly collision: CapsuleWorld,
  ) {}

  /**
   * Called when a player achieves a kill.
   */
  onKill(killer: Member, victim: Member): void {
    if (killer.id === victim.id) {
      return;
    }

    killer.streaks.killsThisLife++;
    killer.streaks.totalPoints++;

    const pkg: StrikePackageId = killer.streaks.package;
    const points = pkg === "support" ? killer.streaks.totalPoints : killer.streaks.killsThisLife;

    // Hardline reduces required kills by 1 (minimum 1)
    const hasHardline = killer.perks.perk2 === "hardline" || killer.perks.bonusPerks.has("hardline");
    const discount = hasHardline ? 1 : 0;

    if (pkg === "specialist") {
      // Specialist unlocks bonus perks
      if (killer.streaks.killsThisLife >= 2) {
        killer.perks.bonusPerks.add("scavenger");
      }
      if (killer.streaks.killsThisLife >= 4) {
        killer.perks.bonusPerks.add("assassin");
      }
      if (killer.streaks.killsThisLife >= 6) {
        killer.perks.bonusPerks.add("dead_silence");
      }
      if (killer.streaks.killsThisLife >= 8) {
        // All Perks bonus!
        killer.perks.bonusPerks.add("blind_eye");
        killer.perks.bonusPerks.add("extreme_conditioning");
        killer.perks.bonusPerks.add("steady_aim");
        killer.perks.bonusPerks.add("blast_shield");
        killer.perks.bonusPerks.add("sitrep");
      }
    } else {
      // Assault or Support package streaks:
      for (let slot = 0; slot < killer.streaks.streaks.length; slot++) {
        const streakId = killer.streaks.streaks[slot]!;
        const baseCost = STREAK_COSTS[streakId]?.[pkg === "support" ? "support" : "assault"] ?? 5;
        const required = Math.max(1, baseCost - discount);

        if (points >= required && !killer.streaks.ready[slot]) {
          killer.streaks.ready[slot] = true;

          this.outbox.push(
            {
              kind: "announce",
              what: "killstreak_earned",
              player: killer.id,
              team: killer.player.side,
              value: slot,
            },
            killer.id,
            1.5,
          );
        }
      }
    }
  }

  /**
   * Called when a player dies.
   */
  onDeath(victim: Member): void {
    victim.streaks.killsThisLife = 0;

    if (victim.streaks.package === "specialist") {
      victim.perks.bonusPerks.clear();
    }
    // Note: Assault ready streaks are preserved in reserve until used,
    // but progress toward unearned ones resets (which killsThisLife = 0 achieves).
  }

  /**
   * Called when player presses killstreak key (Digit5).
   * Activates the highest or next available ready streak.
   */
  activate(member: Member): boolean {
    if (member.player.dead) {
      return false;
    }

    // Find ready slot (highest first, authentic MW3 priority)
    let readySlot = -1;
    for (let slot = member.streaks.ready.length - 1; slot >= 0; slot--) {
      if (member.streaks.ready[slot]) {
        readySlot = slot;
        break;
      }
    }

    if (readySlot === -1) {
      return false;
    }

    const streakId = member.streaks.streaks[readySlot]!;
    member.streaks.ready[readySlot] = false;

    this.deploy(member, streakId, readySlot);
    return true;
  }

  /**
   * Deploy the specific killstreak effect.
   */
  private deploy(member: Member, streakId: KillstreakId, slot: number): void {
    const side = member.player.side;

    switch (streakId) {
      case "uav": {
        // Activate UAV radar for 30 seconds
        this.uavActiveUntil.set(side, this.clock.now + 30.0);

        this.outbox.push(
          {
            kind: "announce",
            what: "uav_active",
            player: member.id,
            team: side,
            value: 30,
          },
          null,
          2.0,
        );
        break;
      }

      case "sentry_gun": {
        // Deploy Sentry Gun in front of player
        const yaw = member.player.movement.yaw;
        const feet = member.player.movement.feet;
        const dist = 1.5;
        const sx = feet.x - Math.sin(yaw) * dist;
        const sz = feet.z - Math.cos(yaw) * dist;
        const sy = feet.y;

        const sentry: ActiveSentry = {
          id: `sentry-${this.nextEntityId++}`,
          ownerId: member.id,
          team: side,
          position: { x: sx, y: sy, z: sz },
          yaw,
          pitch: 0,
          health: 300,
          lastFiredAt: 0,
          targetId: null,
        };

        this.sentries.push(sentry);

        this.outbox.push(
          {
            kind: "announce",
            what: "sentry_placed",
            player: member.id,
            team: side,
            value: slot,
          },
          null,
          2.0,
        );
        break;
      }

      case "predator_missile": {
        // Spawn Hellfire missile in the sky descending towards target area in front of player
        const feet = member.player.movement.feet;
        const yaw = member.player.movement.yaw;
        const targetX = feet.x - Math.sin(yaw) * 15.0;
        const targetZ = feet.z - Math.cos(yaw) * 15.0;
        const startY = feet.y + 100.0;
        const missile: ActiveMissile = {
          id: `predator-${this.nextEntityId++}`,
          ownerId: member.id,
          position: { x: targetX, y: startY, z: targetZ },
          velocity: { x: 0, y: -40.0, z: 0 },
          timeRemaining: 4.5,
        };

        this.missiles.push(missile);

        this.outbox.push(
          {
            kind: "announce",
            what: "predator_inbound",
            player: member.id,
            team: side,
            value: 0,
          },
          null,
          1.5,
        );
        break;
      }

      default: {
        // Generic fallback streak
        this.outbox.push(
          {
            kind: "announce",
            what: `${streakId}_active`,
            player: member.id,
            team: side,
            value: slot,
          },
          null,
          1.5,
        );
        break;
      }
    }
  }

  /**
   * Step all active killstreaks, sentry targeting, and missile descents.
   */
  step(dt: number): void {
    const now = this.clock.now;

    // 1. Step UAV active status
    for (const [side, expiry] of this.uavActiveUntil.entries()) {
      if (now > expiry) {
        this.uavActiveUntil.delete(side);
      }
    }

    // 2. Step Sentry Guns
    this.stepSentries(dt, now);

    // 3. Step Predator Missiles
    this.stepMissiles(dt, now);
  }

  private stepSentries(_dt: number, now: number): void {
    if (this.sentries.length === 0) {
      return;
    }

    for (let i = this.sentries.length - 1; i >= 0; i--) {
      const sentry = this.sentries[i]!;

      if (sentry.health <= 0) {
        this.sentries.splice(i, 1);
        this.outbox.push(
          {
            kind: "announce",
            what: "sentry_destroyed",
            player: sentry.ownerId,
            team: sentry.team,
            value: 0,
          },
          null,
          1.0,
        );
        continue;
      }

      // Sentry target acquisition:
      // Scans for closest enemy within 30m in a 120-degree frontal cone
      let bestTarget: Member | null = null;
      let bestDist = 30.0;

      for (const target of this.roster.values()) {
        if (target.player.dead || target.id === sentry.ownerId) {
          continue;
        }

        // Friendly fire / team check:
        if (sentry.team !== null && target.player.side === sentry.team) {
          continue;
        }

        // Blind Eye perk check: Sentry ignores players with blind_eye
        if (target.perks.perk1 === "blind_eye" || target.perks.bonusPerks.has("blind_eye")) {
          continue;
        }

        const tFeet = target.player.movement.feet;
        const dx = tFeet.x - sentry.position.x;
        const dy = tFeet.y + eyeHeight(target.player.movement) - (sentry.position.y + 0.8);
        const dz = tFeet.z - sentry.position.z;
        const dist = Math.hypot(dx, dy, dz);

        if (dist > bestDist) {
          continue;
        }

        // Conical facing check (yaw angle):
        const angleToTarget = Math.atan2(-dx, -dz);
        let relYaw = angleToTarget - sentry.yaw;
        while (relYaw > Math.PI) {
          relYaw -= 2 * Math.PI;
        }
        while (relYaw < -Math.PI) {
          relYaw += 2 * Math.PI;
        }

        if (Math.abs(relYaw) > Math.PI / 3) {
          // Beyond 60 degrees off center
          continue;
        }

        // Line-of-sight check against collision geometry:
        const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
        const rayOrigin: Vec3 = { x: sentry.position.x, y: sentry.position.y + 0.8, z: sentry.position.z };
        const hit = this.collision.traceRay(rayOrigin, dir, dist, "shots");

        if (hit !== null && hit.distance < dist - 0.5) {
          // Blocked by wall
          continue;
        }

        bestDist = dist;
        bestTarget = target;
      }

      sentry.targetId = bestTarget ? bestTarget.id : null;

      // Sentry firing at target:
      if (bestTarget && now - sentry.lastFiredAt >= 0.1) {
        // 10 shots per second (600 RPM)
        sentry.lastFiredAt = now;

        const sentryMuzzle: Vec3 = { x: sentry.position.x, y: sentry.position.y + 0.8, z: sentry.position.z };
        const tFeet = bestTarget.player.movement.feet;
        const dir: Vec3 = {
          x: tFeet.x - sentryMuzzle.x,
          y: tFeet.y + 1.0 - sentryMuzzle.y,
          z: tFeet.z - sentryMuzzle.z,
        };
        const len = Math.hypot(dir.x, dir.y, dir.z);
        if (len > 0.01) {
          dir.x /= len;
          dir.y /= len;
          dir.z /= len;
        }

        const wasHealth = bestTarget.player.health;
        // 25 damage per bullet
        this.damage.hurt({
          id: bestTarget.id,
          amount: 25,
          by: sentry.ownerId,
          cause: "bullet",
          location: "torsoUpper",
          along: dir,
        });

        if (bestTarget.player.health < wasHealth) {
          this.outbox.push({ kind: "hit", lethal: bestTarget.player.dead }, sentry.ownerId, 0);
        }

        this.outbox.push(
          {
            kind: "announce",
            what: "sentry_fire",
            player: sentry.ownerId,
            team: sentry.team,
            value: Math.round(sentry.yaw * 100),
          },
          null,
          0.1,
        );
      }
    }
  }

  private stepMissiles(dt: number, _now: number): void {
    if (this.missiles.length === 0) {
      return;
    }

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i]!;
      missile.timeRemaining -= dt;

      const dx = missile.velocity.x * dt;
      const dy = missile.velocity.y * dt;
      const dz = missile.velocity.z * dt;
      const stepDist = Math.hypot(dx, dy, dz);

      if (stepDist > 0.001) {
        const dir: Vec3 = { x: dx / stepDist, y: dy / stepDist, z: dz / stepDist };
        const hit = this.collision.traceRay(missile.position, dir, stepDist, "shots");

        if (hit !== null || missile.position.y + dy <= 0 || missile.timeRemaining <= 0) {
          // Detonate Predator Missile
          const hitPos: Vec3 = hit
            ? {
                x: missile.position.x + dir.x * hit.distance,
                y: missile.position.y + dir.y * hit.distance,
                z: missile.position.z + dir.z * hit.distance,
              }
            : {
                x: missile.position.x + dx,
                y: Math.max(0, missile.position.y + dy),
                z: missile.position.z + dz,
              };

          this.detonateMissile(missile, hitPos);
          this.missiles.splice(i, 1);
          continue;
        }
      }

      missile.position.x += dx;
      missile.position.y += dy;
      missile.position.z += dz;
    }
  }

  private detonateMissile(missile: ActiveMissile, center: Vec3): void {
    const RADIUS = 12.0; // 12 meters blast radius
    const MAX_DAMAGE = 300;
    const MIN_DAMAGE = 80;

    for (const member of this.roster.values()) {
      if (member.player.dead) {
        continue;
      }

      // Check friendly fire
      if (this.damage.mayHurt && !this.damage.mayHurt(member.id, missile.ownerId)) {
        continue;
      }

      const mFeet = member.player.movement.feet;
      const dx = center.x - mFeet.x;
      const dy = center.y - (mFeet.y + 0.8);
      const dz = center.z - mFeet.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist > RADIUS) {
        continue;
      }

      // LoS check:
      if (dist > 0.1) {
        const toPlayer: Vec3 = { x: -dx / dist, y: -dy / dist, z: -dz / dist };
        const hit = this.collision.traceRay(center, toPlayer, dist, "shots");
        if (hit !== null && hit.distance < dist - 0.3) {
          // Wall blocked blast
          continue;
        }
      }

      const fraction = 1.0 - dist / RADIUS;
      const rawDamage = Math.round(MIN_DAMAGE + (MAX_DAMAGE - MIN_DAMAGE) * fraction);

      const wasHealth = member.player.health;
      const pushDir: Vec3 = dist > 0.1 ? { x: -dx / dist, y: 0.3, z: -dz / dist } : { x: 0, y: 1, z: 0 };
      this.damage.hurt({
        id: member.id,
        amount: rawDamage,
        by: missile.ownerId,
        cause: "explosion",
        location: "torsoLower",
        along: pushDir,
      });

      if (member.player.health < wasHealth && missile.ownerId) {
        this.outbox.push({ kind: "hit", lethal: member.player.dead }, missile.ownerId, 0);
      }
    }

    this.outbox.push({ kind: "detonate", what: "missile", at: { ...center }, by: missile.ownerId }, null, 1.0);
  }

  /**
   * Check if a player is visible on radar (UAV active for opposing team and player not using Assassin).
   */
  isRevealedByUav(playerId: PlayerId, viewerTeam: number | null): boolean {
    const member = this.roster.get(playerId);
    if (!member || member.player.dead) {
      return false;
    }

    // Assassin perk protects from UAV
    if (member.perks.perk2 === "assassin" || member.perks.bonusPerks.has("assassin")) {
      return false;
    }

    // Check if viewer's team has active UAV
    const expiry = this.uavActiveUntil.get(viewerTeam);
    return expiry !== undefined && this.clock.now < expiry;
  }
}
