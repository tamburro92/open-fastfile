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
import type { KillstreakId, LoadoutStrikePackage, StrikePackageId } from "@3d/shared/sim/loadout.js";
import { streakCost, type SentryState, type StreakState } from "@3d/shared/game/streaks.js";
import { PREDATOR, SENTRY, UAV_DURATION } from "@3d/shared/game/equipment.js";
import { MAX_SNAPSHOT_SENTRIES, MAX_STREAK_PROGRESS } from "@3d/shared/net/messages/streaks.js";
import type { ProjectileState } from "@3d/shared/sim/projectile.js";
import type { MatchClock } from "./clock.js";
import type { Damage } from "./damage.js";
import type { EventOutbox } from "./outbox.js";
import type { Member, MemberStreaks, Roster } from "./roster.js";

/** A sentry's rounds: `fireTime`, 1,200 a minute. */
const SENTRY_FIRE_INTERVAL = SENTRY.fireTime;
/** Where its gun is, above the point it was set down on. */
const SENTRY_MUZZLE_HEIGHT = 0.8;

/** Close enough to its target to open fire: a turret does not shoot while it is still swinging round. */
const SENTRY_ON_TARGET = 3 * (Math.PI / 180);
const DEG = Math.PI / 180;

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** `from` turned toward `to` by at most `step`, the short way round. */
const approachAngle = (from: number, to: number, step: number): number => {
  const delta = wrapAngle(to - from);
  return Math.abs(delta) <= step ? to : from + Math.sign(delta) * step;
};

const uavKey = (owner: PlayerId, side: number | null): string => (side === null ? `player:${owner}` : `side:${side}`);

/**
 * A member takes on a class's strike package. A different one starts over —
 * three new slots are not the old three's progress — and the same one keeps it,
 * so re-picking a class does not cost a player the UAV they were holding.
 */
export function adoptStrikePackage(streaks: MemberStreaks, chosen: LoadoutStrikePackage): void {
  const same = streaks.package === chosen.package && streaks.streaks.every((id, slot) => id === chosen.streaks[slot]);
  if (same) {
    return;
  }
  streaks.package = chosen.package;
  streaks.streaks = [...chosen.streaks];
  streaks.killsThisLife = 0;
  streaks.totalPoints = 0;
  streaks.ready = [false, false, false];
  streaks.earned = [false, false, false];
}

export interface ActiveSentry {
  id: number;
  ownerId: PlayerId;
  team: number | null;
  position: Vec3;
  /** Where it was set down facing: the middle of the arc it may turn through. */
  baseYaw: number;
  yaw: number;
  pitch: number;
  expiresAt: number;
  health: number;
  lastFiredAt: number;
  targetId: PlayerId | null;
}

export interface ActiveMissile {
  id: number;
  ownerId: PlayerId;
  position: Vec3;
  velocity: Vec3;
  timeRemaining: number;
}

export class Killstreaks {
  /** Keyed by side, or by the owner in a game with no sides: a free-for-all's UAV is its caller's alone. */
  private readonly uavActiveUntil = new Map<string, number>();
  private readonly sentries: ActiveSentry[] = [];
  private readonly missiles: ActiveMissile[] = [];
  private nextEntityId = 1;

