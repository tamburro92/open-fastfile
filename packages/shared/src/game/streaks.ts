// A player's strike package as the HUD needs it: which three streaks, which are
// ready, and how far they are toward the rest.
//
// The game server keeps the count (game-server/src/match/killstreaks.ts) and
// sends this to the player it belongs to on every snapshot, as state: a class
// change, a death and an activation all show up on the next tick without an
// event for each, and a lost datagram is repaired by the one after it.

import type { KillstreakId, StrikePackageId } from "../sim/loadout.js";
import type { Vec3 } from "../sim/capsule.js";
import type { PlayerId } from "../net/messages/fields.js";

/** The order is the format: an id travels as its index. */
export const KILLSTREAK_IDS = [
  "uav",
  "predator_missile",
  "sentry_gun",
  "counter_uav",
  "sam_turret",
  "ims",
  "strafe_run",
  "reaper",
  "ac130",
] as const satisfies readonly KillstreakId[];
export const STRIKE_PACKAGE_IDS = ["assault", "support", "specialist"] as const satisfies readonly StrikePackageId[];

/** MW3's kill costs, per package: Support's are higher because its count survives a death. */
export const STREAK_COSTS: Record<KillstreakId, { assault: number; support: number }> = {
  uav: { assault: 3, support: 4 },
  counter_uav: { assault: 4, support: 5 },
  predator_missile: { assault: 5, support: 6 },
  sentry_gun: { assault: 5, support: 8 },
  ims: { assault: 5, support: 8 },
  sam_turret: { assault: 4, support: 8 },
  strafe_run: { assault: 9, support: 10 },
  reaper: { assault: 9, support: 12 },
  ac130: { assault: 12, support: 15 },
};

/** Kills a streak costs in a package, with Hardline's one off. Never below one. */
export function streakCost(id: KillstreakId, pkg: StrikePackageId, hardline: boolean): number {
  return Math.max(1, STREAK_COSTS[id][pkg === "support" ? "support" : "assault"] - (hardline ? 1 : 0));
}

/** One player's own strike package, as their client is told it. */
export interface StreakState {
  package: StrikePackageId;
  streaks: [KillstreakId, KillstreakId, KillstreakId];
  ready: [boolean, boolean, boolean];
  /** Toward the next: kills this life, or Support's points, which a death does not reset. */
  progress: number;
  hardline: boolean;
}

/** A placed sentry gun, as everyone is told it: where, which way its gun points, and whether it is firing. */
export interface SentryState {
  id: number;
  owner: PlayerId;
  position: Vec3;
  /** The way it was set down facing: its tripod's, which the gun turns either side of. */
  facing: number;
  yaw: number;
  pitch: number;
  firing: boolean;
}
