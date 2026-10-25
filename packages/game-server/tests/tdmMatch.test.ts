import "reflect-metadata";

// Tests for a match running Team Deathmatch (TDM) gametype on the game server.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ResolvedWorld } from "@3d/shared/dsl/resolved.js";
import { catalogueViewOf } from "@3d/shared/game/catalogueView.js";
import type { CastChoice } from "@3d/shared/game/cast.js";
import { tdmGametype } from "@3d/shared/game/gametypes/tdm.js";
import { tdmScript } from "@3d/shared/game/scripts/tdm.js";
import type { Script } from "@3d/shared/game/hooks.js";
import type { PlayerId } from "@3d/shared/net/messages/fields.js";
import type { InputMessage } from "@3d/shared/net/messages/input.js";
import type { CapsuleWorld } from "@3d/shared/sim/capsule.js";
import { idleInput, type PlayerInput } from "@3d/shared/sim/input.js";
import type { Loadout } from "@3d/shared/sim/loadout.js";
import type { HitLocation } from "@3d/shared/sim/hitLocations.js";
import { CATALOG_VERSION, WeaponRegistry, type WeaponEntry } from "@3d/shared/sim/weaponRegistry.js";
import { weaponDef } from "@3d/shared/testing/weaponDef.js";
import { NO_BODIES, type BodyView, type LoadedBody } from "../src/bodies.js";
import { Match } from "../src/match/match.js";

const GAME = "iw5";
const ARMED = "iw5/test_mp";
const SHOT_RANGE = 8192 / 39.37;
const UNITS_PER_M = 39.37;

const ground: CapsuleWorld = {
  ready: true,
  resolveCapsule(
    position: { x: number; y: number; z: number },
    _r: number,
    _h: number,
    out?: { position: { x: number; y: number; z: number }; grounded: boolean; normal: { x: number; y: number; z: number } },
  ) {
    const result = out ?? { position: { x: 0, y: 0, z: 0 }, grounded: false, normal: { x: 0, y: 0, z: 0 } };
    result.position.x = position.x;
    result.position.y = Math.max(position.y, 0);
    result.position.z = position.z;
    result.grounded = position.y <= 0;
    result.normal.x = 0;
    result.normal.y = result.grounded ? 1 : 0;
    result.normal.z = 0;
    return result;
  },
  overlapsCapsule: (position: { y: number }) => position.y < 0,
  overlapsSweep: (from: { y: number }, to: { y: number }, radius: number) => Math.min(from.y, to.y) < radius,
  groundBelow: (from: { y: number }, distance: number, normal?: { x: number; y: number; z: number }) => {
    if (from.y < 0 || from.y - distance > 0) {
      return null;
    }
    if (normal) {
      normal.x = 0;
      normal.y = 1;
      normal.z = 0;
    }
    return 0;
  },
  surfaceAt: () => null,
  traceRay: () => null,
};

function testWorld(): ResolvedWorld {
  return {
    game: "iw5",
    spawn: { position: { x: 0, y: 1.6, z: 0 }, look: { x: 0, y: 1.6, z: -1 } },
    spawnPoints: [
      { position: { x: 0, y: 1.6, z: 0 }, look: { x: 0, y: 1.6, z: -5 }, modes: ["tdm"], team: "allies", start: true },
      { position: { x: 5, y: 1.6, z: 5 }, look: { x: 5, y: 1.6, z: -5 }, modes: ["tdm"], team: "allies", start: true },
      { position: { x: -5, y: 1.6, z: 5 }, look: { x: -5, y: 1.6, z: -5 }, modes: ["tdm"], team: "allies", start: true },
      { position: { x: 0, y: 1.6, z: -5 }, look: { x: 0, y: 1.6, z: 0 }, modes: ["tdm"], team: "axis", start: true },
      { position: { x: 5, y: 1.6, z: -10 }, look: { x: 5, y: 1.6, z: 0 }, modes: ["tdm"], team: "axis", start: true },
      { position: { x: -5, y: 1.6, z: -10 }, look: { x: -5, y: 1.6, z: 0 }, modes: ["tdm"], team: "axis", start: true },
    ],
    triggers: [],
    mantles: [],
    ladders: [],
    points: [],
    solids: [],
    rooms: [],
    topLevelObjects: [],
  } as unknown as ResolvedWorld;
}

