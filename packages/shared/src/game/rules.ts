// What combat costs: the numbers a script sets, and the arithmetic the engine
// does with them.
//
// The split is Call of Duty's own rather than an analogy of it. The engine owns
// the health field, the trace and this arithmetic; a script owns the numbers and
// hears about the outcome through `playerDamage` and `playerDeath` —
// `Callback_PlayerDamage` and `Callback_PlayerKilled` over `_health.gsc`. So a
// gametype changes what a round costs without touching the thing that decides a
// round landed, and a match with no script at all still plays by the defaults
// below, exactly as `Spawns.place` and `castFor` degrade to theirs.

import type { HitLocation } from "../sim/hitLocations.js";
import { DEFAULT_HEALTH } from "../sim/player.js";
import { UNIT } from "../sim/units.js";
import type { WeaponDef } from "../sim/weaponDef.js";

/** The numbers a gametype plays by. Asked of the scripts once, at match start. */
export interface CombatRules {
  /** Full health, and what a spawn gives back. Capped by the wire at 1023 (net/messages/player.ts). */
  maxHealth: number;
  /** Seconds after the last hit before health starts coming back. */
  regenDelay: number;
  /** Health a second once it does. */
  regenRate: number;
  /** Whether a round from a teammate costs anything. Never gates self-damage: see `Match.mayHurt`. */
  friendlyFire: boolean;
  /**
   * Seconds a body waits before it is put back on a spawn. Clamped to
   * `COMBAT_TIMER_MAX`, which is what the wire can carry a countdown over.
   *
   * Null: the engine never puts anybody back. A dead player stays dead until a
   * script's `ServerContext.respawn` — a round-based mode's "wait for the next
   * round" — and the countdown a client shows is not a number at all.
   */
  respawnDelay: number | null;
  /**
   * What every bullet's damage is multiplied by. A gametype's dial for hardcore
   * or for a one-shot mode, applied to the arithmetic below and **not** to a
   * number a script names itself through `ServerContext.damage` — a script
   * asking for 30 gets 30, since it already knows its own scale.
   */
  damageScale: number;
}

/**
 * What combat costs where nobody has said otherwise.
 *
 * The games' own core figures: a hundred health, regeneration about five seconds
 * after the last hit and filling in a couple, no friendly fire, and a few seconds
 * on the floor before a respawn.
 */
export const DEFAULT_COMBAT_RULES: CombatRules = {
  maxHealth: DEFAULT_HEALTH,
  regenDelay: 5,
  regenRate: 50,
  friendlyFire: false,
  respawnDelay: 3,
  damageScale: 1,
};

/** CoD units to the metre — inches (scripts/cod/units.py). Every range in a weapon file is in these. */

/**
 * What a round takes off where its weapon file said nothing at all.
 *
 * Every field of `WeaponDef.damage` is optional: the block arrived at format 4,
 * so a weapon read out of an older GLB — or built by hand in a test — carries
 * none of it. Treating that as zero would leave a weapon that fires, reloads,
 * runs dry and never hurts anybody, which is the kind of wrong answer nothing
 * complains about. So absent means "this file did not say" and the fallback is an
 * ordinary rifle's body shot, which kills in four. It is the same reading
 * `WeaponLocationDamage` already documents for a missing location.
 */
export const UNSPECIFIED_DAMAGE = 30;

/**
 * What a round's range alone leaves it, as a whole number: MW3's
 * `Bullet_CalcDamage` (iw5mp_server.exe 0x472230), in its own order.
 *
 * `damage` out to `maxDamageRange`, `minDamage` from `minDamageRange` on, and
 * between the two a straight interpolation **truncated** to an integer. The
 * distance is from where the round was fired to where it landed — through every
 * wall it went through on the way. Worked in CoD units and single-precision
 * floats where the game stores one, because truncation makes the last bit count:
 * a round that lands on 26.99999 is 26.
 */
export function rangeDamage(def: WeaponDef | undefined, distance: number): number {
  const damage = def?.damage;
  const max = Math.trunc(damage?.max ?? UNSPECIFIED_DAMAGE);
  const min = Math.trunc(damage?.min ?? max);
  if (max === min) {
    return max;
  }
  const near = Math.fround(damage?.maxRange ?? 0);
  const far = Math.fround(damage?.minRange ?? 0);
  const units = Math.fround(distance / UNIT);
  if (units < near) {
    return max;
  }
  if (far <= units) {
    return min;
  }
  const t = Math.fround((units - near) / Math.fround(far - near));
  return Math.trunc(Math.fround((1 - t) * max + t * min));
}

/**
 * What one round on `location` from `distance` metres away costs, having kept
 * `carried` of itself through whatever it penetrated on the way (1 for none).
 *
 * MW3's three truncations, read from its server: the range's
 * (`rangeDamage`), the penetration's (`Bullet_CalcDamage` again: the integer
 * times `damageMultiplier`, truncated), and the location's — the weapon's
 * `loc*` times `info/mp_lochit_dmgtable`, which is 1 everywhere, applied by the
 * player damage path (0x480d50) and truncated once more. A round whose
 * penetration left it nothing does nothing; one that reaches a body always costs
 * at least 1, even on a location the weapon scores at 0, because that path says
 * so. An ACR's head is `trunc(1.4f × 45)`, 62 and not 63: 1.4 is a float
 * there, and 1.4f × 45 is 62.99999.
 *
 * Then the gametype's scale, which is this engine's and not MW3's: 1 unless a
 * script says otherwise.
 */
export function shotDamage(def: WeaponDef | undefined, location: HitLocation, distance: number, rules: CombatRules, carried = 1): number {
  const reached = Math.trunc(Math.fround(carried) * rangeDamage(def, distance));
  if (reached <= 0) {
    return 0;
  }
  const multiplier = Math.fround(def?.locationDamage?.[location] ?? 1);
  return Math.max(1, Math.trunc(multiplier * reached)) * rules.damageScale;
}
