import { describe, expect, it } from "vitest";
import type { BrainContext, Goal } from "../../src/game/bots/brain.js";
import { COMBAT_BRAIN, COMBAT_DIFFICULTIES, combatBrain, type BotDifficulty, type CombatMemory } from "../../src/game/bots/brains/combat.js";
import { Motor } from "../../src/game/bots/motor.js";
import { brainFor } from "../../src/game/bots/registry.js";
import type { PlayerStateView, PlayerView } from "../../src/game/context.js";
import { allocateGraph, LINK_STATUS, NavGraph } from "../../src/nav/graph.js";
import { ABILITIES, LINK_KINDS } from "../../src/nav/vocab.js";
import { NavPlanner } from "../../src/game/bots/planner.js";
import { NavMatchState } from "../../src/nav/dynamic.js";
import type { Vec3 } from "../../src/sim/capsule.js";
import { idleInput } from "../../src/sim/input.js";
import { createMovement, RUN_SPEED } from "../../src/sim/movement.js";
import { navFile } from "../navWorld.js";

const at = (p: [number, number, number]): Vec3 => ({ x: p[0], y: p[1], z: p[2] });

function testGraph(): NavGraph {
  const positions: [number, number, number][] = [
    [0, 0, 0],
    [0, 0, -5],
    [0, 0, -10],
    [0, 0, -15],
    [0, 0, -20],
  ];
  const g = allocateGraph(positions.length, 8);
  positions.forEach((p, i) => g.feet.set(p, i * 3));
  g.usable.fill(1);
  let l = 0;
  const link = (from: number, to: number) => {
    g.first[from + 1]!++;
    g.source[l] = from;
    g.target[l] = to;
    g.kind[l] = LINK_KINDS.WALK;
    g.status[l] = LINK_STATUS.VALID;
    const [a, b] = [positions[from]!, positions[to]!];
    g.cost[l] = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / RUN_SPEED;
    g.requires[l] = ABILITIES.WALK;
    l++;
  };
  link(0, 1);
  link(1, 0);
  link(1, 2);
  link(2, 1);
  link(2, 3);
  link(3, 2);
  link(3, 4);
  link(4, 3);
  for (let i = 0; i < positions.length; i++) {
    g.first[i + 1]! += g.first[i]!;
  }
  return new NavGraph(g, navFile(positions.map((p) => ({ at: p }))));
}

interface TestPlayer {
  id: string;
  team?: string;
  feet: Vec3;
  alive?: boolean;
  bot?: boolean;
  eyeHeight?: number;
  weapon?: { ammo: number; clipSize: number; state: "idle" | "firing" | "reloading" };
}

function mockContext(options: { players: TestPlayer[]; now?: number; nav?: NavPlanner; hasLineOfSight?: (from: Vec3, to: Vec3) => boolean }): BrainContext {
  const nav = options.nav ?? new NavPlanner(testGraph(), new NavMatchState(testGraph()));
  const views: PlayerView[] = options.players.map((p) => ({
    id: p.id,
    team: p.team,
    bot: p.bot ?? false,
    points: 0,
  }));

  return {
    now: options.now ?? 0,
    seed: 1234,
    players: views,
    player: (id: string) => views.find((v) => v.id === id),
    state: (id: string): PlayerStateView | undefined => {
      const p = options.players.find((q) => q.id === id);
      if (!p) {
        return undefined;
      }
      return {
        feet: { ...p.feet },
        yaw: 0,
        alive: p.alive ?? true,
        health: 100,
        team: p.team,
        eyeHeight: p.eyeHeight,
        weapon: p.weapon ?? { ammo: 30, clipSize: 30, state: "idle" },
      };
    },
    nav,
    hasLineOfSight: options.hasLineOfSight ?? (() => true),
  } as unknown as BrainContext;
}

