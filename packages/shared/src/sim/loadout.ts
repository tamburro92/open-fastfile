// A class: the two weapons a player spawns carrying, and what is fitted to each.
//
// Plain data, like everything else in sim/. The api stores one of these per slot
// per user, the client edits them, and a game order carries the chosen one to
// whichever instance is hosting — so this is the one description of what a
// player brings to a match, and all three ends are built from it.
//
// **Attachments are named here, not numbered.** A snapshot carries a fitted
// attachment as its slot in the weapon's list, because it goes out sixty times a
// second (net/messages/player.ts); a stored class carries ids, because it
// outlives the catalogue that gave those slots their numbers. Rebuilding the
// catalogue renumbers the slots and must not silently refit anybody's gun.
// `fittedSlots` is the one place the two meet.

import type { AttachmentId, WeaponId } from "./weaponRegistry.js";

/**
 * The two weapons a class carries, in the order they are held.
 *
 * The order is the format: `PlayerState.swapping` says "the other one", which is
 * only unambiguous while there are two. A third would need a slot on the wire.
 */
export const LOADOUT_SLOTS = ["primary", "secondary"] as const;
export type LoadoutSlot = (typeof LOADOUT_SLOTS)[number];

/** One weapon in a class: which, and what is fitted to it. */
export interface LoadoutWeapon {
  /** A catalogue id, or null for a slot left empty. */
  weapon: WeaponId | null;
  /** Attachment ids, in no significant order — `resolveWeapon` applies them in the catalogue's. */
  attachments: AttachmentId[];
}

/**
 * The games a class may be built from, in the order the menu offers them. A class
 * belongs to one, and carries only that game's weapons (`mayCarry`), so a player
 * is built as a soldier of one game rather than from parts of five.
 */
export const LOADOUT_GAMES = [
  { id: "iw4", name: "MW2" },
  { id: "iw5", name: "MW3" },
  { id: "t5", name: "BO1" },
  { id: "s1", name: "AW" },
  { id: "iw6", name: "Ghosts" },
] as const;

export type LethalEquipmentId = "frag_grenade_mp" | "semtex_mp";
export type TacticalEquipmentId = "flash_grenade_mp";

export type Perk1Id = "sleight_of_hand" | "blind_eye" | "extreme_conditioning" | "scavenger";
export type Perk2Id = "quickdraw" | "assassin" | "hardline" | "blast_shield";
export type Perk3Id = "stalker" | "steady_aim" | "dead_silence" | "sitrep";

export type StrikePackageId = "assault" | "support" | "specialist";

export type KillstreakId =
  | "uav"
  | "predator_missile"
  | "sentry_gun"
  | "counter_uav"
  | "sam_turret"
  | "ims"
  | "strafe_run"
  | "reaper"
  | "ac130";

export interface LoadoutPerks {
  perk1: Perk1Id;
  perk2: Perk2Id;
  perk3: Perk3Id;
}

export interface LoadoutStrikePackage {
  package: StrikePackageId;
  streaks: [KillstreakId, KillstreakId, KillstreakId];
}

/** One of a player's classes. */
export interface Loadout {
  /** What the player called it. Theirs to choose, so it is not an id and nothing keys by it. */
  name: string;
  /** The game it is built from, as a catalogue game (`iw4`); null until one is chosen, and then it carries nothing. */
  game: string | null;
  primary: LoadoutWeapon;
  secondary: LoadoutWeapon;
  /** Lethal equipment (Frag Grenade or Semtex in MW3). */
  lethal?: LethalEquipmentId;
  /** Tactical equipment (Flashbang in MW3). */
  tactical?: TacticalEquipmentId;
  /** Authentic MW3 3-Perk tier configuration. */
  perks?: LoadoutPerks;
  /** Authentic MW3 Strike Package (Assault / Support / Specialist) and chosen streaks. */
  strikePackage?: LoadoutStrikePackage;
}

/** How many custom classes a player has. */
export const LOADOUT_COUNT = 5;

/**
 * Authentic Call of Duty: Modern Warfare 3 (IW5) 5 Default Preset Classes.
 *
 * 1. Grenadier: Assault Rifle class (M4A1 Reflex + MP412, Frag/Flash, Sleight of Hand / Quickdraw / Stalker, Assault Strike Package)
 * 2. First Recon: SMG class (UMP45 Reflex + MP412, Semtex/Flash, Extreme Conditioning / Quickdraw / Steady Aim, Assault Strike Package)
 * 3. Overwatch: LMG class (M60E4 Reflex + SMAW, Frag/Flash, Blind Eye / Blast Shield / Stalker, Support Strike Package)
 * 4. Scout Sniper: Sniper class (Barrett .50cal + P99, Frag/Flash, Blind Eye / Assassin / Stalker, Assault Strike Package)
 * 5. Support Defender: Shotgun class (SPAS-12 + FMG9, Semtex/Flash, Extreme Conditioning / Hardline / Steady Aim, Support Strike Package)
 */
