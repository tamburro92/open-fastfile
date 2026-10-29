import { describe, expect, it } from "vitest";
import type { ProjectileState } from "@3d/shared/sim/projectile.js";
import { ProjectilesView } from "../src/engine/projectilesView.js";
import { ExplosionFx } from "../src/engine/fx/explosions.js";

const frag = (id: number, x: number, y: number, z: number): ProjectileState => ({ id, kind: "frag", position: { x, y, z } });

describe("ProjectilesView", () => {
  it("draws what the snapshot says is in the air, between its last two positions", () => {
    const view = new ProjectilesView();
    view.setTickRate(60);
    view.apply([frag(1, 0, 2, 0)], 0);
    view.apply([frag(1, 0, 2, -2)], 1000 / 60);
    expect(view.size).toBe(1);

    // One tick behind the newer sample, halfway between the two.
    view.update(0.016, 1000 / 60 + 1000 / 120, undefined);
    const drawn = view.root.children[1]!;
    expect(drawn.position.z).toBeCloseTo(-1, 5);
    // Its own matrices: the scene's auto-update is off, so nobody else writes them.
    expect(drawn.matrixWorld.elements[14]).toBeCloseTo(-1, 5);
  });

  it("drops one the snapshot no longer carries", () => {
    const view = new ProjectilesView();
    view.apply([frag(1, 0, 1, 0), frag(2, 3, 1, 0)], 0);
    view.apply([frag(2, 3, 1, 0)], 16);
    expect(view.size).toBe(1);
  });

  it("goes off where the server says, and takes the grenade with it", () => {
    const view = new ProjectilesView();
    view.apply([frag(4, 5, 1, 5)], 0);
    view.detonate({ kind: "detonate", id: 1, what: "frag", at: { x: 5, y: 1, z: 5 }, by: null });
    expect(view.size).toBe(0);
    expect(view.explosions.root.children.length).toBeGreaterThan(5);
    // A missile is never drawn in flight and still explodes.
    view.detonate({ kind: "detonate", id: 2, what: "missile", at: { x: 0, y: 0, z: 0 }, by: null });
    for (let t = 0; t < 65; t++) {
      view.update(0.1, t * 100, undefined);
    }
    expect(view.explosions.root.children.length).toBe(0);
  });

  it("points at the nearest frag or semtex in range, and never at a flashbang", () => {
    const view = new ProjectilesView();
    view.apply([frag(1, 6, 0, 0), frag(2, 0, 0, 3), { id: 3, kind: "flashbang", position: { x: 1, y: 0, z: 0 } }], 0);
    expect(view.nearestThreat({ x: 0, y: 0, z: 0 }, 8)).toEqual({ x: 0, y: 0, z: 3 });
    expect(view.nearestThreat({ x: 0, y: 0, z: 0 }, 2)).toBeNull();
  });
});

describe("ExplosionFx", () => {
  it("adds no light: one would recompile every lit material in the map, twice", () => {
    const fx = new ExplosionFx();
    fx.spawn({ x: 0, y: 0, z: 0 }, "frag");
    fx.spawn({ x: 0, y: 0, z: 0 }, "flashbang");
    let lights = 0;
    fx.root.traverse((node) => (lights += (node as { isLight?: boolean }).isLight ? 1 : 0));
    expect(lights).toBe(0);
  });

  it("spawns its parts and frees them on clear()", () => {
    const fx = new ExplosionFx();
    fx.spawn({ x: 0, y: 0, z: 0 }, "frag");
    expect(fx.root.children.length).toBeGreaterThan(0);
    fx.clear();
    expect(fx.root.children.length).toBe(0);
  });
});
