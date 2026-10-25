// Free-for-All gametype and script unit tests.

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_FFA_SCORE_LIMIT, DEFAULT_FFA_TIME_LIMIT_SECONDS, FFA_GAMETYPE, ffaGametype } from "../../src/game/gametypes/ffa.js";
import { GAMETYPES, gametype } from "../../src/game/gametypes/registry.js";
import { ffaScript, type FfaState } from "../../src/game/scripts/ffa.js";
import type { ServerContext } from "../../src/game/context.js";
import type { PlayerId } from "../../src/net/messages/fields.js";
import type { Announcement } from "../../src/game/announcement.js";

describe("Free-for-All gametype declaration", () => {
  it("registers in GAMETYPES with expected attributes", () => {
    expect(gametype(FFA_GAMETYPE)).toBeDefined();
    expect(GAMETYPES[FFA_GAMETYPE]).toBe(ffaGametype);
    expect(ffaGametype.id).toBe("ffa");
    expect(ffaGametype.display).toBe("Deathmatch");
    expect(ffaGametype.teams).toEqual([]);
    expect(ffaGametype.spawnMode).toBe("dm");
    expect(ffaGametype.mode).toBe("dm");
    expect(ffaGametype.points).toBe(true);
    expect(ffaGametype.counters).toEqual(["scoreLimit", "timeLeft"]);
  });

  it("has Call of Duty default parameters (30 kills, 10 minutes)", () => {
    expect(DEFAULT_FFA_SCORE_LIMIT).toBe(30);
    expect(DEFAULT_FFA_TIME_LIMIT_SECONDS).toBe(600);
  });
});