describe("Call of Duty MW3 Combat Brain", () => {
  it("registers in the BRAINS table under 'combat'", () => {
    expect(brainFor(COMBAT_BRAIN)).toBe(combatBrain);
    expect(combatBrain.id).toBe("combat");
  });

  it("initializes correct configuration profiles for all 4 difficulties", () => {
    const difficulties: BotDifficulty[] = ["recruit", "regular", "hardened", "veteran"];
    for (const diff of difficulties) {
      const self = {
        id: "#b1",
        index: 1,
        team: "allies",
        objective: { kind: "none" as const },
        movement: createMovement(at([0, 0, 0]), 0, 0),
        motor: new Motor(),
      };
      const mem = combatBrain.init(self, () => 0.5, { difficulty: diff }) as CombatMemory;
      expect(mem.difficulty).toBe(diff);
      expect(mem.config).toEqual(COMBAT_DIFFICULTIES[diff]);
      expect(mem.config.reactionTime).toBeGreaterThanOrEqual(0.05);
      expect(mem.config.aimErrorMax).toBeGreaterThanOrEqual(mem.config.aimErrorMin);
    }
  });

  it("falls back to regular when given an unknown difficulty", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "godmode" }) as CombatMemory;
    expect(mem.difficulty).toBe("regular");
    expect(mem.config).toEqual(COMBAT_DIFFICULTIES.regular);
  });

  it("ignores teammates and dead players", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "regular" }) as CombatMemory;
    const ctx = mockContext({
      players: [
        { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
        { id: "teammate", team: "allies", feet: at([0, 0, -5]) },
        { id: "corpse", team: "axis", feet: at([0, 0, -8]), alive: false },
      ],
    });

    const goal = combatBrain.think(ctx, self, mem);
    expect(goal.kind).toBe("idle");
  });

  it("prioritizes a visible opponent over a closer hidden opponent", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "regular" }) as CombatMemory;

    // "hiddenEnemy" is 5m away, "visibleEnemy" is 10m away
    const ctx = mockContext({
      players: [
        { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
        { id: "hiddenEnemy", team: "axis", feet: at([0, 0, -5]) },
        { id: "visibleEnemy", team: "axis", feet: at([0, 0, -10]) },
      ],
      hasLineOfSight: (_from, to) => {
        // Line of sight blocked for hiddenEnemy (z = -5)
        if (Math.abs(to.z - -5) < 1) {
          return false;
        }
        return true;
      },
    });

    const goal = combatBrain.think(ctx, self, mem);
    expect(mem.targetId).toBe("visibleEnemy");
    expect(goal.kind).toBe("look");
    if (goal.kind === "look") {
      expect(goal.aimAt?.z).toBeCloseTo(-10, 0.5);
    }
  });

  it("respects MW3 reaction delay before firing upon target acquisition", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    // Recruit reaction time is 0.55s
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "recruit" }) as CombatMemory;

    const players: TestPlayer[] = [
      { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
      { id: "enemy", team: "axis", feet: at([0, 0, -10]) },
    ];

    // Frame 1 at t = 1.0s: target acquired
    let ctx = mockContext({ players, now: 1.0 });
    let goal = combatBrain.think(ctx, self, mem);
    expect(mem.targetId).toBe("enemy");
    expect(goal.fire).toBe(false);

    // Frame 2 at t = 1.3s (0.30s later < 0.55s): still reacting, not firing
    ctx = mockContext({ players, now: 1.3 });
    goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(false);

    // Frame 3 at t = 1.6s (0.60s later > 0.55s): reaction complete, fires burst!
    ctx = mockContext({ players, now: 1.6 });
    goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(true);
  });

  it("handles ADS distance threshold based on difficulty", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    // Regular ADS min distance is 5m
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "regular" }) as CombatMemory;

    // Close range (3m): hip-fire (ads: false)
    let ctx = mockContext({
      players: [
        { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
        { id: "closeEnemy", team: "axis", feet: at([0, 0, -3]) },
      ],
      now: 10.0,
    });
    let goal = combatBrain.think(ctx, self, mem);
    expect(goal.ads).toBe(false);

    // Mid/long range (8m): ADS engaged (ads: true)
    ctx = mockContext({
      players: [
        { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
        { id: "farEnemy", team: "axis", feet: at([0, 0, -8]) },
      ],
      now: 20.0,
    });
    goal = combatBrain.think(ctx, self, mem);
    expect(goal.ads).toBe(true);
  });

  it("triggers reload when out of ammunition during combat", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "hardened" }) as CombatMemory;

    const ctx = mockContext({
      players: [
        { id: "#b1", team: "allies", feet: at([0, 0, 0]), weapon: { ammo: 0, clipSize: 30, state: "idle" } },
        { id: "enemy", team: "axis", feet: at([0, 0, -10]) },
      ],
      now: 1.0,
    });

    const goal = combatBrain.think(ctx, self, mem);
    expect(goal.reload).toBe(true);
    expect(goal.fire).toBe(false);
  });

  it("advances (moveTo) towards distant targets beyond primary combat range", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "regular" }) as CombatMemory;

    // Target at 20m (> 18m primary engagement distance)
    const ctx = mockContext({
      players: [
        { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
        { id: "distantEnemy", team: "axis", feet: at([0, 0, -20]) },
      ],
      now: 5.0,
    });

    const goal = combatBrain.think(ctx, self, mem);
    expect(goal.kind).toBe("moveTo");
    if (goal.kind === "moveTo") {
      expect(goal.aimAt).toBeDefined();
      expect(goal.run).toBe(true);
    }
  });

  it("produces tighter aim dispersion for Veteran than for Recruit", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };

    const recruitMem = combatBrain.init(self, () => 0.5, { difficulty: "recruit" }) as CombatMemory;
    const veteranMem = combatBrain.init(self, () => 0.5, { difficulty: "veteran" }) as CombatMemory;

    const players = [
      { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
      { id: "enemy", team: "axis", feet: at([0, 0, -10]) },
    ];

    combatBrain.think(mockContext({ players, now: 0 }), self, recruitMem);
    combatBrain.think(mockContext({ players, now: 0 }), self, veteranMem);

    const recruitOffsetDist = Math.hypot(recruitMem.aimOffset.x, recruitMem.aimOffset.y, recruitMem.aimOffset.z);
    const veteranOffsetDist = Math.hypot(veteranMem.aimOffset.x, veteranMem.aimOffset.y, veteranMem.aimOffset.z);

    expect(veteranOffsetDist).toBeLessThan(recruitOffsetDist);
    expect(veteranOffsetDist).toBeLessThanOrEqual(COMBAT_DIFFICULTIES.veteran.aimErrorMax);
    expect(recruitOffsetDist).toBeGreaterThanOrEqual(COMBAT_DIFFICULTIES.recruit.aimErrorMin * 0.5);
  });

  it("executes multi-tick burst cadence: sustains fire across burst duration and pauses between bursts", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    // Hardened burst: min 0.5s, max 0.85s (with rng=0, exactly 0.5s burst duration, pause min 0.12s)
    const mem = combatBrain.init(self, () => 0.0, { difficulty: "hardened" }) as CombatMemory;
    const players: TestPlayer[] = [
      { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
      { id: "enemy", team: "axis", feet: at([0, 0, -10]) },
    ];

    // t = 0.0s: target acquired (reaction time 0.16s)
    let ctx = mockContext({ players, now: 0.0 });
    let goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(false);

    // t = 0.2s: reaction complete (0.2 > 0.16), starts burst! Burst set for [0.2, 0.7], pause [0.7, 0.82]
    ctx = mockContext({ players, now: 0.2 });
    goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(true);
    expect(mem.burstUntil).toBeCloseTo(0.7, 0.01);
    expect(mem.pauseUntil).toBeCloseTo(0.82, 0.01);

    // t = 0.4s: mid-burst (0.4 < 0.7), bot MUST continue firing!
    ctx = mockContext({ players, now: 0.4 });
    goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(true);

    // t = 0.6s: late-burst (0.6 < 0.7), bot MUST continue firing!
    ctx = mockContext({ players, now: 0.6 });
    goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(true);

    // t = 0.75s: burst ended, pause interval (0.75 in [0.7, 0.82]), bot MUST pause firing!
    ctx = mockContext({ players, now: 0.75 });
    goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(false);

    // t = 0.85s: pause ended (0.85 >= 0.82), bot starts new burst!
    ctx = mockContext({ players, now: 0.85 });
    goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(true);
  });

  it("resets reaction time when target breaks line of sight and re-emerges", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "regular" }) as CombatMemory; // reactionTime = 0.30s
    const players: TestPlayer[] = [
      { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
      { id: "enemy", team: "axis", feet: at([0, 0, -10]) },
    ];

    // t = 1.0s: spotted and reacting
    let ctx = mockContext({ players, now: 1.0, hasLineOfSight: () => true });
    let goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(false);

    // t = 1.4s: reacted and firing (0.4s > 0.3s)
    ctx = mockContext({ players, now: 1.4, hasLineOfSight: () => true });
    goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(true);

    // t = 2.0s: target goes behind wall (no line of sight)
    ctx = mockContext({ players, now: 2.0, hasLineOfSight: () => false });
    goal = combatBrain.think(ctx, self, mem);
    expect(Boolean(goal.fire)).toBe(false);
    expect(goal.kind).toBe("moveTo"); // pursuing hidden target

    // t = 5.0s: target re-emerges into view!
    // Must NOT immediately fire with 0ms delay; reaction delay MUST reset!
    ctx = mockContext({ players, now: 5.0, hasLineOfSight: () => true });
    goal = combatBrain.think(ctx, self, mem);
    expect(Boolean(goal.fire)).toBe(false); // Reaction time reset!

    // t = 5.15s: still reacting (0.15s < 0.30s)
    ctx = mockContext({ players, now: 5.15, hasLineOfSight: () => true });
    goal = combatBrain.think(ctx, self, mem);
    expect(Boolean(goal.fire)).toBe(false);

    // t = 5.35s: reaction complete (0.35s > 0.30s), fires!
    ctx = mockContext({ players, now: 5.35, hasLineOfSight: () => true });
    goal = combatBrain.think(ctx, self, mem);
    expect(goal.fire).toBe(true);
  });

  it("adapts aim height and raycast to target crouched/prone stance eyeHeight", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.0, { difficulty: "veteran" }) as CombatMemory; // zero dispersion offset

    const crouchEyeHeight = 0.95;
    const players: TestPlayer[] = [
      { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
      { id: "crouchedEnemy", team: "axis", feet: at([0, 0, -6]), eyeHeight: crouchEyeHeight },
    ];

    const ctx = mockContext({ players, now: 1.0 });
    const goal = combatBrain.think(ctx, self, mem);

    expect(goal.aimAt).toBeDefined();
    if (goal.aimAt) {
      // Aim at chest = feet.y + crouchEyeHeight * 0.75 = 0.95 * 0.75 = 0.7125m
      expect(goal.aimAt.y).toBeCloseTo(crouchEyeHeight * 0.75, 0.02);
    }
  });

  it("requests tactical reload when idle and weapon clip is not full", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "regular" }) as CombatMemory;
    const ctx = mockContext({
      players: [{ id: "#b1", team: "allies", feet: at([0, 0, 0]), weapon: { ammo: 15, clipSize: 30, state: "idle" } }],
      now: 1.0,
    });
    const goal = combatBrain.think(ctx, self, mem);
    expect(goal.kind).toBe("idle");
    expect(goal.reload).toBe(true);
  });

  it("tactically reloads while pursuing hidden opponent with low ammo", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "regular" }) as CombatMemory;
    const ctx = mockContext({
      players: [
        { id: "#b1", team: "allies", feet: at([0, 0, 0]), weapon: { ammo: 10, clipSize: 30, state: "idle" } },
        { id: "hiddenEnemy", team: "axis", feet: at([0, 0, -10]) },
      ],
      now: 1.0,
      hasLineOfSight: () => false,
    });
    const goal = combatBrain.think(ctx, self, mem);
    expect(goal.kind).toBe("moveTo");
    expect(goal.reload).toBe(true);
  });

  it("does not request reload if weapon is already in reloading state", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "regular" }) as CombatMemory;
    const ctx = mockContext({
      players: [{ id: "#b1", team: "allies", feet: at([0, 0, 0]), weapon: { ammo: 0, clipSize: 30, state: "reloading" } }],
      now: 1.0,
    });
    const goal = combatBrain.think(ctx, self, mem);
    expect(goal.kind).toBe("idle");
    expect(goal.reload).toBeUndefined();
  });

  it("falls back gracefully when hasLineOfSight is undefined on context", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "regular" }) as CombatMemory;
    const ctx = mockContext({
      players: [
        { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
        { id: "enemy", team: "axis", feet: at([0, 0, -5]) },
      ],
      now: 1.0,
    });
    // Explicitly delete hasLineOfSight to simulate environments where it's absent
    // @ts-expect-error testing optional hasLineOfSight
    delete ctx.hasLineOfSight;

    const goal = combatBrain.think(ctx, self, mem);
    expect(mem.targetId).toBe("enemy");
    expect(mem.targetVisible).toBe(true);
    expect(goal.kind).toBe("look");
  });
});

