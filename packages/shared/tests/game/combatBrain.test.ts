import { describe, expect, it } from "vitest";
import type { BrainContext, Goal } from "../../src/game/bots/brain.js";
import { COMBAT_BRAIN, combatBrain, MISS_OFFSET, throwPitch, type CombatMemory } from "../../src/game/bots/brains/combat.js";
import {
  BURST_FIRE_NUM_SHOTS,
  burstDelay,
  burstShots,
  difficultyOf,
  GAMESKILL,
  graphAt,
  grenadeWait,
  hitChance,
  missTime,
  SEMI_FIRE_NUM_SHOTS,
  shootStyle,
  type BotDifficulty,
} from "../../src/game/bots/mw3Ai.js";
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
  weapon?: { ammo: number; clipSize: number; state: "idle" | "firing" | "reloading"; weaponClass?: string; fireType?: string };
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

/** Metres for a distance MW3 states in units. */
const u = (units: number) => units * 0.0254;

/** A bot at the origin facing -Z, its memory, and an rng a test can set. */
function bot(difficulty: BotDifficulty, team = "allies") {
  const roll = { value: 0.5 };
  const self = {
    id: "#b1",
    index: 1,
    team,
    objective: { kind: "none" as const },
    movement: createMovement(at([0, 0, 0]), 0, 0),
    motor: new Motor(),
  };
  const memory = combatBrain.init(self, () => roll.value, { difficulty }) as CombatMemory;
  return { self, memory, roll };
}

/** One opponent straight ahead, `distance` m off, with this bot's weapon. */
function duel(distance: number, weapon?: TestPlayer["weapon"]): TestPlayer[] {
  return [
    { id: "#b1", team: "allies", feet: at([0, 0, 0]), weapon },
    { id: "enemy", team: "axis", feet: at([0, 0, -distance]) },
  ];
}

const aimOf = (goal: Goal) => ("aimAt" in goal ? goal.aimAt : undefined);
const fireOf = (goal: Goal) => ("fire" in goal ? goal.fire : undefined);
/** How far the aim is beside the target's chest, m. */
function aimOff(goal: Goal, distance: number): number {
  const aim = aimOf(goal)!;
  return Math.hypot(aim.x, aim.z + distance);
}