describe("Free-for-All script", () => {
  function fakeContext(overrides: Partial<ServerContext<FfaState>> = {}): {
    ctx: ServerContext<FfaState>;
    counters: Record<string, number>;
    points: Record<string, number>;
    published: Announcement[];
    ended: string[];
    setMemory: (m: FfaState) => void;
    setNow: (n: number) => void;
  } {
    const counters: Record<string, number> = {};
    const points: Record<string, number> = {};
    const published: Announcement[] = [];
    const ended: string[] = [];
    let mem: FfaState = undefined as unknown as FfaState;
    let currentNow = 0;

    const ctx = {
      get now() {
        return currentNow;
      },
      gametype: ffaGametype,
      players: [
        { id: "p1", bot: false, points: 0 },
        { id: "p2", bot: false, points: 0 },
      ],
      scoreLimit: 30,
      timeLimitSeconds: 600,
      setCounter: vi.fn((name: string, val: number) => {
        counters[name] = val;
      }),
      addPoints: vi.fn((id: PlayerId, delta: number) => {
        points[id] = (points[id] ?? 0) + delta;
      }),
      publish: vi.fn((announcement: Announcement) => {
        published.push(announcement);
      }),
      endMatch: vi.fn((reason: string) => {
        ended.push(reason);
      }),
      get memory() {
        return mem;
      },
      ...overrides,
    } as unknown as ServerContext<FfaState>;

    return {
      ctx,
      counters,
      points,
      published,
      ended,
      setMemory: (m: FfaState) => {
        mem = m;
      },
      setNow: (n: number) => {
        currentNow = n;
      },
    };
  }

  it("initializes counters and state from context limits", () => {
    const { ctx, counters } = fakeContext({ scoreLimit: 25, timeLimitSeconds: 300 });
    const state = ffaScript.server!.init!(ctx) as FfaState;

    expect(state.scoreLimit).toBe(25);
    expect(state.timeLimitSeconds).toBe(300);
    expect(counters.scoreLimit).toBe(25);
    expect(counters.timeLeft).toBe(300);
  });

  it("falls back to default limits when none are provided", () => {
    const { ctx, counters } = fakeContext({ scoreLimit: undefined, timeLimitSeconds: undefined });
    const state = ffaScript.server!.init!(ctx) as FfaState;

    expect(state.scoreLimit).toBe(30);
    expect(state.timeLimitSeconds).toBe(600);
    expect(counters.scoreLimit).toBe(30);
    expect(counters.timeLeft).toBe(600);
  });

  it("spawns in dm mode with no team", () => {
    const { ctx } = fakeContext();
    const spawnQuery = ffaScript.server!.playerSpawn!(ctx, "p1");
    expect(spawnQuery).toEqual({ mode: "dm", team: undefined, start: undefined });
  });

  it("awards strictly +1 kill point on valid kill and no points on suicide", () => {
    const { ctx, points, setMemory } = fakeContext({ scoreLimit: 10 });
    const state = ffaScript.server!.init!(ctx) as FfaState;
    setMemory(state);

    // Player 1 joins and dies of suicide:
    ffaScript.server!.playerDeath!(ctx, "p1", "p1", "bullet");
    expect(points["p1"]).toBeUndefined();
    expect(state.deaths.get("p1")).toBe(1);

    // Player 1 kills Player 2:
    ffaScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");
    expect(points["p1"]).toBe(1);
    expect(state.kills.get("p1")).toBe(1);
    expect(state.deaths.get("p2")).toBe(1);

    // Another kill:
    ffaScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");
    expect(points["p1"]).toBe(2);
    expect(state.kills.get("p1")).toBe(2);
  });

  it("ends the match when score limit is reached with post-game cooldown", () => {
    const { ctx, published, ended, setMemory, setNow } = fakeContext({ scoreLimit: 2 });
    const state = ffaScript.server!.init!(ctx) as FfaState;
    setMemory(state);

    ffaScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");
    expect(state.ended).toBe(false);
    expect(ended).toHaveLength(0);

    // Second kill reaches score limit:
    ffaScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");
    expect(state.ended).toBe(true);
    expect(state.winner).toBe("p1");
    expect(published).toEqual([{ what: "ffaWinner", player: "p1", value: 2 }]);
    // Post-match period: match has not called endMatch yet so scoreboard stays up:
    expect(ended).toHaveLength(0);

    // After 5s post-match duration:
    setNow(5);
    ffaScript.server!.tick!(ctx, 1);
    expect(ended).toEqual(["scoreLimitReached"]);
  });

  it("ticks down the timer and ends match when time expires with post-game cooldown", () => {
    const { ctx, counters, published, ended, setMemory, setNow } = fakeContext({ scoreLimit: 30, timeLimitSeconds: 10 });
    const state = ffaScript.server!.init!(ctx) as FfaState;
    setMemory(state);

    // Player 1 has 1 kill, Player 2 has 0 kills:
    ffaScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");

    // First tick starts timer:
    setNow(1);
    ffaScript.server!.tick!(ctx, 1);
    expect(counters.timeLeft).toBe(10);
    expect(ended).toHaveLength(0);

    // 5 seconds elapsed:
    setNow(6);
    ffaScript.server!.tick!(ctx, 1);
    expect(counters.timeLeft).toBe(5);
    expect(ended).toHaveLength(0);

    // 10 seconds elapsed (time limit reached, winner announced):
    setNow(11);
    ffaScript.server!.tick!(ctx, 1);
    expect(counters.timeLeft).toBe(0);
    expect(published).toEqual([{ what: "ffaTimeUp", player: "p1", value: 1 }]);
    expect(state.winner).toBe("p1");
    expect(state.ended).toBe(true);
    // Post-game countdown:
    expect(ended).toHaveLength(0);

    // 5 seconds post-game cooldown passes:
    setNow(16);
    ffaScript.server!.tick!(ctx, 1);
    expect(ended).toEqual(["timeLimitReached"]);
  });

  it("handles unlimited score limit and unlimited time limit correctly", () => {
    const { ctx, counters, published, ended, setMemory, setNow } = fakeContext({ scoreLimit: 0, timeLimitSeconds: 0 });
    const state = ffaScript.server!.init!(ctx) as FfaState;
    setMemory(state);

    // Player gets 50 kills with scoreLimit: 0:
    for (let i = 0; i < 50; i++) {
      ffaScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");
    }
    expect(state.ended).toBe(false);
    expect(ended).toHaveLength(0);

    // Advance 1000 seconds with timeLimitSeconds: 0:
    setNow(1000);
    ffaScript.server!.tick!(ctx, 1);
    expect(counters.timeLeft).toBe(0);
    expect(state.ended).toBe(false);
    expect(ended).toHaveLength(0);
    expect(published).toHaveLength(0);
  });
});
