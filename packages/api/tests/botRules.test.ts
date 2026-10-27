import { TDM_GAMETYPE } from "@3d/shared/game/gametypes/tdm.js";
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

describe("Bot Matchmaking & Lobby Rules", () => {
  it("defaults bot options in newly created lobby", async () => {
    const { matchmaking, player } = setup();
    const hostPlayer = player("host-user");
    const created = await matchmaking.createLobby(hostPlayer.user, MAP);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const last = hostPlayer.last();
    expect(last?.type).toBe("lobby");
    if (last?.type === "lobby") {
      expect(last.bots).toBe(true);
      expect(last.botDifficulty).toBe("regular");
    }
  });

  it("updates bot options via setLobbyRules and broadcasts to players", async () => {
    const { matchmaking, player } = setup();
    const hostPlayer = player("host-user");
    const created = await matchmaking.createLobby(hostPlayer.user, MAP);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    const res = matchmaking.setLobbyRules(hostPlayer.user, created.code, {
      scoreLimit: 25,
      timeLimit: 400,
      bots: true,
      botDifficulty: "veteran",
      botCount: 8,
      friendlyBots: 4,
      enemyBots: 4,
    });
    expect(res).toEqual({ ok: true });

    const last = hostPlayer.last();
    expect(last?.type).toBe("lobby");
    if (last?.type === "lobby") {
      expect(last.scoreLimit).toBe(25);
      expect(last.timeLimit).toBe(400);
      expect(last.bots).toBe(true);
      expect(last.botDifficulty).toBe("veteran");
      expect(last.botCount).toBe(8);
      expect(last.friendlyBots).toBe(4);
      expect(last.enemyBots).toBe(4);
    }
  });

  it("passes configured bot rules to GameOrder on match start", async () => {
    const { matchmaking, player, instance, host, advance } = setup();
    host([MAP]);
    const gs = instance("gs-1");

    const hostPlayer = player("host-user");
    const created = await matchmaking.createLobby(hostPlayer.user, MAP);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    matchmaking.setLobbyGametype(hostPlayer.user, created.code, TDM_GAMETYPE);

    matchmaking.setLobbyRules(hostPlayer.user, created.code, {
      scoreLimit: 75,
      timeLimit: 600,
      bots: true,
      botDifficulty: "hardened",
      botCount: 10,
      friendlyBots: 5,
      enemyBots: 5,
    });

    const startRes = matchmaking.startLobby(hostPlayer.user, created.code);
    expect(startRes).toEqual({ ok: true });

    advance(6);

    const orderEvent = gs.last();
    expect(orderEvent?.type).toBe("gameCreate");
    if (orderEvent?.type === "gameCreate") {
      expect(orderEvent.game.gametype).toBe(TDM_GAMETYPE);
      expect(orderEvent.game.bots).toBe(true);
      expect(orderEvent.game.botDifficulty).toBe("hardened");
      expect(orderEvent.game.botCount).toBe(10);
      expect(orderEvent.game.friendlyBots).toBe(5);
      expect(orderEvent.game.enemyBots).toBe(5);
    }
  });

  it("disables bots completely when bots: false is set", async () => {
    const { matchmaking, player, instance, host, advance } = setup();
    host([MAP]);
    const gs = instance("gs-1");

    const hostPlayer = player("host-user");
    const created = await matchmaking.createLobby(hostPlayer.user, MAP);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }

    matchmaking.setLobbyRules(hostPlayer.user, created.code, {
      bots: false,
    });

    matchmaking.startLobby(hostPlayer.user, created.code);
    advance(6);

    const orderEvent = gs.last();
    expect(orderEvent?.type).toBe("gameCreate");
    if (orderEvent?.type === "gameCreate") {
      expect(orderEvent.game.bots).toBe(false);
    }
  });
});