function registry(): WeaponRegistry {
  const entries: WeaponEntry[] = [
    {
      id: "test_mp",
      game: GAME,
      slot: "primary",
      class: "rifle",
      def: weaponDef({
        clipSize: 30,
        damage: { max: 50, min: 30, maxRange: 10 * UNITS_PER_M, minRange: 30 * UNITS_PER_M },
        locationDamage: { head: 1.5, torsoUpper: 1.0 },
      }),
      attachments: [],
    },
  ];
  return new WeaponRegistry(entries);
}

function armedLoadout(): Loadout {
  return { name: "Default", game: "iw5", primary: { weapon: ARMED, attachments: [] }, secondary: { weapon: null, attachments: [] } };
}

function testLoadout(): Loadout {
  return { name: "Default", game: "iw5", primary: { weapon: null, attachments: [] }, secondary: { weapon: null, attachments: [] } };
}

function stubBodies(location: HitLocation, distance: number): BodyView {
  const body = {
    id: "dummy",
    game: GAME,
    rig: { root: new THREE.Object3D() },
    poser: { update: () => undefined },
    boxes: { trace: () => ({ bone: "j_spine4", location, fraction: distance / SHOT_RANGE }) },
  } as unknown as LoadedBody;
  return { get: () => body };
}

const CAST: CastChoice = {
  characters: [{ id: "dummy", body: { kind: "characters", game: GAME, id: "dummy", file: "dummy.glb" } }],
  animations: { kind: "animations", game: GAME, id: "clips", file: "clips.glb" },
  hands: { kind: "hands", game: GAME, id: "hands", file: "hands.glb" },
  defaultWeapon: null,
};

