// Free-for-All script: individual deathmatch mechanics.
//
// Rules:
// - Win by reaching the score limit, or by having the most kills when time runs out.
// - Each kill awards exactly +1 point (no bonuses, no killstreaks).
// - Suicides award no points.
// - Time and score limits are tracked authoritatively on the server and broadcast via counters.

import type { PlayerId } from "../../net/messages/fields.js";
import { isSuicide } from "../damage.js";
import { DEFAULT_FFA_SCORE_LIMIT, DEFAULT_FFA_TIME_LIMIT_SECONDS, FFA_GAMETYPE } from "../gametypes/ffa.js";
import { defineScript, type Script } from "../hooks.js";
import { castFor } from "../cast.js";

export const POST_MATCH_SECONDS = 5;

export interface FfaState {
  scoreLimit: number;
  timeLimitSeconds: number;
  startedAt: number | null;
  ended: boolean;
  endedAt: number | null;
  endReason: string | null;
  winner: PlayerId | null;
  kills: Map<PlayerId, number>;
  deaths: Map<PlayerId, number>;
}

export const ffaScript: Script = defineScript<FfaState>({
  id: "ffa",
  gametypes: [FFA_GAMETYPE],
  sounds: ["mp_bonus_start", "ui_mp_timer_countdown"],
  server: {
    init: (ctx) => {
      const scoreLimit = ctx.scoreLimit ?? DEFAULT_FFA_SCORE_LIMIT;
      const timeLimitSeconds = ctx.timeLimitSeconds ?? DEFAULT_FFA_TIME_LIMIT_SECONDS;
      ctx.setCounter("scoreLimit", scoreLimit);
      ctx.setCounter("timeLeft", timeLimitSeconds);
      return {
        scoreLimit,
        timeLimitSeconds,
        startedAt: null,
        ended: false,
        endedAt: null,
        endReason: null,
        winner: null,
        kills: new Map(),
        deaths: new Map(),
      };
    },
    combatRules: () => ({
      respawnDelay: 2,
      friendlyFire: false,
    }),
    matchStart: (ctx) => {
      // In Free-for-All, spawn tactical combat bot opponents:
      const enabled = ctx.botsEnabled ?? true;
      if (!enabled) {
        return;
      }
      const humanCount = ctx.players.filter((p) => !p.bot).length;
      const targetCount = ctx.botCount !== undefined ? ctx.botCount : Math.max(0, 6 - humanCount);
      const difficulty = ctx.botDifficulty ?? "regular";
      for (let i = 0; i < targetCount; i++) {
        ctx.bots.add({ brain: "combat", params: { difficulty }, objective: { kind: "none" } });
      }
    },
    playerSpawn: (ctx) => ({
      mode: ctx.gametype.spawnMode,
      team: undefined,
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

        if (!state.ended && state.scoreLimit > 0 && nextKills >= state.scoreLimit) {
          state.ended = true;
          state.endedAt = ctx.now;
          state.endReason = "scoreLimitReached";
          state.winner = killer;
          ctx.publish({ what: "ffaWinner", player: killer, value: nextKills });
        }
      }
    },
    tick: (ctx) => {
      const state = ctx.memory;

      // Allow 5-second post-game cooldown for players to view the tactical scoreboard and victory banner:
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
            let maxKills = -1;
            let winner: PlayerId | null = null;
            for (const [id, kills] of state.kills.entries()) {
              if (kills > maxKills) {
                maxKills = kills;
                winner = id;
              }
            }
            state.winner = winner;
            ctx.publish({ what: "ffaTimeUp", player: winner ?? undefined, value: Math.max(0, maxKills) });
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
    cast: (view, team) => castFor({ game: view.game, gametype: view.gametype, team }, view.catalogue),
    event: (ctx, event) => {
      if (event.what === "ffaWinner" || event.what === "ffaTimeUp") {
        if (event.player && event.player === ctx.self?.id) {
          ctx.say("mp_bonus_start");
        }
      }
    },
  },
});
