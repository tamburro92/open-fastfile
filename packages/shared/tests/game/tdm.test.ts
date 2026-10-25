// Team Deathmatch gametype and script unit tests.

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TDM_SCORE_LIMIT, DEFAULT_TDM_TIME_LIMIT_SECONDS, TDM_GAMETYPE, tdmGametype } from "../../src/game/gametypes/tdm.js";
import { GAMETYPES, gametype } from "../../src/game/gametypes/registry.js";
import { tdmScript, type TdmState } from "../../src/game/scripts/tdm.js";
import type { ServerContext } from "../../src/game/context.js";
import type { PlayerId } from "../../src/net/messages/fields.js";
import type { Announcement } from "../../src/game/announcement.js";

describe("Team Deathmatch gametype declaration", () => {
  it("registers in GAMETYPES with expected attributes", () => {
    expect(gametype(TDM_GAMETYPE)).toBeDefined();
    expect(GAMETYPES[TDM_GAMETYPE]).toBe(tdmGametype);
    expect(tdmGametype.id).toBe("tdm");
    expect(tdmGametype.teams).toEqual(["allies", "axis"]);
    expect(tdmGametype.spawnMode).toBe("tdm");
    expect(tdmGametype.mode).toBe("tdm");
    expect(tdmGametype.points).toBe(true);
    expect(tdmGametype.counters).toEqual(["alliesScore", "axisScore", "scoreLimit", "timeLeft"]);
  });

  it("has Call of Duty default parameters (75 kills, 10 minutes)", () => {
    expect(DEFAULT_TDM_SCORE_LIMIT).toBe(75);
    expect(DEFAULT_TDM_TIME_LIMIT_SECONDS).toBe(600);
  });
});