describe("Motor Tactical Execution", () => {
  it("translates aimAt into yaw and pitch while converting forward movement into strafing", () => {
    const motor = new Motor();
    const nav = new NavPlanner(testGraph(), new NavMatchState(testGraph()));
    const m = createMovement(at([0, 0, 0]), 0, 0);
    m.grounded = true;

    // Bot is moving along -Z towards (0, 0, -5), but aiming at enemy at (5, 1.4, 0) (to the right)
    const goal: Goal = {
      kind: "moveTo",
      point: at([0, 0, -5]),
      aimAt: { x: 5, y: 1.4, z: 0 },
      fire: true,
      ads: true,
      crouch: true,
      reload: false,
    };

    motor.setGoal(goal, nav);
    const out = idleInput(0, 0);
    motor.step(m, 1 / 60, nav, out);

    // Bot should aim towards (5, 0)
    // dx = 5, dz = 0 -> aimYaw = atan2(-5, 0) = -PI/2 (-1.57 rad)
    expect(out.yaw).toBeCloseTo(-Math.PI / 2, 0.05);

    // Bot was trying to move along -Z (yaw = 0). With aimYaw = -PI/2, world direction -Z requires:
    // angle = 0 - (-PI/2) = PI/2
    // out.forward = cos(PI/2) = 0
    // out.right = -sin(PI/2) = -1 (strafing left in local frame = world -Z direction)
    expect(Math.abs(out.forward)).toBeLessThan(0.1);
    expect(out.right).toBeCloseTo(-1, 0.1);

    // Verify all tactical flags pass through
    expect(out.fire).toBe(true);
    expect(out.ads).toBe(true);
    expect(out.crouch).toBe(true);
    expect(out.reload).toBe(false);
    // ADS / fire forces out.run to false
    expect(out.run).toBe(false);
  });

  it("preserves both forward and right movement in strafe rotation", () => {
    const motor = new Motor();
    const nav = new NavPlanner(testGraph(), new NavMatchState(testGraph()));
    const m = createMovement(at([0, 0, 0]), 0, 0);
    m.grounded = true;

    // Direct diagonal input: forward = 0.707, right = 0.707
    const goal: Goal = {
      kind: "look",
      point: at([0, 0, -5]),
      aimAt: { x: 0, y: 1.4, z: 5 }, // looking back (+Z, aimYaw = PI)
    };

    motor.setGoal(goal, nav);
    const out = idleInput(0, 0);
    // simulate initial diagonal movement
    out.yaw = 0;
    out.forward = 0.707;
    out.right = 0.707;

    motor.step(m, 1 / 60, nav, out);
    // When aiming back (yaw = PI), forward (towards -Z) becomes local backward (-0.707),
    // and right (towards +X) becomes local left (-0.707):
    expect(out.forward).toBeCloseTo(-0.707, 0.05);
    expect(out.right).toBeCloseTo(-0.707, 0.05);
  });

  it("triggers melee when visible target is within 2.0 meters", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0),
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "veteran" }) as CombatMemory;
    const players: TestPlayer[] = [
      { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
      { id: "closeEnemy", team: "axis", feet: at([0, 0, -1.5]) },
    ];
    const ctx = mockContext({ players, now: 1.0 });
    const goal = combatBrain.think(ctx, self, mem);

    expect(goal.kind).toBe("look");
    if (goal.kind === "look") {
      expect(goal.melee).toBe(true);
    }
  });

  it("passes melee, lethal, and tactical flags through motor into PlayerInput", () => {
    const motor = new Motor();
    const nav = new NavPlanner(testGraph(), new NavMatchState(testGraph()));
    const m = createMovement(at([0, 0, 0]), 0, 0);

    const goal: Goal = {
      kind: "look",
      point: at([0, 0, -5]),
      melee: true,
      lethal: true,
      tactical: true,
    };

    motor.setGoal(goal, nav);
    const out = idleInput(0, 0);
    motor.step(m, 1 / 60, nav, out);

    expect(out.melee).toBe(true);
    expect(out.lethal).toBe(true);
    expect(out.tactical).toBe(true);
  });

  it("smoothly clamps turn speed when turnSpeed is specified on goal", () => {
    const motor = new Motor();
    const nav = new NavPlanner(testGraph(), new NavMatchState(testGraph()));
    const m = createMovement(at([0, 0, 0]), 0, 0); // facing yaw = 0 (towards -Z)

    // Goal asks to aim directly right (yaw = -PI/2, diff = 1.57 rad)
    const turnSpeed = 3.0; // 3 rad/s
    const dt = 1 / 30; // 0.0333s -> max step is 0.1 rad
    const goal: Goal = {
      kind: "look",
      point: at([10, 1.4, 0]),
      aimAt: at([10, 1.4, 0]),
      turnSpeed,
      fire: true,
    };

    motor.setGoal(goal, nav);
    const out = idleInput(0, 0);
    motor.step(m, dt, nav, out);

    // After 1 tick at 3 rad/s, it should have rotated at most turnSpeed * dt rad (~0.1 rad), NOT snapped to -1.57 rad!
    expect(Math.abs(out.yaw)).toBeCloseTo(turnSpeed * dt, 0.01);
    expect(Math.abs(out.yaw)).toBeLessThan(0.5);

    // Trigger discipline: while still swinging (> 0.35 rad misaligned), fire is withheld!
    expect(out.fire).toBe(false);
  });

  it("enforces field of view so enemies sneaking from behind are not spotted", () => {
    const self = {
      id: "#b1",
      index: 1,
      team: "allies",
      objective: { kind: "none" as const },
      movement: createMovement(at([0, 0, 0]), 0, 0), // facing yaw = 0 (towards -Z)
      motor: new Motor(),
    };
    const mem = combatBrain.init(self, () => 0.5, { difficulty: "regular" }) as CombatMemory;

    // Enemy is 10m directly behind the bot (+Z direction)
    const players: TestPlayer[] = [
      { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
      { id: "sneakBehind", team: "axis", feet: at([0, 0, 10]) },
    ];

    const ctx = mockContext({ players, now: 1.0, hasLineOfSight: () => true });
    const goal = combatBrain.think(ctx, self, mem);

    // Sneaking enemy behind the bot is outside the 130-degree FOV and not heard (> 4.5m)
    expect(mem.targetId).toBeNull();
    expect(goal.kind).toBe("idle");
  });
});