describe("TDM Match in Game Server", () => {
  it("runs TDM match, balances teams, tracks team scores, and concludes on score limit", () => {
    let inflictDamage: ((victim: PlayerId, killer: PlayerId) => void) | undefined;
    const testDamageScript: Script = {
      id: "test-damage",
      server: {
        tick: (ctx) => {
          inflictDamage = (victim, killer) => {
            ctx.damage(victim, 200, killer, "bullet");
          };
        },
      },
    };

    const match = new Match(ground, testWorld(), 60, 8, new WeaponRegistry([]), {
      map: "test-map",
      gametype: tdmGametype,
      scoreLimit: 2,
      durationSeconds: 300,
      catalogue: catalogueViewOf({ version: CATALOG_VERSION }, new WeaponRegistry([])),
      bodies: NO_BODIES,
      scripts: [tdmScript, testDamageScript],
    });

    const p1: PlayerId = "p1";
    const p2: PlayerId = "p2";

    match.join(p1, testLoadout());
    match.join(p2, testLoadout());

    let seq = 0;
    const message = (input = idleInput(0, 0)): InputMessage => ({
      seq: ++seq,
      dt: 1 / 60,
      input,
      claim: { x: 0, y: 0, z: 0 },
      drawn: { tick: 0, frac: 0 },
    });

    const step = () => {
      match.receive(p1, message());
      match.receive(p2, message());
      return match.step();
    };

    // First step initializes scripts and team balances:
    let snapshot = step();
    let snap1 = match.snapshotFor(p1, snapshot.players);
    // Counters: [alliesScore, axisScore, scoreLimit, timeLeft]
    expect(snap1.counters).toEqual([0, 0, 2, 300]);
    // P1 was joined first -> team 0 (allies), P2 joined second -> team 1 (axis):
    expect(snap1.players.find((p) => p.id === p1)?.state.team).toBe(0);
    expect(snap1.players.find((p) => p.id === p2)?.state.team).toBe(1);
    expect(snap1.players.find((p) => p.id === p1)?.state.points).toBe(0);

    // P1 (allies) kills P2 (axis):
    inflictDamage!(p2, p1);
    snapshot = step();

    snap1 = match.snapshotFor(p1, snapshot.players);
    // P1 has 1 kill:
    expect(snap1.players.find((p) => p.id === p1)?.state.points).toBe(1);
    // Allies team score counter is 1:
    expect(snap1.counters[0]).toBe(1);
    expect(snap1.counters[1]).toBe(0);
    expect(match.ended).toBeUndefined();

    // Advance 2.5 seconds (150 ticks) for P2 to respawn:
    for (let i = 0; i < 150; i++) {
      step();
    }

    // P1 kills P2 a second time (reaches Allies score limit 2):
    inflictDamage!(p2, p1);
    snapshot = step();

    snap1 = match.snapshotFor(p1, snapshot.players);
    expect(snap1.players.find((p) => p.id === p1)?.state.points).toBe(2);
    expect(snap1.counters[0]).toBe(2);
    // During 5s post-match cooldown, players view the tactical scoreboard:
    expect(match.ended).toBeUndefined();

    // Advance 5 seconds (300 ticks) through post-match cooldown:
    for (let i = 0; i < 300; i++) {
      step();
    }
    expect(match.ended).toBe("scoreLimitReached");
  });

  it("friendly fire is off: teammates do not take bullet damage and teamkills award no points", () => {
    let inflictDamage: ((victim: PlayerId, killer: PlayerId) => void) | undefined;
    const testDamageScript: Script = {
      id: "test-damage",
      server: {
        tick: (ctx) => {
          inflictDamage = (victim, killer) => {
            ctx.damage(victim, 50, killer, "bullet");
          };
        },
      },
    };

    const match = new Match(ground, testWorld(), 60, 8, new WeaponRegistry([]), {
      map: "test-map",
      gametype: tdmGametype,
      scoreLimit: 75,
      durationSeconds: 600,
      catalogue: catalogueViewOf({ version: CATALOG_VERSION }, new WeaponRegistry([])),
      bodies: NO_BODIES,
      scripts: [tdmScript, testDamageScript],
    });

    const p1: PlayerId = "p1";
    const p2: PlayerId = "p2";
    const p3: PlayerId = "p3";

    match.join(p1, testLoadout()); // allies (side 0)
    match.join(p2, testLoadout()); // axis (side 1)
    match.join(p3, testLoadout()); // allies (side 0)

    let seq = 0;
    const message = (input = idleInput(0, 0)): InputMessage => ({
      seq: ++seq,
      dt: 1 / 60,
      input,
      claim: { x: 0, y: 0, z: 0 },
      drawn: { tick: 0, frac: 0 },
    });

    const step = () => {
      match.receive(p1, message());
      match.receive(p2, message());
      match.receive(p3, message());
      return match.step();
    };

    step();
    // Confirm p1 and p3 are teammates on Allies (team 0):
    const snap1 = match.snapshotFor(p1, match.step().players);
    expect(snap1.players.find((p) => p.id === p1)?.state.team).toBe(0);
    expect(snap1.players.find((p) => p.id === p3)?.state.team).toBe(0);

    // P1 attacks teammate P3:
    inflictDamage!(p3, p1);
    step();

    const snapTeammate = match.snapshotFor(p1, match.step().players);
    const p3State = snapTeammate.players.find((p) => p.id === p3)?.state;
    // Friendly fire is off: P3 takes 0 damage and health stays 100:
    expect(p3State?.health).toBe(100);
    // Allies score stays 0:
    expect(snapTeammate.counters[0]).toBe(0);
    expect(snapTeammate.players.find((p) => p.id === p1)?.state.points).toBe(0);
  });

  it("allows player 1 on Allies to shoot and damage Axis bot using realistic weapon firing", () => {
    const castScript: Script = {
      id: "cast-stub",
      client: { cast: () => CAST },
    };

    const match = new Match(ground, testWorld(), 60, 8, registry(), {
      map: "test-map",
      gametype: tdmGametype,
      scoreLimit: 10,
      durationSeconds: 600,
      catalogue: catalogueViewOf({ version: CATALOG_VERSION }, new WeaponRegistry([])),
      bodies: stubBodies("torsoUpper", 5),
      scripts: [tdmScript, castScript],
    });

    match.join("p1", armedLoadout());

    let seq = 0;
    const message = (input: PlayerInput): InputMessage => ({
      seq: ++seq,
      dt: 1 / 60,
      input,
      claim: { x: 0, y: 0, z: 0 },
      drawn: { tick: 0, frac: 0 },
    });

    const step = (p1Input: PlayerInput) => {
      match.receive("p1", message(p1Input));
      return match.step();
    };

    // Warmup 60 ticks:
    for (let i = 0; i < 60; i++) {
      step(idleInput(0, 0));
    }

    // P1 fires rifle directly forward at Axis bot:
    for (let i = 0; i < 30; i++) {
      step({ ...idleInput(0, 0), fire: true });
      if (match.shotsThisTick.length > 0) {
        break;
      }
    }

    expect(match.shotsThisTick.length).toBeGreaterThan(0);
    let snap = match.snapshotFor("p1", match.step().players);
    // Axis bot #b3 was positioned in front and took 50 bullet damage (health 100 -> 50):
    let axisTarget = snap.players.find((p) => p.id === "#b3")?.state;
    expect(axisTarget?.health).toBe(50);
    expect(snap.counters[0]).toBe(0); // Allies team score still 0

    // Fire second shot to eliminate Axis bot:
    for (let i = 0; i < 30; i++) {
      step({ ...idleInput(0, 0), fire: true });
      if (match.shotsThisTick.length > 0) {
        break;
      }
    }

    snap = match.snapshotFor("p1", match.step().players);
    axisTarget = snap.players.find((p) => p.id === "#b3")?.state;
    expect(axisTarget?.dead).toBe(true);

    const p1State = snap.players.find((p) => p.id === "p1")?.state;
    // Exactly +1 kill awarded to P1:
    expect(p1State?.points).toBe(1);
    // Exactly +1 score awarded to Allies:
    expect(snap.counters[0]).toBe(1);
    // Axis score remains 0:
    expect(snap.counters[1]).toBe(0);
  });

  it("allows player to choose team on join and switch teams mid-match", () => {
    const match = new Match(ground, testWorld(), 60, 8, new WeaponRegistry([]), {
      map: "test-map",
      gametype: tdmGametype,
      scoreLimit: 75,
      durationSeconds: 600,
      catalogue: catalogueViewOf({ version: CATALOG_VERSION }, new WeaponRegistry([])),
      bodies: NO_BODIES,
      scripts: [tdmScript],
    });

    const p1: PlayerId = "p1";
    // Join explicitly on side 1 (Axis):
    match.join(p1, testLoadout(), "", 0, 1);

    let seq = 0;
    const message = (input = idleInput(0, 0)): InputMessage => ({
      seq: ++seq,
      dt: 1 / 60,
      input,
      claim: { x: 0, y: 0, z: 0 },
      drawn: { tick: 0, frac: 0 },
    });

    match.receive(p1, message());
    match.step();

    const snap = match.snapshotFor(p1, match.step().players);
    // Confirm player is on Axis (team 1):
    expect(snap.players.find((p) => p.id === p1)?.state.team).toBe(1);
    expect(snap.players.find((p) => p.id === p1)?.state.dead).toBe(false);
    expect(snap.players.find((p) => p.id === p1)?.state.health).toBe(100);

    // Player switches team mid-match to Allies:
    match.setTeam(p1, "allies");
    match.killForTeamSwitch(p1);
    match.receive(p1, message());
    match.step();

    const snapSwitched = match.snapshotFor(p1, match.step().players);
    const p1Switched = snapSwitched.players.find((p) => p.id === p1)?.state;
    // Confirm player team changed to Allies (team 0):
    expect(p1Switched?.team).toBe(0);
    // Changing team while alive eliminates the player so they respawn on new team:
    expect(p1Switched?.dead).toBe(true);
  });
});
