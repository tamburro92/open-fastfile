import "reflect-metadata";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { catalogueViewOf } from "@3d/shared/game/catalogueView.js";
import type { CastChoice } from "@3d/shared/game/cast.js";
import { ffaGametype } from "@3d/shared/game/gametypes/ffa.js";
import { ffaScript } from "@3d/shared/game/scripts/ffa.js";
import type { Script } from "@3d/shared/game/hooks.js";
import type { InputMessage } from "@3d/shared/net/messages/input.js";
import { idleInput, type PlayerInput } from "@3d/shared/sim/input.js";
import type { Loadout } from "@3d/shared/sim/loadout.js";
import type { HitLocation } from "@3d/shared/sim/hitLocations.js";
import { CATALOG_VERSION, WeaponRegistry, type WeaponEntry } from "@3d/shared/sim/weaponRegistry.js";
import { weaponDef } from "@3d/shared/testing/weaponDef.js";
import type { BodyView, LoadedBody } from "../src/bodies.js";
import { Match } from "../src/match/match.js";
import type { ResolvedWorld } from "@3d/shared/dsl/resolved.js";
import { testApp } from "@3d/api/testing/app.js";
import { createApiClient } from "@3d/shared/protocol/api.js";
import type { HttpFetch } from "@3d/shared/protocol/http.js";
import { Bodies } from "../src/bodies.js";
import type { Api } from "../src/api.js";
import type { Weapons } from "../src/weapons.js";
import * as path from "path";

const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const GAME = "iw5";
const ARMED = "iw5/test_mp";
const SHOT_RANGE = 8192 / 39.37;
const UNITS_PER_M = 39.37;

const ground = {
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

function world(): ResolvedWorld {
  return {
    game: GAME,
    spawn: { position: { x: 0, y: 1.6, z: 0 }, look: { x: 0, y: 1.6, z: -1 } },
    spawnPoints: [
      { mode: "dm", team: undefined, start: true, position: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: -5 } },
      { mode: "dm", team: undefined, start: true, position: { x: 0, y: 0, z: -5 }, look: { x: 0, y: 0, z: 0 } },
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

function carrying(): Loadout {
  return { name: "Test", game: "iw5", primary: { weapon: ARMED, attachments: [] }, secondary: { weapon: null, attachments: [] } };
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

describe("FFA combat shooting", () => {
  it("loads all real bodies from worlds/catalog", async () => {
    const worldsRoot = path.resolve(import.meta.dirname, "../../../worlds");
    const { app } = testApp({ worldsRoot });
    const client = createApiClient({ fetch: app.request.bind(app) as HttpFetch });
    const index = await client.catalogIndex();
    const chars = (index as { characters?: unknown[] }).characters;
    expect(chars?.length).toBeGreaterThan(0);
    const weapons = new WeaponRegistry(index.weapons as WeaponEntry[]);
    const catalogue = catalogueViewOf(index, weapons);
    const bodies = new Bodies({ client } as unknown as Api, { catalogue } as unknown as Weapons);
    await bodies.load();
    expect(bodies.size).toBe(4);
  });

  it("allows player 1 to shoot and hurt player 2 with stub bodies", () => {
    const castScript: Script = {
      id: "cast-stub",
      client: { cast: () => CAST },
    };

    const match = new Match(ground, world(), TICK_RATE, 8, registry(), {
      map: "test-map",
      gametype: ffaGametype,
      scoreLimit: 10,
      durationSeconds: 600,
      catalogue: catalogueViewOf({ version: CATALOG_VERSION }, new WeaponRegistry([])),
      bodies: stubBodies("torsoUpper", 5),
      scripts: [ffaScript, castScript],
    });

    match.join("p1", carrying());
    match.join("p2", carrying());

    let seq = 0;
    const message = (input: PlayerInput): InputMessage => ({
      seq: ++seq,
      dt: DT,
      input,
      claim: { x: 0, y: 0, z: 0 },
      drawn: { tick: 0, frac: 0 },
    });

    const step = (p1Input: PlayerInput, p2Input: PlayerInput = idleInput(0, 0)) => {
      match.receive("p1", message(p1Input));
      match.receive("p2", message(p2Input));
      return match.step();
    };

    for (let i = 0; i < 60; i++) {
      step(idleInput(0, 0));
    }

    let shotsFired = 0;
    for (let i = 0; i < 30; i++) {
      step({ ...idleInput(0, 0), fire: true });
      if (match.shotsThisTick.length > 0) {
        shotsFired += match.shotsThisTick.length;
        break;
      }
    }

    expect(shotsFired).toBeGreaterThan(0);
    let snap = match.snapshotFor("p1", match.step().players);
    let p2State = snap.players.find((p) => p.id === "p2")?.state;
    expect(p2State?.health).toBe(50);

    // Fire second shot to kill P2:
    for (let i = 0; i < 30; i++) {
      step({ ...idleInput(0, 0), fire: true });
      if (match.shotsThisTick.length > 0) {
        break;
      }
    }

    snap = match.snapshotFor("p1", match.step().players);
    p2State = snap.players.find((p) => p.id === "p2")?.state;
    expect(p2State?.dead).toBe(true);
    const p1State = snap.players.find((p) => p.id === "p1")?.state;
    expect(p1State?.points).toBe(1);
  });

  it("allows player 1 to hit player 2 even when body is undefined (capsule fallback)", () => {
    const castScript: Script = {
      id: "cast-stub",
      client: { cast: () => CAST },
    };

    const match = new Match(ground, world(), TICK_RATE, 8, registry(), {
      map: "test-map",
      gametype: ffaGametype,
      scoreLimit: 10,
      durationSeconds: 600,
      catalogue: catalogueViewOf({ version: CATALOG_VERSION }, new WeaponRegistry([])),
      bodies: { get: () => undefined }, // NO BODIES LOADED!
      scripts: [ffaScript, castScript],
    });

    match.join("p1", carrying());
    match.join("p2", carrying());

    let seq = 0;
    const message = (input: PlayerInput): InputMessage => ({
      seq: ++seq,
      dt: DT,
      input,
      claim: { x: 0, y: 0, z: 0 },
      drawn: { tick: 0, frac: 0 },
    });

    const step = (p1Input: PlayerInput, p2Input: PlayerInput = idleInput(0, 0)) => {
      match.receive("p1", message(p1Input));
      match.receive("p2", message(p2Input));
      return match.step();
    };

    for (let i = 0; i < 60; i++) {
      step(idleInput(0, 0));
    }

    for (let i = 0; i < 30; i++) {
      step({ ...idleInput(0, 0), fire: true });
      if (match.shotsThisTick.length > 0) {
        break;
      }
    }

    const snap = match.snapshotFor("p1", match.step().players);
    const hitTarget = snap.players.find((p) => p.id === "#b1")?.state;
    expect(hitTarget?.health).toBe(50);
  });
});
