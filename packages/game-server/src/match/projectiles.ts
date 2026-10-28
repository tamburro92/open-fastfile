// Authoritative flight of what a player throws: frag, semtex and flashbang.
// Every number is MW3's own, from its weapon files (@3d/shared/game/equipment.ts),
// except how long a flashbang blinds, which MW3 keeps in a script.
//
// A press is MW3's too: the pin comes out for `holdFire`, then the grenade leaves
// along the aim the thrower has *then*, on top of the thrower's own velocity, and
// nothing else is thrown until the arm has come through (`fire`). Cooking is not
// built: the input is a press, not a hold.

import type { PlayerId } from "@3d/shared/net/messages/fields.js";
import type { InputMessage } from "@3d/shared/net/messages/input.js";
import type { CapsuleWorld, Vec3 } from "@3d/shared/sim/capsule.js";
import { eyeHeight } from "@3d/shared/sim/stance.js";
import { aimAngles, aimDirection } from "@3d/shared/sim/recoil.js";
import { GRAVITY } from "@3d/shared/sim/movementState.js";
import {
  FLASHBANG_FULL_RADIUS,
  FLASHBANG_RADIUS,
  FUSE,
  GRENADE_BLAST,
  GRENADE_THROW_LOFT,
  GRENADE_THROW_SPEED,
  grenadeBounce,
  THROW_TIMES,
} from "@3d/shared/game/equipment.js";
import { PROJECTILE_ID_MASK, type ProjectileKind, type ProjectileState } from "@3d/shared/sim/projectile.js";
import { MAX_SNAPSHOT_PROJECTILES } from "@3d/shared/net/messages/projectiles.js";
import type { MatchClock } from "./clock.js";
import type { Damage } from "./damage.js";
import type { EventOutbox } from "./outbox.js";
import type { Member, Roster } from "./roster.js";

/** The games' own gravity, as a player falls: a grenade that drops slower than its thrower reads as a bug. */
export const GRENADE_GRAVITY = -GRAVITY;

/** Seconds blind, looking at it and facing away: not in `flash_grenade_mp`, which leaves it to a script. */
export const FLASHBANG_MAX_DURATION = 3.5;
export const FLASHBANG_MIN_DURATION = 1.0;

/** How long a detonation rides the snapshot tail: a late explosion is still the right one. */
const DETONATION_HOLD = 0.5;

/** A pin coming out: the grenade has not left the hand yet. */
interface PendingThrow {
  readonly kind: GrenadeKind;
  readonly releaseAt: number;
  /** When the arm has come through and another may be thrown. */
  readonly busyUntil: number;
  released: boolean;
}

type GrenadeKind = keyof typeof THROW_TIMES;

export interface ActiveProjectile {
  readonly id: number;
  readonly kind: ProjectileKind;
  readonly thrower: PlayerId;
  position: Vec3;
  velocity: Vec3;
  fuseRemaining: number;
  stuckToPlayer?: PlayerId;
  stuckOffset?: Vec3;
  settled: boolean;
}

