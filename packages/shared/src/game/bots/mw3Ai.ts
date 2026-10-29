// MW3's own rules for an AI soldier, read from its compiled scripts and weapon
// files. MW3's multiplayer has no bot AI to copy; the AI that fights on its
// multiplayer maps is Survival's, which is the campaign's actor AI with
// Survival's aitypes. `reverse/iw5-ai/extract.py` reads every number here out of
// `common.ff` (`maps/_gameskill`, `animscripts/*`) and `common_survival.ff`
// (`aitype/enemy_so_*`, the weapons and their accuracy graphs). In game units,
// inches, as the files spell them; converted where they are used.
//
// What is not in any file — the engine's side of an actor, which lives in the
// executable — is marked "engine:" where it is defined, with the reading taken.

/** MW3's four skill levels, as a lobby names them. `_gameskill` spells them easy, normal, hardened, veteran. */
export type BotDifficulty = "recruit" | "regular" | "hardened" | "veteran";
export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ["recruit", "regular", "hardened", "veteran"];

/** One skill level's row of `level.difficultySettings`, the keys an actor fighting a player reads. */
export interface GameSkill {
  /** `base_enemy_accuracy`: multiplies every enemy's accuracy. */
  readonly baseEnemyAccuracy: number;
  /** `accuracyDistScale`: multiplies the distance an accuracy graph is read at. Under 1, accurate further out. */
  readonly accuracyDistScale: number;
  /** `missTimeConstant`, s: how long an enemy misses the player on purpose once it starts shooting at them. */
  readonly missTimeConstant: number;
  /** `missTimeDistanceFactor`, s per unit: and how much longer, the further off the player is. */
  readonly missTimeDistanceFactor: number;
  /** `playerGrenadeBaseTime` and `playerGrenadeRangeTime`, s (ms in the file): the wait between grenades at one player. */
  readonly grenadeBaseTime: number;
  readonly grenadeRangeTime: number;
  /** `min_sniper_burst_delay_time` and `max_...`, s: the pause between a sniper's shots. */
  readonly sniperBurstDelay: readonly [number, number];
}

/** `maps/_gameskill`, `level.difficultySettings[ key ][ "easy" | "normal" | "hardened" | "veteran" ]`. */
export const GAMESKILL: Readonly<Record<BotDifficulty, GameSkill>> = {
  recruit: {
    baseEnemyAccuracy: 0.9,
    accuracyDistScale: 1.0,
    missTimeConstant: 1.0,
    missTimeDistanceFactor: 0.0008,
    grenadeBaseTime: 40,
    grenadeRangeTime: 20,
    sniperBurstDelay: [3.0, 4.0],
  },
  regular: {
    baseEnemyAccuracy: 1.0,
    accuracyDistScale: 1.0,
    missTimeConstant: 0.05,
    missTimeDistanceFactor: 0.0001,
    grenadeBaseTime: 35,
    grenadeRangeTime: 15,
    sniperBurstDelay: [2.0, 3.0],
  },
  hardened: {
    baseEnemyAccuracy: 1.15,
    accuracyDistScale: 0.6,
    missTimeConstant: 0,
    missTimeDistanceFactor: 0.00005,
    grenadeBaseTime: 25,
    grenadeRangeTime: 10,
    sniperBurstDelay: [1.5, 2.0],
  },
  veteran: {
    baseEnemyAccuracy: 1.15,
    accuracyDistScale: 0.8,
    missTimeConstant: 0,
    missTimeDistanceFactor: 0,
    grenadeBaseTime: 25,
    grenadeRangeTime: 10,
    sniperBurstDelay: [1.1, 1.5],
  },
};

/** Survival's soldier: `aitype/enemy_so_easy`, `_regular`, `_hardened` and `_veteran` set the same, and differ in weapons only. */
export const SURVIVAL_SOLDIER = {
  /** `self.accuracy`. */
  accuracy: 0.2,
  /** `self setEngagementMinDist( 256, 0 )`: no closer than this to its enemy, by choice. */
  engageMinDist: 256,
  /** `self setEngagementMaxDist( 768, 1024 )`: no further than this, and closes in from beyond the falloff. */
  engageMaxDist: 768,
  engageMaxFalloff: 1024,
} as const;

