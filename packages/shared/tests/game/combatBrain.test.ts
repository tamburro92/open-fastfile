import { describe, expect, it } from "vitest";
import type { BrainContext, Goal } from "../../src/game/bots/brain.js";
import { COMBAT_BRAIN, combatBrain, THINK_PERIOD, type CombatMemory } from "../../src/game/bots/brains/combat.js";
import { aimStep, BOT_SKILLS, canAds, difficultyOf, inRange, sightRate, type BotDifficulty } from "../../src/game/bots/botWarfare.js";
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
  weapon?: { ammo: number; clipSize: number; state: "idle" | "firing" | "reloading"; weaponClass?: string; fireType?: string; ads?: number };
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
        weapon: p.weapon ?? { ammo: 30, clipSize: 30, state: "idle", weaponClass: "rifle", fireType: "Full Auto" },
      };
    },
    nav,
    hasLineOfSight: options.hasLineOfSight ?? (() => true),
  } as unknown as BrainContext;
}

/** Metres for a distance the mod states in units. */
const u = (units: number) => units * 0.0254;

/** A bot at the origin facing -Z, its memory, and an rng a test can set. */
function bot(difficulty: BotDifficulty, roll = 0.5) {
  const dice = { value: roll };
  const self = {
    id: "#b1",
    index: 1,
    team: "allies",
    objective: { kind: "none" as const },
    movement: createMovement(at([0, 0, 0]), 0, 0),
    motor: new Motor(),
  };
  const memory = combatBrain.init(self, () => dice.value, { difficulty }) as CombatMemory;
  return { self, memory, dice };
}

const WEAPON = { ammo: 30, clipSize: 30, state: "idle" as const, weaponClass: "rifle", fireType: "Full Auto", ads: 1 };

/** One opponent straight ahead, `distance` m off. */
function duel(distance: number, weapon: TestPlayer["weapon"] = WEAPON): TestPlayer[] {
  return [
    { id: "#b1", team: "allies", feet: at([0, 0, 0]), weapon },
    { id: "enemy", team: "axis", feet: at([0, 0, -distance]) },
  ];
}

/** Think every `THINK_PERIOD` for `seconds`, from `from`; the last goal. */
function run(b: ReturnType<typeof bot>, players: TestPlayer[], seconds: number, from = 1, sight?: (a: Vec3, c: Vec3) => boolean): Goal {
  let goal: Goal = { kind: "idle" };
  const nav = new NavPlanner(testGraph(), new NavMatchState(testGraph()));
  const ticks = Math.round(seconds / THINK_PERIOD);
  for (let i = 0; i <= ticks; i++) {
    goal = combatBrain.think(mockContext({ players, now: from + i * THINK_PERIOD, nav, hasLineOfSight: sight }), b.self, b.memory);
  }
  return goal;
}

const fireOf = (goal: Goal) => ("fire" in goal ? goal.fire : undefined);

describe("Bot Warfare's numbers", () => {
  it("maps the lobby's four levels on the mod's 1, 3, 5 and 7", () => {
    expect(BOT_SKILLS.recruit.base).toBe(1);
    expect(BOT_SKILLS.regular.initReact).toBe(750);
    expect(BOT_SKILLS.hardened.aimTime).toBe(0.25);
    expect(BOT_SKILLS.veteran.bones).toEqual(["head"]);
    expect(difficultyOf("Veteran")).toBe("veteran");
    expect(difficultyOf("godmode")).toBe("regular");
  });

  it("takes in a far target slower, and one past dist_max never, by weapon", () => {
    const s = BOT_SKILLS.recruit; // 1000 to 2500 units, times 0.9 for a rifle
    expect(sightRate(s, "rifle", 500)).toBe(1);
    expect(sightRate(s, "rifle", 1500)).toBeGreaterThan(0);
    expect(sightRate(s, "rifle", 1500)).toBeLessThan(1);
    expect(sightRate(s, "rifle", 2300)).toBe(0);
    expect(sightRate(s, "mg", 2300)).toBeGreaterThan(0);
  });

  it("does not aim down the sights up close or with a shotgun, and a shotgun holds its fire past 500", () => {
    expect(canAds("rifle", 199)).toBe(false);
    expect(canAds("rifle", 201)).toBe(true);
    expect(canAds("spread", 400)).toBe(false);
    expect(inRange("spread", 501)).toBe(false);
    expect(inRange("rifle", 5000)).toBe(true);
  });

  it("turns a look over aim_time, never slower than a tick's worth of 0.05 s", () => {
    expect(aimStep(0.5, 0.05)).toBeCloseTo(0.1);
    expect(aimStep(0, 0.05)).toBe(1);
  });
});

