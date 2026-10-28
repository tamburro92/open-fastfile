// Melee combat: authentic Call of Duty: Modern Warfare 3 knife melee.
//
// Deal 135 damage (1-hit kill on standard 100 HP), reach 2.0 meters, cooldown 0.66s.
// Traced authoritatively on the server, checking distance, facing cone, and line-of-sight
// against level geometry.

import type { InputMessage } from "@3d/shared/net/messages/input.js";
import type { CapsuleWorld, Vec3 } from "@3d/shared/sim/capsule.js";
import { eyeHeight } from "@3d/shared/sim/stance.js";
import { aimAngles, aimDirection } from "@3d/shared/sim/recoil.js";
import type { MatchClock } from "./clock.js";
import type { Damage } from "./damage.js";
import type { EventOutbox } from "./outbox.js";
import type { Member, Roster } from "./roster.js";

/** Authentic MW3 melee parameters: */
export const MELEE_DAMAGE = 135;
export const MELEE_RANGE = 2.0; // 2.0 meters reach
export const MELEE_COOLDOWN = 0.66; // 0.66s cooldown
export const MELEE_CONE_DOT = 0.5; // ~60 degree angle tolerance

export class Melee {
  private readonly aimDir: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly clock: MatchClock,
    private readonly roster: Roster,
    private readonly damage: Damage,
    private readonly outbox: EventOutbox,
    private readonly collision: CapsuleWorld,
  ) {}

  /**
   * Execute a melee attack from `member` based on their current input step.
   */
  attack(member: Member, _message: InputMessage): void {
    if (member.player.dead) {
      return;
    }

    const now = this.clock.now;
    if (now - member.equipment.lastMeleeAt < MELEE_COOLDOWN) {
      return;
    }
    member.equipment.lastMeleeAt = now;

    const shooter = member.id;
    const movement = member.player.movement;
    const up = eyeHeight(movement);
    const eye: Vec3 = { x: movement.feet.x, y: movement.feet.y + up, z: movement.feet.z };
    const aim = aimDirection(aimAngles(movement, null), this.aimDir);

    let bestTarget: Member | null = null;
    let bestScore = -Infinity;

    for (const target of this.roster.values()) {
      if (target.id === shooter || target.player.dead) {
        continue;
      }

      const targetMovement = target.player.movement;
      const targetUp = eyeHeight(targetMovement) * 0.6;
      const targetCenter: Vec3 = {
        x: targetMovement.feet.x,
        y: targetMovement.feet.y + targetUp,
        z: targetMovement.feet.z,
      };

      const dx = targetCenter.x - eye.x;
      const dy = targetCenter.y - eye.y;
      const dz = targetCenter.z - eye.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist > MELEE_RANGE || dist < 0.01) {
        continue;
      }

      const dirX = dx / dist;
      const dirY = dy / dist;
      const dirZ = dz / dist;

      const dot = aim.x * dirX + aim.y * dirY + aim.z * dirZ;
      if (dot < MELEE_CONE_DOT) {
        continue;
      }

      // Check wall occlusion:
      const hit = this.collision.traceRay(eye, { x: dirX, y: dirY, z: dirZ }, dist, "shots");
      if (hit !== null && hit.distance < dist - 0.2) {
        // Wall between attacker and target
        continue;
      }

      // Score by combination of alignment and closeness
      const score = dot * 2 - dist / MELEE_RANGE;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = target;
      }
    }

    if (bestTarget) {
      const mayHurt = this.damage.mayHurt(bestTarget.id, shooter);
      if (mayHurt) {
        const wasHealth = bestTarget.player.health;
        this.damage.hurt({
          id: bestTarget.id,
          amount: MELEE_DAMAGE,
          by: shooter,
          cause: "melee",
        });

        if (bestTarget.player.health < wasHealth) {
          this.outbox.push({ kind: "hit", lethal: bestTarget.player.dead }, shooter, 0);
        }
      }

      this.outbox.push(
        {
          kind: "announce",
          what: "melee_hit",
          player: shooter,
          team: null,
          value: MELEE_DAMAGE,
        },
        null,
        0.5,
      );
    } else {
      this.outbox.push(
        {
          kind: "announce",
          what: "melee_swing",
          player: shooter,
          team: null,
          value: 0,
        },
        null,
        0.5,
      );
    }
  }
}