/** `animscripts/shoot_behavior`: the squared distances 62500, 810000 and 2560000 that pick a shoot style. */
export const SHOOT_STYLE_RANGE = { full: 250, burst: 900, far: 1600 } as const;

/** How an actor fires: everything it has, bursts, single taps, or one aimed shot at a time. */
export type ShootStyle = "full" | "burst" | "semi" | "single";

/**
 * `animscripts/init`: `anim.burstFireNumShots` and `anim.semiFireNumShots`, the
 * shots in one burst, one picked at random. `animscripts/shared` reads the semi
 * table for a semi-automatic weapon and the burst table otherwise.
 */
export const BURST_FIRE_NUM_SHOTS: readonly number[] = [1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5];
export const SEMI_FIRE_NUM_SHOTS: readonly number[] = [1, 2, 2, 3, 3, 4, 4, 4, 4, 5, 5, 5];

/**
 * `animscripts/combat_utility`: the pause after a burst, `randomFloatRange` of
 * these, s. A sniper's comes from `GAMESKILL`. Which test guards the first two
 * is a call into another script; their order in the function is pistol, then
 * shotgun, as the burst tables are read.
 */
export const BURST_DELAY = {
  pistol: [0.15, 0.55],
  shotgun: [1.0, 1.7],
  other: [0.4, 0.9],
} as const;

/** `animscripts/melee`: the squared distance 4096 within which an actor's blow lands. */
export const MELEE_RANGE = 64;

/** A weapon's AI accuracy graph, vs a player: (distance fraction, chance) knots. */
export type AccuracyGraph = readonly (readonly [number, number])[];

/** `accuracy/aivsplayer/*.accu`, the graphs Survival's weapons name. */
export const AI_VS_PLAYER_GRAPHS = {
  assault_rifle: [[0, 0.6], [0.35, 0.5], [0.5, 0.2], [1, 0.1]],
  mg: [[0, 0.6], [0.3, 0.3], [0.5, 0.15], [1, 0.1]],
  pistol: [[0, 0.8], [0.05, 0.8], [0.3, 0.5], [0.6, 0.1], [1, 0.05]],
  rpg: [[0, 1], [0.2517, 0.7003], [0.5006, 0.2002], [1, 0.0507]],
  shotgun: [[0, 0.9], [0.15, 0.8], [0.25, 0.4], [0.5, 0.1], [1, 0.02]],
  smg: [[0, 0.7], [0.05, 0.6], [0.25, 0.4], [0.45, 0.2], [1, 0.1]],
  sniper_rifle: [[0, 0.9], [0.5, 0.5], [1, 0.3]],
  default: [[0, 1], [1, 0]],
} as const satisfies Record<string, AccuracyGraph>;

/**
 * Per `weaponClass`, the graph Survival's weapons of that class name
 * (`aiVsPlayerAccuracyGraph`) and their `maxDist`. Engine: the graph's x is read
 * as the distance over `maxDist`, which is what makes 1.0 a different range for
 * a pistol (250) and a sniper rifle (730).
 */
export const WEAPON_CLASS_AI: Readonly<Record<string, { readonly graph: keyof typeof AI_VS_PLAYER_GRAPHS; readonly maxDist: number }>> = {
  rifle: { graph: "assault_rifle", maxDist: 590 },
  mg: { graph: "mg", maxDist: 590 },
  smg: { graph: "smg", maxDist: 340 },
  spread: { graph: "shotgun", maxDist: 680 },
  sniper: { graph: "sniper_rifle", maxDist: 730 },
  pistol: { graph: "pistol", maxDist: 250 },
  rocketlauncher: { graph: "rpg", maxDist: 1400 },
};
const DEFAULT_CLASS = WEAPON_CLASS_AI.rifle!;

