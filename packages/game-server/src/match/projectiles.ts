// Authoritative simulation of lethal and tactical equipment projectiles in Call of Duty: Modern Warfare 3.
//
// Models:
// - Frag Grenade (`frag_grenade_mp`): 3.5s fuse, cookable/throwable, parabolic trajectory with bounce,
//   6.5m blast radius, 130 inner damage to 55 outer damage, line-of-sight occlusion.
// - Semtex (`semtex_mp`): 2.0s fuse, sticks to surfaces and players, warning beeps, 6.5m blast radius.
// - Flashbang (`flash_grenade_mp`): 1.5s fuse, 20m radius, facing angle check (up to 3.5s blind if looking,
//   1.0s blind if facing away), line-of-sight occlusion.

import type { PlayerId } from "@3d/shared/net/messages/fields.js";
import type { InputMessage } from "@3d/shared/net/messages/input.js";
import type { CapsuleWorld, Vec3 } from "@3d/shared/sim/capsule.js";
import { eyeHeight } from "@3d/shared/sim/stance.js";
import { aimAngles, aimDirection } from "@3d/shared/sim/recoil.js";
import type { LethalEquipmentId } from "@3d/shared/sim/loadout.js";
import type { MatchClock } from "./clock.js";
import type { Damage } from "./damage.js";
import type { EventOutbox } from "./outbox.js";
import type { Member, Roster } from "./roster.js";

export const GRENADE_THROW_SPEED = 20.0; // m/s
export const GRENADE_UPWARD_LOFT = 2.0; // m/s
export const GRENADE_GRAVITY = -15.0; // m/s^2 parabolic gravity
export const GRENADE_BLAST_RADIUS = 6.5; // meters (256 units in MW3)
export const GRENADE_INNER_DAMAGE = 130;
export const GRENADE_OUTER_DAMAGE = 55;
export const GRENADE_DANGER_RADIUS = 8.0; // meters for HUD danger indicator

export const FLASHBANG_RADIUS = 20.0; // meters (800 units in MW3)
export const FLASHBANG_MAX_DURATION = 3.5; // seconds
export const FLASHBANG_MIN_DURATION = 1.0; // seconds

export type ProjectileKind = "frag" | "semtex" | "flashbang";

export interface ActiveProjectile {
  readonly id: number;
  readonly kind: ProjectileKind;
  readonly thrower: PlayerId;
  position: Vec3;
  velocity: Vec3;
  fuseRemaining: number;
  lastBeepRemaining: number;
  stuckToPlayer?: PlayerId;
  stuckOffset?: Vec3;
  settled: boolean;
}