describe("MW3's AI numbers", () => {
  it("reads _gameskill's four rows as the lobby's four difficulties", () => {
    expect(GAMESKILL.recruit.baseEnemyAccuracy).toBe(0.9);
    expect(GAMESKILL.regular.baseEnemyAccuracy).toBe(1.0);
    expect(GAMESKILL.hardened.accuracyDistScale).toBe(0.6);
    expect(GAMESKILL.veteran.accuracyDistScale).toBe(0.8);
    expect(GAMESKILL.recruit.missTimeConstant).toBe(1.0);
    expect(GAMESKILL.veteran.missTimeDistanceFactor).toBe(0);
    expect(difficultyOf("Veteran")).toBe("veteran");
    expect(difficultyOf("godmode")).toBe("regular");
    expect(difficultyOf(undefined)).toBe("regular");
  });

  it("reads an accuracy graph linearly between its knots", () => {
    const graph = [[0, 0.6], [0.5, 0.2], [1, 0.1]] as const;
    expect(graphAt(graph, 0)).toBe(0.6);
    expect(graphAt(graph, 0.25)).toBeCloseTo(0.4);
    expect(graphAt(graph, 2)).toBe(0.1);
  });

  it("multiplies the soldier's accuracy, the skill's and the weapon's graph into one shot's chance", () => {
    // 0.2 x 1.0 x the assault rifle's 0.6 at point blank, and its 0.1 from maxDist (590) on.
    expect(hitChance("regular", "rifle", 0)).toBeCloseTo(0.12);
    expect(hitChance("regular", "rifle", 2000)).toBeCloseTo(0.02);
    // Hardened reads the graph at 0.6 of the distance: at 590 units, x = 0.6, between 0.2 and 0.1.
    expect(hitChance("hardened", "rifle", 590)).toBeCloseTo(0.2 * 1.15 * 0.18);
    for (const d of [0, 200, 500, 900, 1600]) {
      expect(hitChance("recruit", "smg", d)).toBeLessThanOrEqual(hitChance("veteran", "smg", d));
    }
  });

  it("gives a recruit its deliberate misses, growing with distance, and a veteran none", () => {
    expect(missTime("recruit", 1000)).toBeCloseTo(1.8);
    expect(missTime("regular", 1000)).toBeCloseTo(0.15);
    expect(missTime("veteran", 1000)).toBe(0);
  });

  it("picks shoot_behavior's style by range", () => {
    expect(shootStyle(200, "rifle", false)).toBe("full");
    expect(shootStyle(200, "rifle", true)).toBe("semi");
    expect(shootStyle(600, "smg", false)).toBe("burst");
    expect(shootStyle(1200, "rifle", false)).toBe("burst");
    expect(shootStyle(2000, "rifle", false)).toBe("single");
    expect(shootStyle(2000, "mg", false)).toBe("burst");
    expect(shootStyle(300, "sniper", true)).toBe("single");
  });

  it("draws a burst's rounds from animscripts/init's tables", () => {
    expect(burstShots("burst", () => 0)).toBe(BURST_FIRE_NUM_SHOTS[0]);
    expect(burstShots("burst", () => 0.999)).toBe(5);
    expect(burstShots("semi", () => 0.5)).toBe(SEMI_FIRE_NUM_SHOTS[6]);
    expect(burstShots("single", () => 0.9)).toBe(1);
    expect(burstShots("full", () => 0)).toBe(Infinity);
  });

  it("pauses after a burst as combat_utility does, a sniper by its skill", () => {
    expect(burstDelay("regular", "rifle", () => 0)).toBe(0.4);
    expect(burstDelay("regular", "rifle", () => 1)).toBe(0.9);
    expect(burstDelay("regular", "pistol", () => 0)).toBe(0.15);
    expect(burstDelay("regular", "spread", () => 1)).toBe(1.7);
    expect(burstDelay("recruit", "sniper", () => 0)).toBe(3.0);
    expect(burstDelay("veteran", "sniper", () => 1)).toBe(1.5);
  });

  it("waits playerGrenadeBaseTime plus up to playerGrenadeRangeTime between grenades", () => {
    expect(grenadeWait("recruit", () => 0)).toBe(40);
    expect(grenadeWait("regular", () => 1)).toBe(50);
    expect(grenadeWait("veteran", () => 0.5)).toBe(30);
  });

  it("finds a throw that reaches a target, and none for one out of reach", () => {
    expect(throwPitch(10, 0)).not.toBeNull();
    expect(throwPitch(5, 0)!).toBeLessThan(throwPitch(20, 0)!);
    expect(throwPitch(80, 0)).toBeNull();
  });
});