  constructor(
    private readonly clock: MatchClock,
    private readonly roster: Roster,
    private readonly outbox: EventOutbox,
    private readonly damage: Damage,
    private readonly collision: CapsuleWorld,
    /** A missile is drawn as a projectile, so it takes its id from the same counter as a grenade. */
    private readonly projectileId: () => number,
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

    const hardline = this.hasHardline(killer);

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
      // Assault or Support: each streak once per count, the count being a life
      // for Assault and, for Support, until the dearest of the three is earned.
      const streaks = killer.streaks;
      for (let slot = 0; slot < streaks.streaks.length; slot++) {
        if (!streaks.earned[slot] && points >= streakCost(streaks.streaks[slot]!, pkg, hardline)) {
          streaks.earned[slot] = true;
          streaks.ready[slot] = true;
          this.outbox.push({ kind: "announce", what: "killstreak_earned", player: killer.id, team: killer.player.side, value: slot }, killer.id, 1.5);
        }
      }
      if (pkg === "support" && streaks.earned.every(Boolean)) {
        streaks.totalPoints = 0;
        streaks.earned = [false, false, false];
      }
    }
  }

  /**
   * Called when a player dies.
   */
  onDeath(victim: Member): void {
    victim.streaks.killsThisLife = 0;
    // Assault starts its count again; what was earned and not used is kept.
    if (victim.streaks.package === "assault") {
      victim.streaks.earned = [false, false, false];
    }

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
        this.uavActiveUntil.set(uavKey(member.id, side), this.clock.now + UAV_DURATION);

        this.outbox.push(
          {
            kind: "announce",
            what: "uav_active",
            player: member.id,
            team: side,
            value: UAV_DURATION,
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
          id: this.nextEntityId,
          ownerId: member.id,
          team: side,
          position: { x: sx, y: sy, z: sz },
          baseYaw: yaw,
          yaw,
          pitch: 0,
          expiresAt: this.clock.now + SENTRY.lifetime,
          health: 300,
          lastFiredAt: -Infinity,
          targetId: null,
        };

        this.nextEntityId = (this.nextEntityId + 1) & 0xff;
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
          id: this.projectileId(),
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

  private stepSentries(dt: number, now: number): void {
    for (let i = this.sentries.length - 1; i >= 0; i--) {
      const sentry = this.sentries[i]!;
      if (sentry.health <= 0 || now >= sentry.expiresAt) {
        this.sentries.splice(i, 1);
        this.outbox.push({ kind: "announce", what: "sentry_destroyed", player: sentry.ownerId, team: sentry.team, value: 0 }, null, 1.0);
        continue;
      }

      const muzzle: Vec3 = { x: sentry.position.x, y: sentry.position.y + SENTRY_MUZZLE_HEIGHT, z: sentry.position.z };
      const target = this.sentryTarget(sentry, muzzle);
      sentry.targetId = target?.member.id ?? null;
      if (!target) {
        continue;
      }

      // Turned toward it no faster than the turret can turn (`maxHorTurnSpeed`, `maxVertTurnSpeed`).
      sentry.yaw = approachAngle(sentry.yaw, target.yaw, SENTRY.maxHorTurnSpeed * DEG * dt);
      sentry.pitch = approachAngle(sentry.pitch, target.pitch, SENTRY.maxVertTurnSpeed * DEG * dt);
      const onTarget = Math.abs(wrapAngle(target.yaw - sentry.yaw)) < SENTRY_ON_TARGET && Math.abs(target.pitch - sentry.pitch) < SENTRY_ON_TARGET;
      if (!onTarget || now - sentry.lastFiredAt < SENTRY_FIRE_INTERVAL) {
        continue;
      }
      sentry.lastFiredAt = now;
      const victim = target.member;
      const wasHealth = victim.player.health;
      this.damage.hurt({ id: victim.id, amount: SENTRY.playerDamage, by: sentry.ownerId, cause: "bullet", location: "torsoUpper", along: target.direction });
      if (victim.player.health < wasHealth) {
        this.outbox.push({ kind: "hit", lethal: victim.player.dead }, sentry.ownerId, 0);
      }
    }
  }

  /**
   * The nearest enemy the sentry can see, inside `maxRange` and the arcs either
   * side of the way it was set down facing (`leftArc`, `rightArc`, `topArc`,
   * `bottomArc`), and where it would have to point to hit them. Blind Eye is
   * invisible to it, as MW3's is.
   */
  private sentryTarget(sentry: ActiveSentry, muzzle: Vec3): { member: Member; yaw: number; pitch: number; direction: Vec3 } | null {
    let best: { member: Member; yaw: number; pitch: number; direction: Vec3 } | null = null;
    let bestDist = SENTRY.maxRange;
    for (const member of this.roster.values()) {
      if (member.player.dead || member.id === sentry.ownerId) {
        continue;
      }
      if (sentry.team !== null && member.player.side === sentry.team) {
        continue;
      }
      if (member.perks.perk1 === "blind_eye" || member.perks.bonusPerks.has("blind_eye")) {
        continue;
      }
      const feet = member.player.movement.feet;
      const aimAt = { x: feet.x, y: feet.y + eyeHeight(member.player.movement) * 0.8, z: feet.z };
      const dx = aimAt.x - muzzle.x;
      const dy = aimAt.y - muzzle.y;
      const dz = aimAt.z - muzzle.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > bestDist || dist < 0.01) {
        continue;
      }
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      // Positive is to the left: yaw turns counter-clockwise seen from above.
      const off = wrapAngle(yaw - sentry.baseYaw);
      if (off > SENTRY.leftArc * DEG || off < -SENTRY.rightArc * DEG || pitch > SENTRY.topArc * DEG || pitch < -SENTRY.bottomArc * DEG) {
        continue;
      }
      const direction = { x: dx / dist, y: dy / dist, z: dz / dist };
      const hit = this.collision.traceRay(muzzle, direction, dist, "shots");
      if (hit !== null && hit.distance < dist - 0.5) {
        continue;
      }
      bestDist = dist;
      best = { member, yaw, pitch, direction };
    }
    return best;
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
    const { radius: RADIUS, inner: MAX_DAMAGE, outer: MIN_DAMAGE } = PREDATOR;

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

  /** What `id`'s own HUD is told on every snapshot; null for nobody in the match. */
  stateFor(id: PlayerId): StreakState | null {
    const member = this.roster.get(id);
    if (!member) {
      return null;
    }
    const { package: pkg, streaks, ready, killsThisLife, totalPoints } = member.streaks;
    const progress = pkg === "support" ? totalPoints : killsThisLife;
    return { package: pkg, streaks: [...streaks], ready: [...ready], progress: Math.min(progress, MAX_STREAK_PROGRESS), hardline: this.hasHardline(member) };
  }

  private hasHardline(member: Member): boolean {
    return member.perks.perk2 === "hardline" || member.perks.bonusPerks.has("hardline");
  }

  /**
   * Which of `players` `viewer`'s UAV shows them, in that order; empty while
   * they have none up. A player is never shown to themself or their own side,
   * and Assassin hides them from it.
   */
  revealedFor(viewer: PlayerId, players: readonly { id: PlayerId }[]): boolean[] {
    const member = this.roster.get(viewer);
    if (!member) {
      return [];
    }
    const side = member.player.side;
    const until = this.uavActiveUntil.get(uavKey(viewer, side));
    if (until === undefined || this.clock.now >= until) {
      return [];
    }
    return players.map(({ id }) => {
      const other = this.roster.get(id);
      if (!other || other.id === viewer || other.player.dead || (side !== null && other.player.side === side)) {
        return false;
      }
      return !(other.perks.perk2 === "assassin" || other.perks.bonusPerks.has("assassin"));
    });
  }

  /** Every placed sentry, for every snapshot. Firing is a shot within the last two of its rounds' interval. */
  get sentryStates(): SentryState[] {
    const now = this.clock.now;
    return this.sentries.slice(0, MAX_SNAPSHOT_SENTRIES).map((sentry) => ({
      id: sentry.id,
      owner: sentry.ownerId,
      position: { ...sentry.position },
      facing: sentry.baseYaw,
      yaw: sentry.yaw,
      pitch: sentry.pitch,
      firing: now - sentry.lastFiredAt < SENTRY_FIRE_INTERVAL * 2,
    }));
  }

  /** Missiles in the air, drawn beside the grenades. */
  get missileStates(): ProjectileState[] {
    return this.missiles.map((missile) => ({ id: missile.id, kind: "missile", position: { ...missile.position } }));
  }
}
