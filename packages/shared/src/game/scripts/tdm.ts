// Team Deathmatch script: two teams eliminate each other to reach the score limit.
//
// Rules:
// - Win by reaching the score limit, or by having the highest team score when time runs out.
// - Each kill awards exactly +1 point to killer and +1 point to killer's team (no bonuses, no killstreaks).
// - Suicides award no points.
// - Friendly fire is off by default.
// - Time and score limits are tracked authoritatively on the server and broadcast via counters.

import type { PlayerId } from "../../net/messages/fields.js";
import { isSuicide } from "../damage.js";
import { DEFAULT_TDM_SCORE_LIMIT, DEFAULT_TDM_TIME_LIMIT_SECONDS, TDM_GAMETYPE } from "../gametypes/tdm.js";
import { defineScript, type Script } from "../hooks.js";

export const POST_MATCH_SECONDS = 5;

export interface TdmState {
  scoreLimit: number;
  timeLimitSeconds: number;
  startedAt: number | null;
  ended: boolean;
  endedAt: number | null;
  endReason: string | null;
  winnerTeam: string | null;
  alliesScore: number;
  axisScore: number;
  kills: Map<PlayerId, number>;
  deaths: Map<PlayerId, number>;
}

export const tdmScript: Script = defineScript<TdmState>({
  id: "tdm",
  gametypes: [TDM_GAMETYPE],
  sounds: ["mp_bonus_start", "ui_mp_timer_countdown"],
  server: {
    init: (ctx) => {
      const scoreLimit = ctx.scoreLimit ?? DEFAULT_TDM_SCORE_LIMIT;
      const timeLimitSeconds = ctx.timeLimitSeconds ?? DEFAULT_TDM_TIME_LIMIT_SECONDS;
      ctx.setCounter("alliesScore", 0);
      ctx.setCounter("axisScore", 0);
      ctx.setCounter("scoreLimit", scoreLimit);
      ctx.setCounter("timeLeft", timeLimitSeconds);
      return {
        scoreLimit,
        timeLimitSeconds,
        startedAt: null,
        ended: false,
        endedAt: null,
        endReason: null,
        winnerTeam: null,
        alliesScore: 0,
        axisScore: 0,
        kills: new Map(),
        deaths: new Map(),
      };
    },
    combatRules: () => ({
      respawnDelay: 2,
      friendlyFire: false,
    }),
    matchStart: (ctx) => {
      // Balance teams with bot opponents for single-player / small matches:
      const targetPerTeam = 3;
      const alliesCount = ctx.players.filter((p) => p.team === "allies").length;
      const axisCount = ctx.players.filter((p) => p.team === "axis").length;

      const alliesNeeded = Math.max(0, targetPerTeam - alliesCount);
      for (let i = 0; i < alliesNeeded; i++) {
        ctx.bots.add({ brain: "seek-nearest", team: "allies", objective: { kind: "none" } });
      }

      const axisNeeded = Math.max(0, targetPerTeam - axisCount);
      for (let i = 0; i < axisNeeded; i++) {
        ctx.bots.add({ brain: "seek-nearest", team: "axis", objective: { kind: "none" } });
      }
    },
    playerSpawn: (ctx, id) => ({
      mode: ctx.gametype.spawnMode,
      team: ctx.player(id)?.team,
      start: undefined,
    }),
    playerJoin: (ctx, id) => {
      const state = ctx.memory;
      if (!state.kills.has(id)) {
        state.kills.set(id, 0);
      }
      if (!state.deaths.has(id)) {
        state.deaths.set(id, 0);
      }
    },
    playerDeath: (ctx, victim, killer) => {
      const state = ctx.memory;
      state.deaths.set(victim, (state.deaths.get(victim) ?? 0) + 1);

      if (killer !== null && !isSuicide(victim, killer)) {
        const nextKills = (state.kills.get(killer) ?? 0) + 1;
        state.kills.set(killer, nextKills);
        // Only kill +1, strictly as requested:
        ctx.addPoints(killer, 1);

        const killerTeam = ctx.player(killer)?.team;
        if (killerTeam === "allies") {
          state.alliesScore++;
          ctx.score("allies", 1);
          ctx.setCounter("alliesScore", state.alliesScore);
        } else if (killerTeam === "axis") {
          state.axisScore++;
          ctx.score("axis", 1);
          ctx.setCounter("axisScore", state.axisScore);
        }

        const teamScore = killerTeam === "allies" ? state.alliesScore : state.axisScore;
        if (!state.ended && state.scoreLimit > 0 && killerTeam && teamScore >= state.scoreLimit) {
          state.ended = true;
          state.endedAt = ctx.now;
          state.endReason = "scoreLimitReached";
          state.winnerTeam = killerTeam;
          ctx.publish({ what: "tdmWinner", team: killerTeam, value: teamScore });
        }
      }
    },
    tick: (ctx) => {
      const state = ctx.memory;

      // Allow 5-second post-game cooldown for players to view tactical scoreboard and victory banner:
      if (state.ended && state.endedAt !== null) {
        if (ctx.now - state.endedAt >= POST_MATCH_SECONDS) {
          ctx.endMatch(state.endReason ?? "matchOver");
        }
        return;
      }

      if (state.startedAt === null && ctx.players.some((p) => !p.bot)) {
        state.startedAt = ctx.now;
      }

      if (state.startedAt !== null && !state.ended) {
        if (state.timeLimitSeconds > 0) {
          const elapsed = ctx.now - state.startedAt;
          const remaining = Math.max(0, state.timeLimitSeconds - elapsed);
          ctx.setCounter("timeLeft", Math.ceil(remaining));
          ctx.setCounter("scoreLimit", state.scoreLimit);

          if (remaining <= 0) {
            state.ended = true;
            state.endedAt = ctx.now;
            state.endReason = "timeLimitReached";
            if (state.alliesScore > state.axisScore) {
              state.winnerTeam = "allies";
              ctx.publish({ what: "tdmTimeUp", team: "allies", value: state.alliesScore });
            } else if (state.axisScore > state.alliesScore) {
              state.winnerTeam = "axis";
              ctx.publish({ what: "tdmTimeUp", team: "axis", value: state.axisScore });
            } else {
              state.winnerTeam = "draw";
              ctx.publish({ what: "tdmDraw", value: state.alliesScore });
            }
          }
        } else {
          // Unlimited time:
          ctx.setCounter("timeLeft", 0);
          ctx.setCounter("scoreLimit", state.scoreLimit);
        }
      }
    },
  },
  client: {
    event: (ctx, announcement) => {
      if (announcement.what === "tdmWinner" || announcement.what === "tdmTimeUp") {
        ctx.say("mp_bonus_start");
      }
    },
  },
});
