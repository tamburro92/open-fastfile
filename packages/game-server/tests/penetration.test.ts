// A round going through things, as MW3's server lets it (game/penetration.ts):
// a wall its type and the wall's material allow, at the cost of what it keeps,
// and never one the table says it cannot.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ResolvedWorld } from "@3d/shared/dsl/resolved.js";
import { catalogueViewOf } from "@3d/shared/game/catalogueView.js";
import type { CastChoice } from "@3d/shared/game/cast.js";
import { defaultGametype } from "@3d/shared/game/gametypes/default.js";
import type { Script } from "@3d/shared/game/hooks.js";
import type { PlayerId } from "@3d/shared/net/messages/fields.js";
import type { InputMessage } from "@3d/shared/net/messages/input.js";
import type { PlayerSnapshot } from "@3d/shared/net/messages/snapshot.js";
import type { RayHit, Vec3 } from "@3d/shared/sim/capsule.js";
import { idleInput, type PlayerInput } from "@3d/shared/sim/input.js";
import type { Loadout } from "@3d/shared/sim/loadout.js";
import type { SurfaceType } from "@3d/shared/sim/surfaces.js";
import { UNIT } from "@3d/shared/sim/units.js";
import { CATALOG_VERSION, WeaponRegistry, type WeaponEntry } from "@3d/shared/sim/weaponRegistry.js";
import { weaponDef } from "@3d/shared/testing/weaponDef.js";
import type { BodyView, LoadedBody } from "../src/bodies.js";
import { Match } from "../src/match/match.js";

const TICK_RATE = 60;
const GAME = "iw5";

/** A wall across the shot, from `near` to `far` metres down -z, made of `surface`. */
interface Wall {
  near: number;
  far: number;
  surface: SurfaceType;
}

/** Where the body behind it stands: its front at `BODY_FRONT`, 30 cm deep. */
const BODY_FRONT = 5;
const BODY_DEPTH = 0.3;

/** A floor, and walls answering a ray from either side, as the collision soup does. */
function worldWith(walls: Wall[]) {
  return {
    ready: true,
    resolveCapsule(position: Vec3, _r: number, _h: number, out?: { position: Vec3; grounded: boolean; normal: Vec3 }) {
      const result = out ?? { position: { x: 0, y: 0, z: 0 }, grounded: false, normal: { x: 0, y: 0, z: 0 } };
      result.position = { x: position.x, y: Math.max(position.y, 0), z: position.z };
      result.grounded = position.y <= 0;
      result.normal = { x: 0, y: result.grounded ? 1 : 0, z: 0 };
      return result;
    },
    overlapsCapsule: (p: Vec3) => p.y < 0,
    overlapsSweep: (from: Vec3, to: Vec3, radius: number) => Math.min(from.y, to.y) < radius,
    groundBelow: (from: Vec3, distance: number) => (from.y < 0 || from.y - distance > 0 ? null : 0),
    surfaceAt: () => null,
    traceRay(from: Vec3, direction: Vec3, distance: number, _channel: string, out?: RayHit): RayHit | null {
      if (direction.z === 0) {
        return null;
      }
      let best: { t: number; surface: SurfaceType } | null = null;
      for (const wall of walls) {
        for (const face of [wall.near, wall.far]) {
          const t = (-face - from.z) / direction.z;
          if (t > 1e-9 && t <= distance && (best === null || t < best.t)) {
            best = { t, surface: wall.surface };
          }
        }
      }
      if (best === null) {
        return null;
      }
      const hit = out ?? { distance: 0, normal: { x: 0, y: 0, z: 0 }, kind: "map" as const, surface: "default" as SurfaceType };
      hit.distance = best.t;
      hit.normal = { x: 0, y: 0, z: 1 };
      hit.kind = "map";
      hit.surface = best.surface;
      return hit;
    },
  };
}

/** One body, a slab across the shot: a segment's entry into it as a fraction, whichever way it runs. */
function slabBody(): BodyView {
  const front = -BODY_FRONT;
  const back = -(BODY_FRONT + BODY_DEPTH);
  const body = {
    id: "dummy",
    game: GAME,
    rig: { root: new THREE.Object3D() },
    poser: { update: () => undefined },
    boxes: {
      trace(from: Vec3, to: Vec3) {
        const dz = to.z - from.z;
        if (dz === 0) {
          return null;
        }
        // The face it meets first, going from `from` to `to`.
        const first = dz < 0 ? Math.min(front, Math.max(back, from.z)) : Math.max(back, Math.min(front, from.z));
        const fraction = (first - from.z) / dz;
        return fraction >= 0 && fraction <= 1 ? { bone: "j_spine4", location: "torsoUpper", fraction } : null;
      },
    },
  } as unknown as LoadedBody;
  return { get: () => body };
}

const CAST: CastChoice = {
  characters: [{ id: "dummy", body: { kind: "characters", game: GAME, id: "dummy", file: "dummy.glb" } }],
  animations: { kind: "animations", game: GAME, id: "clips", file: "clips.glb" },
  hands: { kind: "hands", game: GAME, id: "hands", file: "hands.glb" },
  defaultWeapon: null,
};