describe("Team Deathmatch script", () => {
  function fakeContext(overrides: Partial<ServerContext<TdmState>> = {}): {
    ctx: ServerContext<TdmState>;
    counters: Record<string, number>;
    points: Record<string, number>;
    teamScores: Record<string, number>;
    published: Announcement[];
    ended: string[];
    spawnedBots: { brain: string; team?: string }[];
    setMemory: (m: TdmState) => void;
    setNow: (n: number) => void;
  } {
    const counters: Record<string, number> = {};
    const points: Record<string, number> = {};
    const teamScores: Record<string, number> = {};
    const published: Announcement[] = [];
    const ended: string[] = [];
    const spawnedBots: { brain: string; team?: string }[] = [];
    let mem: TdmState = undefined as unknown as TdmState;
    let currentNow = 0;

    const players = [
      { id: "p1", bot: false, team: "allies", points: 0 },
      { id: "p2", bot: false, team: "axis", points: 0 },
    ];

    const ctx = {
      get now() {
        return currentNow;
      },
      gametype: tdmGametype,
      players,
      player: (id: PlayerId) => players.find((p) => p.id === id),
      scoreLimit: 75,
      timeLimitSeconds: 600,
      setCounter: vi.fn((name: string, val: number) => {
        counters[name] = val;
      }),
      score: vi.fn((team: string, delta: number) => {
        teamScores[team] = (teamScores[team] ?? 0) + delta;
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
      bots: {
        add: vi.fn((spec: { brain: string; team?: string }) => {
          spawnedBots.push(spec);
          return `#b${spawnedBots.length}`;
        }),
      },
      get memory() {
        return mem;
      },
      ...overrides,
    } as unknown as ServerContext<TdmState>;

    return {
      ctx,
      counters,
      points,
      teamScores,
      published,
      ended,
      spawnedBots,
      setMemory: (m: TdmState) => {
        mem = m;
      },
      setNow: (n: number) => {
        currentNow = n;
      },
    };
  }

  it("initializes counters and state from context limits", () => {
    const { ctx, counters } = fakeContext({ scoreLimit: 50, timeLimitSeconds: 300 });
    const state = tdmScript.server!.init!(ctx) as TdmState;

    expect(state.scoreLimit).toBe(50);
    expect(state.timeLimitSeconds).toBe(300);
    expect(counters.alliesScore).toBe(0);
    expect(counters.axisScore).toBe(0);
    expect(counters.scoreLimit).toBe(50);
    expect(counters.timeLeft).toBe(300);
  });

  it("falls back to default limits when none are provided", () => {
    const { ctx, counters } = fakeContext({ scoreLimit: undefined, timeLimitSeconds: undefined });
    const state = tdmScript.server!.init!(ctx) as TdmState;

    expect(state.scoreLimit).toBe(75);
    expect(state.timeLimitSeconds).toBe(600);
    expect(counters.scoreLimit).toBe(75);
    expect(counters.timeLeft).toBe(600);
  });

  it("balances bots across allies and axis on matchStart", () => {
    const { ctx, spawnedBots } = fakeContext();
    tdmScript.server!.matchStart!(ctx);

    // Context had 1 allies (p1) and 1 axis (p2), targetPerTeam is 3:
    // So 2 allies bots and 2 axis bots should be added:
    expect(spawnedBots).toEqual([
      { brain: "seek-nearest", team: "allies", objective: { kind: "none" } },
      { brain: "seek-nearest", team: "allies", objective: { kind: "none" } },
      { brain: "seek-nearest", team: "axis", objective: { kind: "none" } },
      { brain: "seek-nearest", team: "axis", objective: { kind: "none" } },
    ]);
  });

  it("spawns in tdm mode with player's team", () => {
    const { ctx } = fakeContext();
    const spawnP1 = tdmScript.server!.playerSpawn!(ctx, "p1");
    expect(spawnP1).toEqual({ mode: "tdm", team: "allies", start: undefined });

    const spawnP2 = tdmScript.server!.playerSpawn!(ctx, "p2");
    expect(spawnP2).toEqual({ mode: "tdm", team: "axis", start: undefined });
  });

  it("awards +1 point to killer and +1 to killer's team score, 0 for suicide", () => {
    const { ctx, points, teamScores, counters, setMemory } = fakeContext({ scoreLimit: 10 });
    const state = tdmScript.server!.init!(ctx) as TdmState;
    setMemory(state);

    // Player 1 dies of suicide:
    tdmScript.server!.playerDeath!(ctx, "p1", "p1", "bullet");
    expect(points["p1"]).toBeUndefined();
    expect(teamScores["allies"]).toBeUndefined();
    expect(state.deaths.get("p1")).toBe(1);

    // Player 1 (allies) kills Player 2 (axis):
    tdmScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");
    expect(points["p1"]).toBe(1);
    expect(teamScores["allies"]).toBe(1);
    expect(counters.alliesScore).toBe(1);
    expect(state.alliesScore).toBe(1);
    expect(state.kills.get("p1")).toBe(1);
    expect(state.deaths.get("p2")).toBe(1);

    // Player 2 (axis) kills Player 1 (allies):
    tdmScript.server!.playerDeath!(ctx, "p1", "p2", "bullet");
    expect(points["p2"]).toBe(1);
    expect(teamScores["axis"]).toBe(1);
    expect(counters.axisScore).toBe(1);
    expect(state.axisScore).toBe(1);
  });

  it("ends the match when team score limit is reached with post-game cooldown", () => {
    const { ctx, published, ended, setMemory, setNow } = fakeContext({ scoreLimit: 2 });
    const state = tdmScript.server!.init!(ctx) as TdmState;
    setMemory(state);

    tdmScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");
    expect(state.ended).toBe(false);
    expect(ended).toHaveLength(0);

    // Second kill reaches score limit for Allies:
    tdmScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");
    expect(state.ended).toBe(true);
    expect(state.winnerTeam).toBe("allies");
    expect(published).toEqual([{ what: "tdmWinner", team: "allies", value: 2 }]);
    expect(ended).toHaveLength(0);

    // After 5s post-match duration:
    setNow(5);
    tdmScript.server!.tick!(ctx, 1);
    expect(ended).toEqual(["scoreLimitReached"]);
  });

  it("ticks down the timer and announces winner on time limit expiry", () => {
    const { ctx, counters, published, ended, setMemory, setNow } = fakeContext({ scoreLimit: 75, timeLimitSeconds: 10 });
    const state = tdmScript.server!.init!(ctx) as TdmState;
    setMemory(state);

    // Allies has 1 kill, Axis has 0 kills:
    tdmScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");

    // First tick starts timer:
    setNow(1);
    tdmScript.server!.tick!(ctx, 1);
    expect(counters.timeLeft).toBe(10);
    expect(ended).toHaveLength(0);

    // 10 seconds elapsed (time limit reached, Allies win):
    setNow(11);
    tdmScript.server!.tick!(ctx, 1);
    expect(counters.timeLeft).toBe(0);
    expect(published).toEqual([{ what: "tdmTimeUp", team: "allies", value: 1 }]);
    expect(state.winnerTeam).toBe("allies");
    expect(state.ended).toBe(true);

    // 5 seconds post-game cooldown passes:
    setNow(16);
    tdmScript.server!.tick!(ctx, 1);
    expect(ended).toEqual(["timeLimitReached"]);
  });

  it("declares tdmDraw when time expires with tied scores", () => {
    const { ctx, published, setMemory, setNow } = fakeContext({ scoreLimit: 75, timeLimitSeconds: 10 });
    const state = tdmScript.server!.init!(ctx) as TdmState;
    setMemory(state);

    // 1 kill each:
    tdmScript.server!.playerDeath!(ctx, "p2", "p1", "bullet");
    tdmScript.server!.playerDeath!(ctx, "p1", "p2", "bullet");

    setNow(1);
    tdmScript.server!.tick!(ctx, 1);

    setNow(11);
    tdmScript.server!.tick!(ctx, 1);
    expect(published).toEqual([{ what: "tdmDraw", value: 1 }]);
    expect(state.winnerTeam).toBe("draw");
  });
});
