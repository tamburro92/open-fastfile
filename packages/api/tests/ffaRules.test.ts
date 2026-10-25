import { FFA_GAMETYPE } from "@3d/shared/game/gametypes/registry.js";
import { DEFAULT_FFA_SCORE_LIMIT, DEFAULT_FFA_TIME_LIMIT_SECONDS } from "@3d/shared/game/gametypes/ffa.js";
import { describe, expect, it } from "vitest";
import type { ServerEvent } from "@3d/shared/protocol/events/server.js";
import type { UserEvent } from "@3d/shared/protocol/events/user.js";
import type { MatchmakingConfig } from "../src/config.js";
import { TEST_WORLD, testApp } from "../testing/app.js";

const MAP = TEST_WORLD;

const CONFIG: MatchmakingConfig = {
  maps: [MAP],
  lobbySize: 4,
  minPlayers: 1,
  countdownSeconds: 5,
  gameDurationSeconds: 600,
  readyTimeoutMs: 30_000,
  presenceTimeoutMs: 30_000,
};

function setup(overrides: Partial<MatchmakingConfig> = {}) {
  let clock = 1_000_000;
  const { registry, matchmaking } = testApp({ now: () => clock, matchmaking: { ...CONFIG, ...overrides } });

  const host = (worlds: string[] = [MAP], id = "gs-1") =>
    registry.heartbeat({ id, url: `http://${id}:9300`, worlds, players: 0, maxPlayers: 12, maxGames: 4, games: 0 });

  function player(name: string) {
    const user = { id: name, username: name };
    const events: UserEvent[] = [];
    const unsubscribe = matchmaking.userEvents.subscribe(name, { send: (event) => events.push(event), close: () => {} });
    return {
      ...user,
      user,
      events,
      unsubscribe,
      last: () => events.at(-1),
    };
  }

  function instance(id = "gs-1") {
    const events: ServerEvent[] = [];
    matchmaking.serverEvents.subscribe(id, { send: (event) => events.push(event), close: () => {} });
    return { events, last: () => events.at(-1) };
  }

  return {
    matchmaking,
    player,
    instance,
    host,
    advance: (seconds: number) => {
      clock += seconds * 1000;
      matchmaking.tick();
    },
  };
}

describe("FFA Lobby and Game Rules", () => {
  it("sets FFA gametype with default Call of Duty rules (30 kills, 10 minutes)", async () => {
    const { matchmaking, player } = setup();
    const hostPlayer = player("host-user");
    const created = await matchmaking.createLobby(hostPlayer.user, MAP);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const setRes = matchmaking.setLobbyGametype(hostPlayer.user, created.code, FFA_GAMETYPE);
    expect(setRes).toEqual({ ok: true });

    const last = hostPlayer.last();
    expect(last?.type).toBe("lobby");
    if (last?.type === "lobby") {
      expect(last.gametype).toBe(FFA_GAMETYPE);
      expect(last.scoreLimit).toBe(DEFAULT_FFA_SCORE_LIMIT);
      expect(last.timeLimit).toBe(DEFAULT_FFA_TIME_LIMIT_SECONDS);
    }
  });

  it("updates custom score limit and time limit, and passes them to GameOrder", async () => {
    const { matchmaking, player, instance, host, advance } = setup();
    host([MAP]);
    const gs = instance("gs-1");

    const hostPlayer = player("host-user");
    const created = await matchmaking.createLobby(hostPlayer.user, MAP);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    matchmaking.setLobbyGametype(hostPlayer.user, created.code, FFA_GAMETYPE);

    // Host updates rules from menu (e.g. 15 kills, 5 minutes = 300s):
    const rulesRes = matchmaking.setLobbyRules(hostPlayer.user, created.code, {
      scoreLimit: 15,
      timeLimit: 300,
    });
    expect(rulesRes).toEqual({ ok: true });

    let last = hostPlayer.last();
    expect(last?.type).toBe("lobby");
    if (last?.type === "lobby") {
      expect(last.scoreLimit).toBe(15);
      expect(last.timeLimit).toBe(300);
    }

    // Host starts match:
    const startRes = matchmaking.startLobby(hostPlayer.user, created.code);
    expect(startRes).toEqual({ ok: true });

    // Advance past countdown (5 seconds):
    advance(6);

    const orderEvent = gs.last();
    expect(orderEvent?.type).toBe("gameCreate");
    if (orderEvent?.type === "gameCreate") {
      expect(orderEvent.game.gametype).toBe(FFA_GAMETYPE);
      expect(orderEvent.game.scoreLimit).toBe(15);
      expect(orderEvent.game.durationSeconds).toBe(300);
    }
  });
});
