// MW3's own numbers for what a player throws and calls in, read from the weapon
// files in its companion zone (`frag_grenade_mp`, `semtex_mp`,
// `flash_grenade_mp`, `sentry_minigun_mp`, `remotemissile_projectile_mp` under
// `.cache/cod/catalog-mw3/weapons/weapons/`). In the game's units, inches, as
// the files spell them, and converted where they are used.
//
// Three are not in any weapon file — a sentry's lifetime, a UAV's and how fast
// a predator falls — because MW3 keeps them in its killstreak scripts, which the
// companion zone does not ship. Those carry MW3's published values and say so.

import type { SurfaceType } from "../sim/surfaces.js";
import { UNIT } from "../sim/units.js";

/** `projectileSpeed` and `projectileSpeedUp`: the same for all three grenades. */
export const GRENADE_THROW_SPEED = 940 * UNIT;
export const GRENADE_THROW_LOFT = 120 * UNIT;

/** `fuseTime`. */
export const FUSE = { frag: 3.5, semtex: 2.0, flashbang: 1.5 } as const;

/**
 * A press, in two parts: `holdFireTime`, the pin coming out before the grenade
 * leaves, then `fireTime`, the arm coming through after it, before anything
 * else may be thrown. The first-person clips are timed to the same two.
 */
export const THROW_TIMES = {
  frag: { holdFire: 0.6, fire: 0.36 },
  semtex: { holdFire: 0.6, fire: 0.36 },
  flashbang: { holdFire: 0.6, fire: 0.699 },
} as const;

/** `explosionRadius`, `explosionInnerDamage`, `explosionOuterDamage`: frag and semtex alike. */
export const GRENADE_BLAST = { radius: 256 * UNIT, inner: 130, outer: 55 } as const;
/** The flashbang's: `explosionRadius` 800, `explosionRadiusMin` 200. */
export const FLASHBANG_RADIUS = 800 * UNIT;
export const FLASHBANG_FULL_RADIUS = 200 * UNIT;

/**
 * How much of its speed a grenade keeps off a surface, along it and away from it
 * (`parallel<Surface>Bounce`, `perpendicular<Surface>Bounce`). The three grenade
 * files carry the same table. A surface left out is `default`'s.
 */
export const GRENADE_BOUNCE: Partial<Record<SurfaceType, { parallel: number; perpendicular: number }>> & {
  default: { parallel: number; perpendicular: number };
} = {
  default: { parallel: 0.5, perpendicular: 0.25 },
  bark: { parallel: 0.6, perpendicular: 0.25 },
  brick: { parallel: 0.6, perpendicular: 0.25 },
  carpet: { parallel: 0.6, perpendicular: 0.25 },
  cloth: { parallel: 0.2, perpendicular: 0.2 },
  concrete: { parallel: 0.6, perpendicular: 0.25 },
  dirt: { parallel: 0.45, perpendicular: 0.225 },
  flesh: { parallel: 0.2, perpendicular: 0.2 },
  foliage: { parallel: 0.05, perpendicular: 0.05 },
  glass: { parallel: 0.4, perpendicular: 0.2 },
  grass: { parallel: 0.35, perpendicular: 0.15 },
  gravel: { parallel: 0.5, perpendicular: 0.25 },
  ice: { parallel: 0.6, perpendicular: 0.3 },
  metal: { parallel: 0.6, perpendicular: 0.25 },
  mud: { parallel: 0.2, perpendicular: 0.1 },
  paper: { parallel: 0.2, perpendicular: 0.2 },
  plaster: { parallel: 0.5, perpendicular: 0.25 },
  rock: { parallel: 0.6, perpendicular: 0.25 },
  sand: { parallel: 0.3, perpendicular: 0.1 },
  snow: { parallel: 0.2, perpendicular: 0.1 },
  water: { parallel: 0.2, perpendicular: 0.2 },
  wood: { parallel: 0.6, perpendicular: 0.25 },
  asphalt: { parallel: 0.6, perpendicular: 0.25 },
  ceramic: { parallel: 0.5, perpendicular: 0 },
  plastic: { parallel: 0.5, perpendicular: 0 },
  rubber: { parallel: 0.5, perpendicular: 0 },
  cushion: { parallel: 0.5, perpendicular: 0.5 },
  fruit: { parallel: 0.5, perpendicular: 0.5 },
  paintedmetal: { parallel: 0.5, perpendicular: 0.5 },
  riotshield: { parallel: 0.5, perpendicular: 0.5 },
  slush: { parallel: 0.5, perpendicular: 0.5 },
};

export function grenadeBounce(surface: SurfaceType): { parallel: number; perpendicular: number } {
  return GRENADE_BOUNCE[surface] ?? GRENADE_BOUNCE.default;
}

/** `bounceSound`: a prefix the surface completes, `grenade_bounce_concrete`, falling back to `_default`. */
export const GRENADE_BOUNCE_SOUND = "grenade_bounce";
/** `projIgnitionSound`: what a stuck semtex says while its fuse burns. */
export const SEMTEX_WARNING_SOUND = "semtex_warning";

/**
 * `sentry_minigun_mp`. `playerDamage` is what a round costs a player; `fireTime`
 * is between rounds; the arcs are either side of the way it was set down
 * facing; the turn speeds are degrees a second.
 */
export const SENTRY = {
  playerDamage: 10,
  fireTime: 0.05,
  maxRange: 1800 * UNIT,
  leftArc: 55,
  rightArc: 55,
  topArc: 45,
  bottomArc: 20,
  maxHorTurnSpeed: 60,
  maxVertTurnSpeed: 200,
  loopFireSound: "sentry_minigun_fire",
  stopFireSound: "sentry_minigun_cooldown",
  /** Not in the weapon file: `_autosentry.gsc`'s timeout. */
  lifetime: 90,
} as const;

/** `remotemissile_projectile_mp`'s blast, and what it is heard and drawn as. */
export const PREDATOR = {
  radius: 450 * UNIT,
  inner: 1000,
  outer: 10,
  explosionSound: "exp_remote_missile",
  model: "projectile_javelin_missile",
} as const;

/** Not in a weapon file: `_uav.gsc`'s. */
export const UAV_DURATION = 30;

/**
 * A heartbeat sensor: whom it shows, and how often it sweeps. **Not MW3's own
 * numbers.** The game keeps them as `motionTracker*` dvars in its executable,
 * which this install does not carry; these are the commonly cited defaults and
 * are to be replaced the day the executable is read.
 */
export const HEARTBEAT = {
  range: 1600 * UNIT,
  sweep: 3,
} as const;