export const DEFAULT_CLASSES: readonly Loadout[] = [
  {
    name: "Grenadier",
    game: "iw5",
    primary: { weapon: "iw5/iw5_m4_mp", attachments: ["reflex"] },
    secondary: { weapon: "iw5/iw5_mp412_mp", attachments: [] },
    lethal: "frag_grenade_mp",
    tactical: "flash_grenade_mp",
    perks: {
      perk1: "sleight_of_hand",
      perk2: "quickdraw",
      perk3: "stalker",
    },
    strikePackage: {
      package: "assault",
      streaks: ["uav", "predator_missile", "sentry_gun"],
    },
  },
  {
    name: "First Recon",
    game: "iw5",
    primary: { weapon: "iw5/iw5_ump45_mp", attachments: ["reflexsmg"] },
    secondary: { weapon: "iw5/iw5_mp412_mp", attachments: [] },
    lethal: "semtex_mp",
    tactical: "flash_grenade_mp",
    perks: {
      perk1: "extreme_conditioning",
      perk2: "quickdraw",
      perk3: "steady_aim",
    },
    strikePackage: {
      package: "assault",
      streaks: ["uav", "predator_missile", "sentry_gun"],
    },
  },
  {
    name: "Overwatch",
    game: "iw5",
    primary: { weapon: "iw5/iw5_m60_mp", attachments: ["reflexlmg"] },
    secondary: { weapon: "iw5/iw5_smaw_mp", attachments: [] },
    lethal: "frag_grenade_mp",
    tactical: "flash_grenade_mp",
    perks: {
      perk1: "blind_eye",
      perk2: "blast_shield",
      perk3: "stalker",
    },
    strikePackage: {
      package: "support",
      streaks: ["uav", "sam_turret", "sentry_gun"],
    },
  },
  {
    name: "Scout Sniper",
    game: "iw5",
    primary: { weapon: "iw5/iw5_barrett_mp", attachments: [] },
    secondary: { weapon: "iw5/iw5_p99_mp", attachments: [] },
    lethal: "frag_grenade_mp",
    tactical: "flash_grenade_mp",
    perks: {
      perk1: "blind_eye",
      perk2: "assassin",
      perk3: "stalker",
    },
    strikePackage: {
      package: "assault",
      streaks: ["uav", "predator_missile", "sentry_gun"],
    },
  },
  {
    name: "Support Defender",
    game: "iw5",
    primary: { weapon: "iw5/iw5_spas12_mp", attachments: [] },
    secondary: { weapon: "iw5/iw5_fmg9_mp", attachments: [] },
    lethal: "semtex_mp",
    tactical: "flash_grenade_mp",
    perks: {
      perk1: "extreme_conditioning",
      perk2: "hardline",
      perk3: "steady_aim",
    },
    strikePackage: {
      package: "support",
      streaks: ["uav", "sam_turret", "sentry_gun"],
    },
  },
] as const;

export const DEFAULT_CLASS_COUNT = DEFAULT_CLASSES.length;
export const TOTAL_LOADOUT_COUNT = LOADOUT_COUNT + DEFAULT_CLASS_COUNT;

/**
 * How many attachments one weapon in a class may carry.
 *
 * Below the wire's own cap (MAX_FITTED_ATTACHMENTS) on purpose: the wire says
 * what can be represented and this says what the game allows, and the two are
 * different questions. Call of Duty's answer is two, with the perk; this is one
 * until there is a reason for the second.
 */
export const MAX_LOADOUT_ATTACHMENTS = 1;

/** The longest a class's name may be. Long enough for "Silenced Assault", short enough to draw. */
export const LOADOUT_NAME_MAX = 24;

export function emptyLoadoutWeapon(): LoadoutWeapon {
  return { weapon: null, attachments: [] };
}

/** An empty class carrying nothing, for reset or manual game selection. */
export function emptyLoadout(index: number): Loadout {
  return {
    name: `Class ${index + 1}`,
    game: null,
    primary: emptyLoadoutWeapon(),
    secondary: emptyLoadoutWeapon(),
    lethal: "frag_grenade_mp",
    tactical: "flash_grenade_mp",
    perks: {
      perk1: "sleight_of_hand",
      perk2: "quickdraw",
      perk3: "stalker",
    },
    strikePackage: {
      package: "assault",
      streaks: ["uav", "predator_missile", "sentry_gun"],
    },
  };
}

/**
 * The initial class a player has before editing: pre-configured with authentic
 * MW3 default loadout specifications so a player is never unarmed or empty.
 */
export function defaultLoadout(index: number): Loadout {
  const template = DEFAULT_CLASSES[index % DEFAULT_CLASSES.length]!;
  return {
    name: `Class ${index + 1}`,
    game: template.game,
    primary: { weapon: template.primary.weapon, attachments: [...template.primary.attachments] },
    secondary: { weapon: template.secondary.weapon, attachments: [...template.secondary.attachments] },
    lethal: template.lethal,
    tactical: template.tactical,
    perks: template.perks ? { ...template.perks } : undefined,
    strikePackage: template.strikePackage
      ? { package: template.strikePackage.package, streaks: [...template.strikePackage.streaks] }
      : undefined,
  };
}

/** A player's five custom classes, as they start out. */
export function defaultLoadouts(): Loadout[] {
  return Array.from({ length: LOADOUT_COUNT }, (_, i) => defaultLoadout(i));
}

/**
 * Looks up a loadout by index across custom classes (0..4) and permanent
 * default classes (5..9).
 */
export function getLoadout(customLoadouts: readonly Loadout[], index: number): Loadout | undefined {
  if (index >= 0 && index < customLoadouts.length) {
    return customLoadouts[index];
  }
  const defaultIndex = index - LOADOUT_COUNT;
  if (defaultIndex >= 0 && defaultIndex < DEFAULT_CLASSES.length) {
    return DEFAULT_CLASSES[defaultIndex];
  }
  return undefined;
}

/** The two weapons of a class in the order they are held. */
export function loadoutWeapons(loadout: Loadout): [LoadoutWeapon, LoadoutWeapon] {
  return [loadout.primary, loadout.secondary];
}
