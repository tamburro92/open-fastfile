// Free-for-All: individual deathmatch. Every player is their own side.
//
// Plain data, like every declaration; the behaviour is `scripts/ffa.ts`.
// First player to reach the score limit (or highest score when time expires) wins.

import type { GametypeDecl } from "./declaration.js";

export const FFA_GAMETYPE = "ffa";

/** Default score limit in Call of Duty Free-for-All (kills). */
export const DEFAULT_FFA_SCORE_LIMIT = 30;

/** Default time limit in Call of Duty Free-for-All (seconds: 10 minutes). */
export const DEFAULT_FFA_TIME_LIMIT_SECONDS = 600;

export const ffaGametype: GametypeDecl = {
  id: FFA_GAMETYPE,
  display: "Free-for-All",
  description: "Individual deathmatch. Eliminate opponents to reach the score limit before time expires.",
  // Empty means free-for-all: every player is their own side, and nothing asks
  // the map for a team's spawns.
  teams: [],
  // Deathmatch spawns: every imported map has them (`mode: "dm"`).
  spawnMode: "dm",
  // And deathmatch furniture:
  mode: "dm",
  // Each player's purse holds their kills, replicated in every snapshot:
  points: true,
  // Match-wide counters replicated to HUD:
  counters: ["scoreLimit", "timeLeft"],
};