describe("Call of Duty MW3 Combat Brain", () => {
  it("registers in the BRAINS table under 'combat'", () => {
    expect(brainFor(COMBAT_BRAIN)).toBe(combatBrain);
    expect(combatBrain.id).toBe("combat");
  });

  it("takes the lobby's difficulty, and regular for one it does not know", () => {
    expect(bot("veteran").memory.difficulty).toBe("veteran");
    const self = bot("regular").self;
    expect((combatBrain.init(self, () => 0.5, { difficulty: "godmode" }) as CombatMemory).difficulty).toBe("regular");
  });

  it("ignores teammates and the dead", () => {
    const { self, memory } = bot("regular");
    const players: TestPlayer[] = [
      { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
      { id: "friend", team: "allies", feet: at([0, 0, -5]) },
      { id: "corpse", team: "axis", feet: at([0, 0, -6]), alive: false },
    ];
    const goal = combatBrain.think(mockContext({ players, now: 1 }), self, memory);
    expect(memory.targetId).toBeNull();
    expect(fireOf(goal)).toBeUndefined();
  });

  it("does not see an opponent behind it, or one behind a wall", () => {
    const { self, memory } = bot("veteran");
    const behind: TestPlayer[] = [
      { id: "#b1", team: "allies", feet: at([0, 0, 0]) },
      { id: "enemy", team: "axis", feet: at([0, 0, 10]) },
    ];
    combatBrain.think(mockContext({ players: behind, now: 1 }), self, memory);
    expect(memory.targetId).toBeNull();
    combatBrain.think(mockContext({ players: duel(10), now: 2, hasLineOfSight: () => false }), self, memory);
    expect(memory.targetId).toBeNull();
  });

  it("hunts the nearest opponent it cannot see, as Survival sends its AI at the players", () => {
    const { self, memory } = bot("regular");
    const goal = combatBrain.think(mockContext({ players: duel(15), now: 1, hasLineOfSight: () => false }), self, memory);
    expect(goal.kind).toBe("moveTo");
    if (goal.kind === "moveTo") {
      expect(goal.track).toBe("enemy");
      expect(goal.run).toBe(true);
    }
  });

  it("misses a recruit's miss time on purpose, then aims at the chest", () => {
    const { self, memory, roll } = bot("recruit");
    roll.value = 0; // every roll a hit, once the miss time is over
    const distance = 15; // 590 units: 1.0 + 0.47 s of misses, from 1 s to 2.47 s
    const first = combatBrain.think(mockContext({ players: duel(distance), now: 1 }), self, memory);
    expect(memory.missUntil).toBeCloseTo(1 + missTime("recruit", distance / 0.0254));
    expect(aimOff(first, distance)).toBeGreaterThanOrEqual(MISS_OFFSET[0] - 1e-9);
    const during = combatBrain.think(mockContext({ players: duel(distance), now: 2.4 }), self, memory);
    expect(aimOff(during, distance)).toBeGreaterThanOrEqual(MISS_OFFSET[0] - 1e-9);
    const later = combatBrain.think(mockContext({ players: duel(distance), now: 2.5 }), self, memory);
    expect(aimOff(later, distance)).toBeLessThan(1e-6);
  });

  it("gives a veteran no miss time: its first shot may land", () => {
    const { self, memory, roll } = bot("veteran");
    roll.value = 0;
    const goal = combatBrain.think(mockContext({ players: duel(15), now: 1 }), self, memory);
    expect(memory.missUntil).toBe(1);
    expect(aimOff(goal, 15)).toBeLessThan(1e-6);
    expect(fireOf(goal)).toBe(true);
    expect("ads" in goal && goal.ads).toBe(true);
  });

  it("aims a shot rolled to miss beside the target", () => {
    const { self, memory, roll } = bot("veteran");
    roll.value = 0.99; // above any hit chance
    const goal = combatBrain.think(mockContext({ players: duel(10), now: 1 }), self, memory);
    expect(memory.nextHits).toBe(false);
    expect(aimOff(goal, 10)).toBeGreaterThanOrEqual(MISS_OFFSET[0] - 1e-9);
    expect(aimOff(goal, 10)).toBeLessThanOrEqual(Math.hypot(MISS_OFFSET[1], 0.2) + 1e-9);
  });

  it("fires a burst of the drawn length, counted off the magazine, then pauses", () => {
    const { self, memory, roll } = bot("veteran");
    roll.value = 0; // a burst of 1, and the shortest pause
    const weapon = { ammo: 30, clipSize: 30, state: "idle" as const, weaponClass: "rifle", fireType: "Full Auto" };
    const at10 = (now: number, ammo: number) => combatBrain.think(mockContext({ players: duel(u(500) / 1, { ...weapon, ammo }), now }), self, memory);
    expect(fireOf(at10(1, 30))).toBe(true);
    expect(memory.style).toBe("burst");
    expect(memory.shotsLeft).toBe(1);
    expect(fireOf(at10(1.05, 29))).toBe(false); // the round went: the pause, 0.4 s, has begun
    expect(memory.pauseUntil).toBeCloseTo(1.05 + 0.4);
    expect(fireOf(at10(1.3, 29))).toBe(false);
    expect(fireOf(at10(1.5, 29))).toBe(true);
  });

  it("taps a semi-automatic, letting go of the trigger between shots", () => {
    const { self, memory, roll } = bot("veteran");
    roll.value = 0.999; // the longest semi burst
    const weapon = { ammo: 20, clipSize: 20, state: "idle" as const, weaponClass: "rifle", fireType: "Single Shot" };
    const fires = [1, 1.05, 1.1, 1.15].map((now) => fireOf(combatBrain.think(mockContext({ players: duel(8, weapon), now }), self, memory)));
    expect(memory.style).toBe("semi");
    expect(fires).toEqual([true, false, true, false]);
  });

  it("reloads an empty magazine instead of firing", () => {
    const { self, memory } = bot("regular");
    const weapon = { ammo: 0, clipSize: 30, state: "idle" as const, weaponClass: "rifle", fireType: "Full Auto" };
    const goal = combatBrain.think(mockContext({ players: duel(10, weapon), now: 1 }), self, memory);
    expect("reload" in goal && goal.reload).toBe(true);
    expect(fireOf(goal)).toBe(false);
  });

  it("reloads a half-empty magazine when nobody is in sight", () => {
    const { self, memory } = bot("regular");
    const weapon = { ammo: 10, clipSize: 30, state: "idle" as const, weaponClass: "rifle", fireType: "Full Auto" };
    const goal = combatBrain.think(mockContext({ players: duel(10, weapon), now: 1, hasLineOfSight: () => false }), self, memory);
    expect("reload" in goal && goal.reload).toBe(true);
  });

  it("holds its ground within the soldier's engagement range, walks in beyond it, and runs past the falloff", () => {
    const within = bot("regular");
    expect(combatBrain.think(mockContext({ players: duel(u(600)), now: 1 }), within.self, within.memory).kind).toBe("look");

    const beyond = bot("regular");
    const walk = combatBrain.think(mockContext({ players: duel(u(900)), now: 1 }), beyond.self, beyond.memory);
    expect(walk.kind).toBe("moveTo");
    if (walk.kind === "moveTo") {
      expect(walk.run).toBe(false);
      expect(walk.fire).toBe(true);
    }

    const far = bot("regular");
    const run = combatBrain.think(mockContext({ players: duel(u(1200)), now: 1 }), far.self, far.memory);
    expect(run.kind).toBe("moveTo");
    if (run.kind === "moveTo") {
      expect(run.run).toBe(true);
      expect(run.fire).toBeUndefined();
    }
  });

  it("knifes an opponent within MW3's melee range", () => {
    const { self, memory } = bot("regular");
    const goal = combatBrain.think(mockContext({ players: duel(u(60)), now: 1 }), self, memory);
    expect("melee" in goal && goal.melee).toBe(true);
    const further = bot("regular");
    const shot = combatBrain.think(mockContext({ players: duel(u(100)), now: 1 }), further.self, further.memory);
    expect("melee" in shot && shot.melee).toBe(false);
  });

  it("throws its grenade once the skill's timer runs out, holds the throw, and waits again", () => {
    const { self, memory, roll } = bot("veteran");
    // The first timer was drawn at 0.5: 25 + 0.5 x 10 s. From here every draw is 0, so the next is 25 s on.
    expect(memory.grenadeReadyAt).toBe(30);
    roll.value = 0;
    const early = combatBrain.think(mockContext({ players: duel(12), now: 10 }), self, memory);
    expect("lethal" in early && early.lethal).toBeFalsy();

    const throwing = combatBrain.think(mockContext({ players: duel(12), now: 30 }), self, memory);
    expect("lethal" in throwing && throwing.lethal).toBe(true);
    expect(aimOf(throwing)!.y).toBeGreaterThan(0); // pitched for the arc
    expect(memory.grenadeReadyAt).toBe(55);
    const held = combatBrain.think(mockContext({ players: duel(12), now: 30.3 }), self, memory);
    expect(aimOf(held)).toEqual(aimOf(throwing));
    expect(fireOf(held)).toBe(false);
  });

  it("never throws at an opponent inside the frag's own blast", () => {
    const { self, memory, roll } = bot("veteran");
    roll.value = 0;
    const goal = combatBrain.think(mockContext({ players: duel(u(200)), now: 60 }), self, memory);
    expect("lethal" in goal && goal.lethal).toBeFalsy();
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
