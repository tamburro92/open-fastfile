// How a bot plays, from Bot Warfare for MW3 (github.com/ineedbots/iw5_bot_warfare,
// by INeedGames and its contributors, whose README asks for that credit): a community
// mod that plays MW3's multiplayer through a player's own inputs, which is what a
// bot here does too. MW3 itself ships no bot AI for its multiplayer. These numbers
// are the mod authors' tuning, then, not Infinity Ward's. In game units and
// milliseconds as the mod spells them, from `maps/mp/bots/_bot_script.gsc`.

/** The lobby's four levels. */
export type BotDifficulty = "recruit" | "regular" | "hardened" | "veteran";
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ["recruit", "regular", "hardened", "veteran"];

/** Where a shot is aimed on a body, as a fraction of its eye height. Stands in for the mod's bones. */
export const AIM_HEIGHT = { head: 1, spine: 0.75, ankle: 0.1 } as const;
export type AimBone = keyof typeof AIM_HEIGHT;

export interface BotSkill {
  /** `base`: the mod's level, 1 to 7. Below 3 a bot does not listen for footsteps. */
  readonly base: number;
  /** `aim_time`, s: how long a look takes. */
  readonly aimTime: number;
  /** `init_react_time`: seen this long before it can be a target. `reaction_time`: traced this long before it is shot. */
  readonly initReact: number;
  readonly reaction: number;
  /** `no_trace_ads_time`, `no_trace_look_time`, `remember_time`: how long a target out of sight is aimed for, looked for, and known. */
  readonly noTraceAds: number;
  readonly noTraceLook: number;
  readonly remember: number;
  /** `fov`: the cosine of the view, -1 being everywhere. */
  readonly fov: number;
  /** `dist_start`, `dist_max`, units: past the first, a target takes longer to take in, and past the second, for ever. */
  readonly distStart: number;
  readonly distMax: number;
  /** `spawn_time`, s: nothing after a spawn for this long. `shoot_after_time`, s: firing on after a target is gone. `semi_time`, s: between taps. */
  readonly spawnTime: number;
  readonly shootAfter: number;
  readonly semiTime: number;
  /** `help_dist`, units: how far off a teammate may be followed. */
  readonly helpDist: number;
  /** `aim_offset_amount`, units, each way on each axis, and `aim_offset_time`, s, to correct it. */
  readonly aimOffset: number;
  readonly aimOffsetTime: number;
  /** `bones`, one picked every `bone_update_interval`, s. */
  readonly bones: readonly AimBone[];
  readonly boneInterval: number;
  /** `behavior`, percentages. */
  readonly strafe: number;
  readonly nade: number;
  readonly sprint: number;
  readonly follow: number;
  readonly crouch: number;
  readonly jump: number;
}

/** The mod's levels 1, 3, 5 and 7, for the lobby's four. */
export const BOT_SKILLS: Readonly<Record<BotDifficulty, BotSkill>> = {
  recruit: {
    base: 1, aimTime: 0.6, initReact: 1500, reaction: 1000, noTraceAds: 500, noTraceLook: 600, remember: 750, fov: 0.7,
    distStart: 1000, distMax: 2500, spawnTime: 0.75, shootAfter: 1, semiTime: 0.9, helpDist: 0, aimOffset: 4, aimOffsetTime: 1.5,
    bones: ["spine", "ankle", "ankle"], boneInterval: 2,
    strafe: 0, nade: 10, sprint: 30, follow: 5, crouch: 20, jump: 0,
  },
  regular: {
    base: 3, aimTime: 0.4, initReact: 750, reaction: 500, noTraceAds: 1000, noTraceLook: 1500, remember: 2000, fov: 0.6,
    distStart: 2250, distMax: 4000, spawnTime: 0.5, shootAfter: 0.65, semiTime: 0.65, helpDist: 750, aimOffset: 2.5, aimOffsetTime: 0.75,
    bones: ["spine", "spine", "ankle", "ankle", "head"], boneInterval: 1,
    strafe: 20, nade: 20, sprint: 50, follow: 5, crouch: 10, jump: 25,
  },
  hardened: {
    base: 5, aimTime: 0.25, initReact: 500, reaction: 300, noTraceAds: 2500, noTraceLook: 3000, remember: 4000, fov: 0.5,
    distStart: 5000, distMax: 7500, spawnTime: 0.25, shootAfter: 0.35, semiTime: 0.4, helpDist: 1500, aimOffset: 1.5, aimOffsetTime: 0.35,
    bones: ["spine", "head"], boneInterval: 0.5,
    strafe: 40, nade: 35, sprint: 60, follow: 5, crouch: 10, jump: 50,
  },
  veteran: {
    base: 7, aimTime: 0.1, initReact: 100, reaction: 50, noTraceAds: 2500, noTraceLook: 4000, remember: 7500, fov: 0.4,
    distStart: 10000, distMax: 15000, spawnTime: 0.05, shootAfter: 0, semiTime: 0.1, helpDist: 3000, aimOffset: 0, aimOffsetTime: 0,
    bones: ["head"], boneInterval: 0.05,
    strafe: 65, nade: 65, sprint: 70, follow: 5, crouch: 5, jump: 90,
  },
};

/** `_bot.gsc`'s `level.bots_*`, in units (the mod squares them). */
export const BOT_RANGE = { minGrenade: 256, maxGrenade: 1024, knife: 128, noAds: 200, maxShotgun: 500 } as const;
/** `ads_aimspeed_multi`: a look takes this much longer down the sights. `ads_fov_multi`: and the view's cosine is cut by this much. */
export const ADS_AIM_MULTI = 0.5;
export const ADS_FOV_MULTI = 0.5;
/** `SetWeaponDistMulti`: how far each class's `dist_start` and `dist_max` reach. */
const WEAPON_DIST: Readonly<Record<string, number>> = { rifle: 0.9, smg: 0.7, pistol: 0.5 };

/** The difficulty a lobby named, or regular for anything else. */
export function difficultyOf(raw: unknown): BotDifficulty {
  const named = String(raw ?? "").toLowerCase();
  return (BOT_DIFFICULTIES as readonly string[]).includes(named) ? (named as BotDifficulty) : "regular";
}

/**
 * `targetObjUpdateTraced`'s `timeMulti`: how much of a tick in sight counts. A
 * target past `dist_start` is taken in slower, and past `dist_max` never is.
 */
export function sightRate(skill: BotSkill, weaponClass: string | undefined, distUnits: number): number {
  const multi = (weaponClass !== undefined ? WEAPON_DIST[weaponClass] : undefined) ?? 1;
  const close = (skill.distStart * multi) ** 2;
  const max = (skill.distMax * multi) ** 2;
  const sq = distUnits * distUnits;
  return sq > max ? 0 : sq > close ? 1 - (sq - close) / (max - close) : 1;
}

/** `canAds`: not up close, and never with a shotgun. */
export function canAds(weaponClass: string | undefined, distUnits: number): boolean {
  return distUnits >= BOT_RANGE.noAds && weaponClass !== "spread";
}

/** `isInRange`: a shotgun holds its fire past 500 units, and walks in. */
export function inRange(weaponClass: string | undefined, distUnits: number): boolean {
  return weaponClass !== "spread" || distUnits <= BOT_RANGE.maxShotgun;
}

/** The share of the aim's remaining angle to turn in `dt`: `bot_lookat` divides it over `aim_time` and starts again every 0.05 s. */
export function aimStep(aimTime: number, dt: number): number {
  return Math.min(1, dt / Math.max(aimTime, 0.05));
}