describe("the combat brain", () => {
  it("is in the BRAINS table, and thinks on the mod's 0.05 s", () => {
    expect(brainFor(COMBAT_BRAIN)).toBe(combatBrain);
    expect(combatBrain.period).toBe(THINK_PERIOD);
  });

  it("waits out spawn_time before anything", () => {
    const b = bot("recruit");
    expect(run(b, duel(10), 0.5).kind).toBe("idle");
    expect(b.memory.tracked.size).toBe(0);
  });

  it("ignores teammates and the dead", () => {
    const b = bot("veteran");
    run(b, [{ id: "#b1", team: "allies", feet: at([0, 0, 0]) }, { id: "friend", team: "allies", feet: at([0, 0, -5]) }, { id: "corpse", team: "axis", feet: at([0, 0, -6]), alive: false }], 1);
    expect(b.memory.tracked.size).toBe(0);
  });

  it("sees within fov and with a line only", () => {
    const behind = bot("veteran");
    run(behind, [{ id: "#b1", team: "allies", feet: at([0, 0, 0]) }, { id: "enemy", team: "axis", feet: at([0, 0, 10]) }], 1);
    expect(behind.memory.tracked.size).toBe(0);
    const walled = bot("veteran");
    run(walled, duel(10), 1, 1, () => false);
    expect(walled.memory.tracked.size).toBe(0);
  });

  it("only makes a target of one seen for init_react_time", () => {
    const b = bot("recruit"); // 0.75 s of spawn_time, then 1.5 s
    run(b, duel(10), 1.5);
    expect(b.memory.tracked.has("enemy")).toBe(true);
    expect(b.memory.targetId).toBeNull();
    run(b, duel(10), 1, 2.55);
    expect(b.memory.targetId).toBe("enemy");
  });

  it("fires only after reaction_time, and at range only fully down the sights", () => {
    const b = bot("regular", 0.99); // strafes nobody; 500 ms of reaction after 750 ms of init
    expect(fireOf(run(b, duel(10), 1.15))).toBe(false);
    expect(fireOf(run(b, duel(10), 0.5, 2.2))).toBe(true);
    expect(fireOf(run(b, duel(10, { ...WEAPON, ads: 0.4 }), 0.05, 2.75))).toBe(false);
  });

  it("fires from the hip up close, where it does not aim down the sights", () => {
    const b = bot("veteran", 0.99);
    const goal = run(b, duel(u(150), { ...WEAPON, ads: 0 }), 1);
    expect(fireOf(goal)).toBe(true);
    expect("ads" in goal && goal.ads).toBe(false);
  });

  it("starts its aim off on someone it sees again, and closes it over aim_offset_time", () => {
    const b = bot("recruit", 0.99);
    run(b, duel(10), 3); // Seen long enough that the first offset has already closed, as it does in the mod.
    run(b, duel(10), 0.1, 4.05, () => false);
    const again = run(b, duel(10), 0.05, 4.2);
    expect(Math.abs("aimAt" in again ? again.aimAt!.x : 0)).toBeGreaterThan(0);
    const late = run(b, duel(10), 2, 4.3);
    expect(Math.abs("aimAt" in late ? late.aimAt!.x : 1)).toBeLessThan(1e-6);
  });

  it("aims a veteran at the head and an offset of nothing", () => {
    const b = bot("veteran", 0.99);
    const goal = run(b, duel(10), 1);
    const aim = "aimAt" in goal ? goal.aimAt! : at([9, 9, 9]);
    expect(aim.x).toBeCloseTo(0);
    expect(aim.y).toBeCloseTo(1.524);
  });

  it("strafes the targets its rand says, and stands for the rest", () => {
    const strafer = bot("veteran", 0.1); // rand 10, under its 65
    const goal = run(strafer, duel(10), 1);
    expect(goal.kind).toBe("look");
    expect("strafe" in goal && Math.abs(goal.strafe ?? 0)).toBe(1);
    const stander = bot("veteran", 0.99);
    const still = run(stander, duel(10), 1);
    expect(still.kind).toBe("look");
    expect("strafe" in still && still.strafe !== undefined).toBe(false);
  });

  it("walks to where a target was last seen, then forgets them after remember_time", () => {
    const b = bot("regular", 0.99);
    run(b, duel(15), 2);
    const walking = run(b, duel(15), 0.1, 3.1, () => false);
    expect(walking.kind).toBe("moveTo");
    if (walking.kind === "moveTo") {
      expect(walking.point.z).toBeCloseTo(-15);
    }
    run(b, duel(15), 2.5, 3.3, () => false);
    expect(b.memory.tracked.size).toBe(0);
  });

  it("with no target, goes to a random node of the map, each bot its own", () => {
    const points = [0.05, 0.3, 0.7].map((roll) => {
      const b = bot("veteran", roll);
      const goal = run(b, [{ id: "#b1", team: "allies", feet: at([0, 0, 0]) }], 0.2);
      return goal.kind === "moveTo" ? goal.point.z : NaN;
    });
    expect(new Set(points).size).toBeGreaterThan(1);
    expect(points.every(Number.isFinite)).toBe(true);
  });

  it("keeps its node until it arrives or is blocked, and then picks again", () => {
    const b = bot("veteran");
    const players: TestPlayer[] = [{ id: "#b1", team: "allies", feet: at([0, 0, 0]) }];
    run(b, players, 0.2);
    const first = b.memory.walking;
    run(b, players, 0.2, 1.3);
    expect(b.memory.walking).toBe(first);
    b.self.motor.status = "stuck";
    run(b, players, 0.05, 1.6);
    expect(b.memory.walking).not.toBe(first);
  });

  it("taps a semi-automatic semi_time apart, and holds an automatic", () => {
    const b = bot("veteran", 0.99); // 0.1 s apart
    run(b, duel(u(150), { ...WEAPON, fireType: "Single Shot" }), 0.5);
    const fires = [1.6, 1.65, 1.7, 1.75].map((now) => fireOf(run(b, duel(u(150), { ...WEAPON, fireType: "Single Shot" }), 0, now)));
    expect(fires.filter(Boolean)).toHaveLength(2);
    const auto = bot("veteran", 0.99);
    run(auto, duel(u(150)), 0.5);
    expect([1.6, 1.65].map((now) => fireOf(run(auto, duel(u(150)), 0, now)))).toEqual([true, true]);
  });

  it("reloads when empty, and when quiet under half a magazine", () => {
    const empty = bot("regular");
    const dry = run(empty, duel(10, { ...WEAPON, ammo: 0 }), 1);
    expect("reload" in dry && dry.reload).toBe(true);
    const quiet = bot("veteran");
    const players: TestPlayer[] = [{ id: "#b1", team: "allies", feet: at([0, 0, 0]), weapon: { ...WEAPON, ammo: 10 } }];
    const goal = run(quiet, players, 0.2);
    expect("reload" in goal && goal.reload).toBe(true);
  });

  it("holds fire with a teammate on the line", () => {
    const b = bot("veteran", 0.99);
    const players: TestPlayer[] = [...duel(15), { id: "friend", team: "allies", feet: at([0, 0, -7]) }];
    expect(fireOf(run(b, players, 1))).toBe(false);
    const clear = bot("veteran", 0.99);
    expect(fireOf(run(clear, [...duel(15), { id: "friend", team: "allies", feet: at([4, 0, -7]) }], 1))).toBe(true);
  });

  it("walks a shotgun in past 500 units", () => {
    const b = bot("veteran", 0.99);
    const goal = run(b, duel(u(700), { ...WEAPON, weaponClass: "spread" }), 1);
    expect(goal.kind).toBe("moveTo");
    expect(fireOf(goal)).toBe(false);
  });

  it("throws at a place it lost someone, on its rand, within 256 to 1024 units, and holds the aim", () => {
    const b = bot("veteran", 0.1); // rand 10, under its 65
    run(b, duel(u(500)), 1);
    // A wall between them, and open sky overhead at both ends.
    const overhead = (a: Vec3, c: Vec3) => a.x === c.x && a.z === c.z;
    const lost = run(b, duel(u(500)), 2.6, 2.1, overhead);
    expect(lost.kind).toBe("look");
    expect(b.memory.throwAim).not.toBeNull();
    expect(b.memory.throwAim!.y).toBeGreaterThan(1.5);
  });

  it("plays the same twice from one stream of numbers", () => {
    const seq = () => {
      let i = 0;
      return () => (i = (i * 7 + 3) % 11) / 11;
    };
    const once = () => {
      const self = bot("regular").self;
      const memory = combatBrain.init(self, seq(), { difficulty: "regular" }) as CombatMemory;
      const out: Goal[] = [];
      for (let t = 0; t < 60; t++) {
        out.push(combatBrain.think(mockContext({ players: duel(12), now: 1 + t * THINK_PERIOD }), self, memory));
      }
      return JSON.stringify(out);
    };
    expect(once()).toBe(once());
  });
});

describe("the motor on a bot's look", () => {
  it("turns a share of what is left over aimTime, and sidesteps", () => {
    const motor = new Motor();
    const nav = new NavPlanner(testGraph(), new NavMatchState(testGraph()));
    const m = createMovement(at([0, 0, 0]), 0, 0);
    motor.setGoal({ kind: "look", point: at([10, 1.4, 0]), aimAt: at([10, 1.4, 0]), aimTime: 0.5, strafe: -1, jump: true }, nav);
    const out = idleInput(0, 0);
    motor.step(m, 0.05, nav, out);
    expect(Math.abs(out.yaw)).toBeCloseTo((Math.PI / 2) * 0.1, 2);
    expect(out.right).toBe(-1);
    expect(out.jump).toBe(true);
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
});
