// What a bullet goes through, and what it keeps, as MW3's server works it out.
//
// The depths are `info/bullet_penetration_mp` from common_mp.ff, in inches; the
// rules are read from `iw5mp_server.exe` (never run), and each says where:
//
// - `BG_GetSurfacePenetrationDepth` (0x42d270): the table at the weapon's
//   `penetrateType` and the surface, times its `penetrateMultiplier` — 1 on every
//   one of MW3's bullet weapons — and **0 for the `default` surface**, so a
//   triangle the map gave no material stops a round.
// - `Bullet_FireExtended` (0x473090): the first hit, then up to five more
//   surfaces. Each time the most it may go through is the depth at the surface
//   it entered, doubled by `perk_bulletPenetrationMultiplier` (2) for a player
//   with `specialty_bulletpenetration`, and the smaller of that and the depth at
//   the surface it leaves by (`min`, 0x40fab0). It steps 0.135 units past the
//   entry, finds the exit, and measures the thickness between the two, never
//   under one unit. `damageMultiplier -= thickness / maxDepth`; at zero or below
//   the round stops.

import type { SurfaceType } from "../sim/surfaces.js";
import { UNIT } from "../sim/units.js";

/** `penetrateType`: what a weapon's rounds are, as its file spells it. `none` goes through nothing. */
export type PenetrateType = "none" | "small" | "medium" | "large";

type DepthRow = Partial<Record<SurfaceType, number>>;

/** Inches of each surface a round of each type can go through. A surface left out is 0. */
export const PENETRATION_DEPTH: Record<Exclude<PenetrateType, "none">, DepthRow> = {
  small: {
    bark: 20,
    brick: 6,
    carpet: 20,
    cloth: 72,
    concrete: 6,
    dirt: 0,
    flesh: 24,
    foliage: 72,
    glass: 72,
    grass: 0,
    gravel: 32,
    ice: 72,
    metal: 12,
    mud: 0,
    paper: 72,
    plaster: 12,
    rock: 6,
    sand: 0,
    snow: 72,
    water: 0,
    wood: 12,
    asphalt: 6,
    ceramic: 72,
    plastic: 32,
    rubber: 72,
    cushion: 72,
    fruit: 72,
    paintedmetal: 0,
    riotshield: 0,
    slush: 0,
  },
  medium: {
    bark: 28,
    brick: 20,
    carpet: 20,
    cloth: 72,
    concrete: 12,
    dirt: 0,
    flesh: 34,
    foliage: 72,
    glass: 72,
    grass: 0,
    gravel: 32,
    ice: 72,
    metal: 20,
    mud: 0,
    paper: 72,
    plaster: 20,
    rock: 12,
    sand: 0,
    snow: 72,
    water: 0,
    wood: 16,
    asphalt: 12,
    ceramic: 72,
    plastic: 32,
    rubber: 72,
    cushion: 72,
    fruit: 72,
    paintedmetal: 0,
    riotshield: 0,
    slush: 0,
  },
  large: {
    bark: 28,
    brick: 20,
    carpet: 20,
    cloth: 72,
    concrete: 12,
    dirt: 0,
    flesh: 40,
    foliage: 72,
    glass: 72,
    grass: 0,
    gravel: 32,
    ice: 72,
    metal: 20,
    mud: 0,
    paper: 72,
    plaster: 20,
    rock: 12,
    sand: 0,
    snow: 72,
    water: 0,
    wood: 16,
    asphalt: 12,
    ceramic: 72,
    plastic: 32,
    rubber: 72,
    cushion: 72,
    fruit: 72,
    paintedmetal: 0,
    riotshield: 0,
    slush: 0,
  },
};

/** Surfaces past the first hit: the loop's bound. */
export const MAX_PENETRATIONS = 5;
/** How far past the entry the next trace starts. */
export const PENETRATION_STEP = 0.135 * UNIT;
/** The thinnest a surface is ever measured as. */
export const MIN_PENETRATION_THICKNESS = 1 * UNIT;
/** `perk_bulletPenetrationMultiplier`'s default. */
export const PERK_PENETRATION_MULTIPLIER = 2;

/**
 * How much of `surface` a round of `type` can go through, in metres: 0 for one it
 * cannot, which ends the round there. `perk` is `specialty_bulletpenetration`.
 */
export function penetrationDepth(type: string | undefined, surface: SurfaceType, perk = false): number {
  if (surface === "default" || type === undefined || type === "none") {
    return 0;
  }
  const row = PENETRATION_DEPTH[type as Exclude<PenetrateType, "none">];
  const inches = row?.[surface] ?? 0;
  return inches * UNIT * (perk ? PERK_PENETRATION_MULTIPLIER : 1);
}

/**
 * What a round keeps after going through `thickness` metres of a surface whose
 * entry and exit allow `entryDepth` and `exitDepth`: the multiplier it carries
 * on, or 0 or less where it stops.
 */
export function afterPenetration(multiplier: number, thickness: number, entryDepth: number, exitDepth: number): number {
  const maxDepth = Math.min(entryDepth, exitDepth);
  if (!(maxDepth > 0)) {
    return 0;
  }
  return multiplier - Math.max(thickness, MIN_PENETRATION_THICKNESS) / maxDepth;
}