export class Projectiles {
  private readonly active: ActiveProjectile[] = [];
  private nextId = 1;
  private readonly aimDir: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly clock: MatchClock,
    private readonly roster: Roster,
    private readonly damage: Damage,
    private readonly outbox: EventOutbox,
    private readonly collision: CapsuleWorld,
  ) {}

  get live(): readonly ActiveProjectile[] {
    return this.active;
  }

  /**
   * Throw lethal equipment (Frag or Semtex).
   */
  throwLethal(member: Member, _message: InputMessage): void {
    if (member.player.dead || member.equipment.lethalCount <= 0) {
      return;
    }

    const type: LethalEquipmentId = member.equipment.lethal ?? "frag_grenade_mp";
    member.equipment.lethalCount--;

    const kind: ProjectileKind = type === "semtex_mp" ? "semtex" : "frag";
    const fuseTime = kind === "semtex" ? 2.0 : 3.5;

    this.spawnProjectile(member, kind, fuseTime);
  }

  /**
   * Throw tactical equipment (Flashbang).
   */
  throwTactical(member: Member, _message: InputMessage): void {
    if (member.player.dead || member.equipment.tacticalCount <= 0) {
      return;
    }

    member.equipment.tacticalCount--;

    const kind: ProjectileKind = "flashbang";
    const fuseTime = 1.5;

    this.spawnProjectile(member, kind, fuseTime);
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

    // Initial velocity along aim with slight upward loft
    const velocity: Vec3 = {
      x: aim.x * GRENADE_THROW_SPEED,
      y: aim.y * GRENADE_THROW_SPEED + GRENADE_UPWARD_LOFT,
      z: aim.z * GRENADE_THROW_SPEED,
    };

    const projectile: ActiveProjectile = {
      id: this.nextId++,
      kind,
      thrower: member.id,
      position,
      velocity,
      fuseRemaining: fuseTime,
      lastBeepRemaining: fuseTime,
      settled: false,
    };

    this.active.push(projectile);

    this.outbox.push(
      {
        kind: "announce",
        what: `${kind}_throw`,
        player: member.id,
        team: null,
        value: 0,
      },
      null,
      0.5,
    );
  }

  /**
   * Step all active projectiles across match dt.
   */
  step(dt: number): void {
    if (this.active.length === 0) {
      return;
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i]!;
      p.fuseRemaining -= dt;

      // Handle Semtex beeps
      if (p.kind === "semtex") {
        if (p.lastBeepRemaining - p.fuseRemaining >= 0.5) {
          p.lastBeepRemaining = p.fuseRemaining;
          this.outbox.push(
            {
              kind: "announce",
              what: "semtex_beep",
              player: p.thrower,
              team: null,
              value: Math.round(p.fuseRemaining * 10),
            },
            null,
            0.4,
          );
        }
      }

      // Check detonation
      if (p.fuseRemaining <= 0) {
        this.detonate(p);
        this.active.splice(i, 1);
        continue;
      }

      // Check grenade danger indication for nearby players
      if (p.kind === "frag" || p.kind === "semtex") {
        this.checkDangerToPlayers(p);
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
        const distToTarget = Math.hypot(
          targetCenter.x - p.position.x,
          targetCenter.y - p.position.y,
          targetCenter.z - p.position.z,
        );
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
      p.position.x += dir.x * hit.distance + hit.normal.x * 0.02;
      p.position.y += dir.y * hit.distance + hit.normal.y * 0.02;
      p.position.z += dir.z * hit.distance + hit.normal.z * 0.02;

      if (p.kind === "semtex") {
        // Semtex sticks to the wall/floor immediately
        p.velocity = { x: 0, y: 0, z: 0 };
        p.settled = true;
        return;
      }

      // Frag or Flashbang: bounce with restitution
      const normal = hit.normal;
      const vDotN = p.velocity.x * normal.x + p.velocity.y * normal.y + p.velocity.z * normal.z;

      // Normal restitution 0.45, friction 0.65
      const restitution = 0.45;
      const friction = 0.65;

      p.velocity.x = (p.velocity.x - vDotN * normal.x) * friction - normal.x * vDotN * restitution;
      p.velocity.y = (p.velocity.y - vDotN * normal.y) * friction - normal.y * vDotN * restitution;
      p.velocity.z = (p.velocity.z - vDotN * normal.z) * friction - normal.z * vDotN * restitution;

      const speed = Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z);

      if (speed > 2.0) {
        this.outbox.push(
          {
            kind: "announce",
            what: "grenade_bounce",
            player: p.thrower,
            team: null,
            value: Math.round(speed),
          },
          null,
          0.3,
        );
      } else if (speed < 0.4) {
        p.velocity = { x: 0, y: 0, z: 0 };
        p.settled = true;
      }
    } else {
      p.position.x += dx;
      p.position.y += dy;
      p.position.z += dz;
    }
  }

  private checkDangerToPlayers(p: ActiveProjectile): void {
    for (const member of this.roster.values()) {
      if (member.player.dead) {
        continue;
      }

      const mFeet = member.player.movement.feet;
      const dx = p.position.x - mFeet.x;
      const dy = p.position.y - mFeet.y;
      const dz = p.position.z - mFeet.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist <= GRENADE_DANGER_RADIUS) {
        // Calculate relative angle to member's view yaw:
        const angleToGrenade = Math.atan2(-dx, -dz);
        let relAngle = angleToGrenade - member.player.movement.yaw;
        while (relAngle > Math.PI) {
          relAngle -= 2 * Math.PI;
        }
        while (relAngle < -Math.PI) {
          relAngle += 2 * Math.PI;
        }

        const deg = Math.round((relAngle * 180) / Math.PI);

        this.outbox.push(
          {
            kind: "announce",
            what: "grenade_danger",
            player: member.id,
            team: null,
            value: deg,
          },
          member.id,
          0.25,
        );
      }
    }
  }

  private detonate(p: ActiveProjectile): void {
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

      if (dist > GRENADE_BLAST_RADIUS) {
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
      const fraction = dist / GRENADE_BLAST_RADIUS;
      const dmg = Math.round(
        GRENADE_INNER_DAMAGE - (GRENADE_INNER_DAMAGE - GRENADE_OUTER_DAMAGE) * fraction,
      );

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

    this.outbox.push(
      {
        kind: "announce",
        what: "explosion",
        player: p.thrower,
        team: null,
        value: 0,
      },
      null,
      0.5,
    );
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

        const distanceFraction = 1.0 - dist / FLASHBANG_RADIUS;
        const duration =
          dot >= 0.2
            ? FLASHBANG_MAX_DURATION * distanceFraction
            : FLASHBANG_MIN_DURATION * distanceFraction;

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

    this.outbox.push(
      {
        kind: "announce",
        what: "flashbang_explode",
        player: p.thrower,
        team: null,
        value: 0,
      },
      null,
      0.5,
    );
  }
}