export class Projectiles {
  private readonly active: ActiveProjectile[] = [];
  private readonly throwing = new Map<PlayerId, PendingThrow>();
  private nextId = 1;
  private readonly aimDir: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly clock: MatchClock,
    private readonly roster: Roster,
    private readonly damage: Damage,
    private readonly outbox: EventOutbox,
    private readonly collision: CapsuleWorld,
  ) {}

  /** The next id on the wire's twelve bits: a killstreak's missile is drawn as one of these too. */
  allocateId(): number {
    const id = this.nextId;
    this.nextId = (this.nextId + 1) & PROJECTILE_ID_MASK;
    return id;
  }

  get live(): readonly ActiveProjectile[] {
    return this.active;
  }

  /** What every snapshot says is in the air: the oldest first, past the wire's cap. */
  get states(): ProjectileState[] {
    return this.active.slice(0, MAX_SNAPSHOT_PROJECTILES).map((p) => ({ id: p.id, kind: p.kind, position: { ...p.position } }));
  }

  /** A press of the lethal key: the class's frag or semtex, pin first. */
  throwLethal(member: Member, _message: InputMessage): void {
    if (member.equipment.lethalCount > 0) {
      this.pullPin(member, member.equipment.lethal === "semtex_mp" ? "semtex" : "frag");
    }
  }

  /** A press of the tactical key: the flashbang, pin first. */
  throwTactical(member: Member, _message: InputMessage): void {
    if (member.equipment.tacticalCount > 0) {
      this.pullPin(member, "flashbang");
    }
  }

  /** Whether `id` is mid-throw: the pin out, or the arm still coming through. */
  isThrowing(id: PlayerId): boolean {
    const pending = this.throwing.get(id);
    return pending !== undefined && this.clock.now < pending.busyUntil;
  }

  private pullPin(member: Member, kind: GrenadeKind): void {
    if (member.player.dead || this.isThrowing(member.id)) {
      return;
    }
    const now = this.clock.now;
    const times = THROW_TIMES[kind];
    this.throwing.set(member.id, { kind, releaseAt: now + times.holdFire, busyUntil: now + times.holdFire + times.fire, released: false });
  }

  /** Every pin that has been out long enough leaves the hand now. A death first costs nothing: it never left. */
  private release(): void {
    const now = this.clock.now;
    for (const [id, pending] of this.throwing) {
      const member = this.roster.get(id);
      if (!member || member.player.dead) {
        this.throwing.delete(id);
        continue;
      }
      if (!pending.released && now >= pending.releaseAt) {
        pending.released = true;
        if (pending.kind === "flashbang") {
          member.equipment.tacticalCount--;
        } else {
          member.equipment.lethalCount--;
        }
        this.spawnProjectile(member, pending.kind, FUSE[pending.kind]);
      }
      if (now >= pending.busyUntil) {
        this.throwing.delete(id);
      }
    }
  }

  private spawnProjectile(member: Member, kind: ProjectileKind, fuseTime: number): void {
    const movement = member.player.movement;
    const up = eyeHeight(movement);
    const eye: Vec3 = { x: movement.feet.x, y: movement.feet.y + up, z: movement.feet.z };
    const aim = aimDirection(aimAngles(movement, null), this.aimDir);

    // Initial position slightly in front of eye
    const position: Vec3 = {
      x: eye.x + aim.x * 0.4,
      y: eye.y + aim.y * 0.4,
      z: eye.z + aim.z * 0.4,
    };

    // Along the aim, straight up on top, and carried by the thrower's own run.
    const carried = movement.velocity;
    const velocity: Vec3 = {
      x: aim.x * GRENADE_THROW_SPEED + carried.x,
      y: aim.y * GRENADE_THROW_SPEED + GRENADE_THROW_LOFT + carried.y,
      z: aim.z * GRENADE_THROW_SPEED + carried.z,
    };

    const projectile: ActiveProjectile = {
      id: this.allocateId(),
      kind,
      thrower: member.id,
      position,
      velocity,
      fuseRemaining: fuseTime,
      settled: false,
    };

    this.active.push(projectile);
  }

  /**
   * Step all active projectiles across match dt.
   */
  step(dt: number): void {
    this.release();
    if (this.active.length === 0) {
      return;
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!;
      p.fuseRemaining -= dt;

      // Check detonation
      if (p.fuseRemaining <= 0) {
        this.detonate(p);
        this.active.splice(i, 1);
        continue;
      }

      // Physics update:
      if (p.stuckToPlayer) {
        const victim = this.roster.get(p.stuckToPlayer);
        if (victim && !victim.player.dead) {
          const vFeet = victim.player.movement.feet;
          const offset = p.stuckOffset ?? { x: 0, y: 1.0, z: 0 };
          p.position.x = vFeet.x + offset.x;
          p.position.y = vFeet.y + offset.y;
          p.position.z = vFeet.z + offset.z;
        } else {
          p.stuckToPlayer = undefined;
        }
      } else if (!p.settled) {
        this.stepMotion(p, dt);
      }
    }
  }

  private stepMotion(p: ActiveProjectile, dt: number): void {
    p.velocity.y += GRENADE_GRAVITY * dt;

    const dx = p.velocity.x * dt;
    const dy = p.velocity.y * dt;
    const dz = p.velocity.z * dt;
    const dist = Math.hypot(dx, dy, dz);

    if (dist < 0.001) {
      return;
    }

    const dir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };

    // Check collision against other players (especially for Semtex stick):
    if (p.kind === "semtex") {
      for (const target of this.roster.values()) {
        if (target.id === p.thrower || target.player.dead) {
          continue;
        }
        const tFeet = target.player.movement.feet;
        const targetCenter: Vec3 = { x: tFeet.x, y: tFeet.y + 0.9, z: tFeet.z };
        const distToTarget = Math.hypot(targetCenter.x - p.position.x, targetCenter.y - p.position.y, targetCenter.z - p.position.z);
        if (distToTarget <= 0.75) {
          // Stick to player!
          p.stuckToPlayer = target.id;
          p.stuckOffset = {
            x: p.position.x - tFeet.x,
            y: p.position.y - tFeet.y,
            z: p.position.z - tFeet.z,
          };
          p.velocity = { x: 0, y: 0, z: 0 };
          return;
        }
      }
    }

    // World collision raycast:
    const hit = this.collision.traceRay(p.position, dir, dist, "shots");

    if (hit) {
      // Imported soup is wound either way, so the normal is turned to face the grenade.
      const facing = dir.x * hit.normal.x + dir.y * hit.normal.y + dir.z * hit.normal.z > 0 ? -1 : 1;
      const normal: Vec3 = { x: hit.normal.x * facing, y: hit.normal.y * facing, z: hit.normal.z * facing };
      p.position.x += dir.x * hit.distance + normal.x * 0.02;
      p.position.y += dir.y * hit.distance + normal.y * 0.02;
      p.position.z += dir.z * hit.distance + normal.z * 0.02;

      if (p.kind === "semtex") {
        // Semtex sticks to the wall/floor immediately
        p.velocity = { x: 0, y: 0, z: 0 };
        p.settled = true;
        return;
      }

      // Frag or Flashbang: bounce
      const vDotN = p.velocity.x * normal.x + p.velocity.y * normal.y + p.velocity.z * normal.z;

      // What it keeps along the surface and away from it is the surface's own.
      const { parallel, perpendicular } = grenadeBounce(hit.surface);

      p.velocity.x = (p.velocity.x - vDotN * normal.x) * parallel - normal.x * vDotN * perpendicular;
      p.velocity.y = (p.velocity.y - vDotN * normal.y) * parallel - normal.y * vDotN * perpendicular;
      p.velocity.z = (p.velocity.z - vDotN * normal.z) * parallel - normal.z * vDotN * perpendicular;

      const speed = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z);

      if (speed < 0.4) {
        p.velocity = { x: 0, y: 0, z: 0 };
        p.settled = true;
      }
    } else {
      p.position.x += dx;
      p.position.y += dy;
      p.position.z += dz;
    }
  }

  private detonate(p: ActiveProjectile): void {
    this.outbox.push({ kind: "detonate", what: p.kind, at: { ...p.position }, by: p.thrower }, null, DETONATION_HOLD);
    if (p.kind === "flashbang") {
      this.detonateFlashbang(p);
    } else {
      this.detonateExplosive(p);
    }
  }

  private detonateExplosive(p: ActiveProjectile): void {
    const center = p.position;

    // Direct stuck damage:
    if (p.stuckToPlayer) {
      const victim = this.roster.get(p.stuckToPlayer);
      if (victim && !victim.player.dead) {
        this.damage.hurt({
          id: victim.id,
          amount: 150,
          by: p.thrower,
          cause: "explosion",
        });
        this.outbox.push({ kind: "hit", lethal: victim.player.dead }, p.thrower, 0);
      }
    }

    // Radial damage falloff:
    for (const member of this.roster.values()) {
      if (member.player.dead || member.id === p.stuckToPlayer) {
        continue;
      }

      const mFeet = member.player.movement.feet;
      const targetCenter: Vec3 = {
        x: mFeet.x,
        y: mFeet.y + eyeHeight(member.player.movement) * 0.5,
        z: mFeet.z,
      };

      const dx = targetCenter.x - center.x;
      const dy = targetCenter.y - center.y;
      const dz = targetCenter.z - center.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist > GRENADE_BLAST.radius) {
        continue;
      }

      // Line of sight check:
      if (dist > 0.1) {
        const rayDir: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
        const hit = this.collision.traceRay(center, rayDir, dist, "shots");
        if (hit !== null && hit.distance < dist - 0.25) {
          // Blocked by world wall
          continue;
        }
      }

      // Linear damage falloff: 130 inner down to 55 outer
      const fraction = dist / GRENADE_BLAST.radius;
      const dmg = Math.round(GRENADE_BLAST.inner - (GRENADE_BLAST.inner - GRENADE_BLAST.outer) * fraction);

      const wasHealth = member.player.health;
      this.damage.hurt({
        id: member.id,
        amount: dmg,
        by: p.thrower,
        cause: "explosion",
        along: {
          x: dx / Math.max(0.1, dist),
          y: dy / Math.max(0.1, dist) + 0.35,
          z: dz / Math.max(0.1, dist),
        },
      });

      if (member.player.health < wasHealth && p.thrower) {
        this.outbox.push({ kind: "hit", lethal: member.player.dead }, p.thrower, 0);
      }
    }
  }

  private detonateFlashbang(p: ActiveProjectile): void {
    const center = p.position;

    for (const member of this.roster.values()) {
      if (member.player.dead) {
        continue;
      }

      const mFeet = member.player.movement.feet;
      const eye: Vec3 = {
        x: mFeet.x,
        y: mFeet.y + eyeHeight(member.player.movement),
        z: mFeet.z,
      };

      const dx = center.x - eye.x;
      const dy = center.y - eye.y;
      const dz = center.z - eye.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist > FLASHBANG_RADIUS) {
        continue;
      }

      // Line of sight check:
      if (dist > 0.1) {
        const toFlash: Vec3 = { x: dx / dist, y: dy / dist, z: dz / dist };
        const hit = this.collision.traceRay(eye, toFlash, dist, "shots");
        if (hit !== null && hit.distance < dist - 0.25) {
          // Blocked by world geometry
          continue;
        }

        // Facing check:
        const aim = aimDirection(aimAngles(member.player.movement, null), this.aimDir);
        const dot = aim.x * toFlash.x + aim.y * toFlash.y + aim.z * toFlash.z;

        // Full strength inside `explosionRadiusMin`, falling to nothing at the edge.
        const distanceFraction = dist <= FLASHBANG_FULL_RADIUS ? 1 : 1 - (dist - FLASHBANG_FULL_RADIUS) / (FLASHBANG_RADIUS - FLASHBANG_FULL_RADIUS);
        const duration = dot >= 0.2 ? FLASHBANG_MAX_DURATION * distanceFraction : FLASHBANG_MIN_DURATION * distanceFraction;

        if (duration > 0.2) {
          member.equipment.flashedUntil = this.clock.now + duration;
          member.equipment.flashDuration = duration;

          this.outbox.push(
            {
              kind: "announce",
              what: "flashbang",
              player: member.id,
              team: null,
              value: Math.round(duration * 10),
            },
            member.id,
            0.5,
          );

          if (member.id !== p.thrower) {
            this.outbox.push({ kind: "hit", lethal: false }, p.thrower, 0);
          }
        }
      }
    }
  }
}
