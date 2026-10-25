// Team Deathmatch: two teams eliminate each other to reach the score limit.
//
// Plain data, like every declaration; the behaviour is `scripts/tdm.ts`.
// First team to reach the score limit (or highest score when time expires) wins.

import type { GametypeDecl } from "./declaration.js";

export const TDM_GAMETYPE = "tdm";

/** Default score limit in Call of Duty Team Deathmatch (kills: 75). */
export const DEFAULT_TDM_SCORE_LIMIT = 75;

/** Default time limit in Call of Duty Team Deathmatch (seconds: 10 minutes). */
export const DEFAULT_TDM_TIME_LIMIT_SECONDS = 600;

export const tdmGametype: GametypeDecl = {
  id: TDM_GAMETYPE,
  display: "Team Deathmatch",
  description: "Two teams fight to reach the score limit. Eliminate enemies to score points for your team.",
  // Two classic Call of Duty opposing factions:
  teams: ["allies", "axis"],
  // Team deathmatch spawns: every imported map has them (`mode: "tdm"`).
  spawnMode: "tdm",
  // And team deathmatch furniture:
  mode: "tdm",
  // Each player's purse holds their individual kills, replicated in every snapshot:
  points: true,
  // Match-wide counters replicated to HUD:
  counters: ["alliesScore", "axisScore", "scoreLimit", "timeLeft"],
};