/** The difficulty a lobby named, or regular for anything else. */
export function difficultyOf(raw: unknown): BotDifficulty {
  const named = String(raw ?? "").toLowerCase();
  return (BOT_DIFFICULTIES as readonly string[]).includes(named) ? (named as BotDifficulty) : "regular";
}

/** A graph's value at `x`, linear between knots and held past the ends. */
export function graphAt(graph: AccuracyGraph, x: number): number {
  if (x <= graph[0]![0]) {
    return graph[0]![1];
  }
  for (let i = 1; i < graph.length; i++) {
    const [x1, y1] = graph[i]!;
    if (x <= x1) {
      const [x0, y0] = graph[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return graph[graph.length - 1]![1];
}

/**
 * The chance one shot hits its target: the soldier's accuracy, the skill's
 * `base_enemy_accuracy`, and the weapon's graph at the distance scaled by
 * `accuracyDistScale`. Engine: the three multiply.
 */
export function hitChance(difficulty: BotDifficulty, weaponClass: string | undefined, distanceUnits: number): number {
  const skill = GAMESKILL[difficulty];
  const weapon = (weaponClass !== undefined ? WEAPON_CLASS_AI[weaponClass] : undefined) ?? DEFAULT_CLASS;
  const x = Math.min(1, (distanceUnits * skill.accuracyDistScale) / weapon.maxDist);
  return Math.min(1, SURVIVAL_SOLDIER.accuracy * skill.baseEnemyAccuracy * graphAt(AI_VS_PLAYER_GRAPHS[weapon.graph], x));
}

/** Seconds of deliberate misses once it opens fire on a target this far off. */
export function missTime(difficulty: BotDifficulty, distanceUnits: number): number {
  const skill = GAMESKILL[difficulty];
  return skill.missTimeConstant + distanceUnits * skill.missTimeDistanceFactor;
}

/**
 * `animscripts/shoot_behavior`'s choice by distance: everything up close, bursts
 * (taps with a semi-automatic) to 900, bursts to 1600, and one shot beyond — an
 * MG bursts at any range. A sniper rifle fires single shots.
 */
export function shootStyle(distanceUnits: number, weaponClass: string | undefined, semiAuto: boolean): ShootStyle {
  if (weaponClass === "sniper") {
    return "single";
  }
  if (distanceUnits < SHOOT_STYLE_RANGE.full) {
    return semiAuto ? "semi" : "full";
  }
  if (distanceUnits < SHOOT_STYLE_RANGE.burst) {
    return semiAuto ? "semi" : "burst";
  }
  if (weaponClass === "mg" || distanceUnits < SHOOT_STYLE_RANGE.far) {
    return semiAuto ? "semi" : "burst";
  }
  return "single";
}

/** Shots in the next burst of a style: `full` is every round there is, and `single` is one. */
export function burstShots(style: ShootStyle, rng: () => number): number {
  if (style === "full") {
    return Infinity;
  }
  if (style === "single") {
    return 1;
  }
  const table = style === "semi" ? SEMI_FIRE_NUM_SHOTS : BURST_FIRE_NUM_SHOTS;
  return table[Math.min(table.length - 1, Math.floor(rng() * table.length))]!;
}

/** The pause after a burst, s. */
export function burstDelay(difficulty: BotDifficulty, weaponClass: string | undefined, rng: () => number): number {
  const [min, max] =
    weaponClass === "pistol"
      ? BURST_DELAY.pistol
      : weaponClass === "spread"
        ? BURST_DELAY.shotgun
        : weaponClass === "sniper"
          ? GAMESKILL[difficulty].sniperBurstDelay
          : BURST_DELAY.other;
  return min + (max - min) * rng();
}

/** The wait before this soldier throws its next grenade at a player, s. */
export function grenadeWait(difficulty: BotDifficulty, rng: () => number): number {
  const skill = GAMESKILL[difficulty];
  return skill.grenadeBaseTime + skill.grenadeRangeTime * rng();
}
