import "reflect-metadata";

// Tests for a match running Team Deathmatch (TDM) gametype on the game server.

import { describe, expect, it } from "vitest";
import type { ResolvedWorld } from "@3d/shared/dsl/resolved.js";
import { catalogueViewOf } from "@3d/shared/game/catalogueView.js";
import { tdmGametype } from "@3d/shared/game/gametypes/tdm.js";
import { tdmScript } from "@3d/shared/game/scripts/tdm.js";
import type { Script } from "@3d/shared/game/hooks.js";
import type { PlayerId } from "@3d/shared/net/messages/fields.js";
import type { InputMessage } from "@3d/shared/net/messages/input.js";
import type { CapsuleWorld } from "@3d/shared/sim/capsule.js";
import { idleInput } from "@3d/shared/sim/input.js";
import type { Loadout } from "@3d/shared/sim/loadout.js";
import { CATALOG_VERSION, WeaponRegistry } from "@3d/shared/sim/weaponRegistry.js";
import { NO_BODIES } from "../src/bodies.js";
import { Match } from "../src/match/match.js";

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
      { position: { x: 0, y: 1.6, z: 0 }, look: { x: 0, y: 1.6, z: -1 }, modes: ["tdm"], team: "allies" },
      { position: { x: 10, y: 1.6, z: 0 }, look: { x: 10, y: 1.6, z: -1 }, modes: ["tdm"], team: "axis" },
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

function testLoadout(): Loadout {
  return { name: "Default", game: "iw5", primary: { weapon: null, attachments: [] }, secondary: { weapon: null, attachments: [] } };
}

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
});