/** 40 everywhere this test shoots, a chest at 0.8: an unobstructed round costs trunc(0.8f × 40) = 32. */
function shoot(walls: Wall[], penetrateType: string) {
  const registry = new WeaponRegistry([
    {
      id: "test_mp",
      game: GAME,
      slot: "primary",
      class: "rifle",
      def: weaponDef({ clipSize: 30, damage: { max: 40, min: 40 }, locationDamage: { torsoUpper: 0.8 }, penetrateType }),
      attachments: [],
    } satisfies WeaponEntry,
  ]);
  const script: Script = { id: "test", server: { combatRules: () => ({ damageScale: 1 }) }, client: { cast: () => CAST } };
  const match = new Match(
    worldWith(walls),
    {
      game: GAME,
      spawn: { position: { x: 0, y: 1.6, z: 0 }, look: { x: 0, y: 1.6, z: -1 } },
      spawnPoints: [],
      triggers: [],
      mantles: [],
      ladders: [],
      points: [],
      solids: [],
      rooms: [],
      topLevelObjects: [],
    } as unknown as ResolvedWorld,
    TICK_RATE,
    8,
    registry,
    {
      map: "test",
      gametype: defaultGametype,
      catalogue: catalogueViewOf({ version: CATALOG_VERSION }, new WeaponRegistry([])),
      bodies: slabBody(),
      scripts: [script],
    },
  );
  const loadout: Loadout = { name: "Test", game: "iw5", primary: { weapon: "iw5/test_mp", attachments: [] }, secondary: { weapon: null, attachments: [] } };
  const players: PlayerId[] = ["a", "b"];
  for (const id of players) {
    match.join(id, loadout);
  }
  match.place("a", { x: 0, y: 0, z: 0 }, 0, 0);
  match.place("b", { x: 0, y: 0, z: -(BODY_FRONT + BODY_DEPTH / 2) }, Math.PI, 0);
  let seq = 0;
  let latest: PlayerSnapshot[] = [];
  const message = (input: PlayerInput): InputMessage => ({ seq: ++seq, dt: 1 / TICK_RATE, input, claim: { x: 0, y: 0, z: 0 }, drawn: { tick: 0, frac: 0 } });
  for (let i = 0; i < 200; i++) {
    match.receive("a", message({ ...idleInput(0, 0), fire: true }));
    match.receive("b", message(idleInput(Math.PI, 0)));
    latest = match.step().players;
    if (match.shotsThisTick.length > 0) {
      break;
    }
  }
  return { health: latest.find((p) => p.id === "b")!.state.health, shots: [...match.shotsThisTick] };
}

describe("a round and a wall", () => {
  it("reaches a body in the open for the whole of its damage", () => {
    expect(shoot([], "medium").health).toBe(100 - 32);
  });

  it("goes through 10 cm of wood and keeps what the table leaves it", () => {
    // Medium through wood is 16 inches; 0.1 m of it costs 0.1 / 0.4064 of the round.
    const carried = Math.fround(1 - 0.1 / (16 * UNIT));
    const expected = Math.trunc(Math.fround(0.8) * Math.trunc(Math.fround(carried) * 40));
    const { health, shots } = shoot([{ near: 2, far: 2.1, surface: "wood" }], "medium");
    expect(shots[0]!.result).toMatchObject({ kind: "world", material: "wood" });
    expect(health).toBe(100 - expected);
    expect(expected).toBe(24);
  });

  it("stops in a wall thicker than its type goes through", () => {
    // Medium through concrete is 12 inches, 30.5 cm; this is 50.
    expect(shoot([{ near: 2, far: 2.5, surface: "concrete" }], "medium").health).toBe(100);
  });

  it("goes through more as a larger round: small stops in 20 cm of metal that large passes", () => {
    // Small through metal is 12 inches, large 20: 0.2 m is 0.3048 m of the one and 0.508 m of the other.
    const metal: Wall[] = [{ near: 2, far: 2.2, surface: "metal" }];
    expect(shoot(metal, "large").health).toBeLessThan(100);
    expect(shoot([{ near: 2, far: 2.4, surface: "metal" }], "small").health).toBe(100);
  });

  it("goes through nothing a map gave no material, nor anything at all with penetrateType none", () => {
    expect(shoot([{ near: 2, far: 2.01, surface: "default" }], "large").health).toBe(100);
    expect(shoot([{ near: 2, far: 2.01, surface: "glass" }], "none").health).toBe(100);
  });

  it("measures a sheet thinner than an inch as one inch", () => {
    // 1 mm of glass costs a whole inch of the small round's 72: trunc(0.8f × trunc((1 - 1/72) × 40)).
    const expected = Math.trunc(Math.fround(0.8) * Math.trunc(Math.fround(1 - 1 / 72) * 40));
    expect(shoot([{ near: 2, far: 2.001, surface: "glass" }], "small").health).toBe(100 - expected);
  });

  it("goes through a pane and then a wall behind it, each for what it is", () => {
    // 1 mm of glass, then 10 cm of wood: two surfaces, two costs, and the body still reached.
    const glassThenWood: Wall[] = [
      { near: 2, far: 2.001, surface: "glass" },
      { near: 3, far: 3.1, surface: "wood" },
    ];
    const afterGlass = Math.fround(1 - 1 / 72);
    const afterWood = Math.fround(afterGlass - 0.1 / (12 * UNIT));
    const expected = Math.trunc(Math.fround(0.8) * Math.trunc(afterWood * 40));
    expect(shoot(glassThenWood, "small").health).toBe(100 - expected);
  });
});
