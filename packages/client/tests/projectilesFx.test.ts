import { describe, expect, it } from "vitest";
import { ProjectilesView } from "../src/engine/projectilesView.js";
import { ExplosionFx } from "../src/engine/fx/explosions.js";

describe("ProjectilesView & ExplosionFx", () => {
  it("spawns projectile in flight, applies gravity and tumble rotation", () => {
    const view = new ProjectilesView();
    expect(view.root.children.length).toBe(1); // explosions root child

    // Spawn frag grenade at (0, 2, 0) with forward velocity (0, 1, -10)
    view.onThrow(1, "frag", { x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: -10 }, 3.5);

    expect(view.root.children.length).toBe(2);
    const grenadeMesh = view.root.children[1]!;
    expect(grenadeMesh.position.x).toBe(0);
    expect(grenadeMesh.position.y).toBe(2);
    expect(grenadeMesh.position.z).toBe(0);

    // Step 0.1s
    view.update(0.1);

    // Gravity (-15 m/s^2) reduces vy by 1.5, position drops and advances forward
    expect(grenadeMesh.position.z).toBeCloseTo(-1.0, 0.1);
    expect(grenadeMesh.position.y).toBeLessThan(2.1);
  });

  it("handles bounce event and updates velocity", () => {
    const view = new ProjectilesView();
    view.onThrow(2, "frag", { x: 0, y: 1, z: 0 }, { x: 0, y: -5, z: 0 }, 3.5);

    view.onBounce(2, { x: 0, y: 0.1, z: 0 }, { x: 0, y: 2.5, z: 0 });

    const grenadeMesh = view.root.children[1]!;
    expect(grenadeMesh.position.y).toBe(0.1);
  });

  it("handles Semtex sticking and warning beeps", () => {
    const view = new ProjectilesView();
    view.onThrow(3, "semtex", { x: 0, y: 2, z: 0 }, { x: 5, y: 0, z: 0 }, 2.0);

    view.onStick(3, "player_1", { x: 2, y: 1.5, z: 0 });
    const grenadeMesh = view.root.children[1]!;
    expect(grenadeMesh.position.x).toBe(2);
    expect(grenadeMesh.position.y).toBe(1.5);

    // When stepped while stuck, it does not move or fall
    view.update(0.5);
    expect(grenadeMesh.position.x).toBe(2);
    expect(grenadeMesh.position.y).toBe(1.5);

    // Beep flashes LED
    view.onBeep(3, { x: 2, y: 1.5, z: 0 });
  });

  it("detonates projectile and hands over to ExplosionFx", () => {
    const view = new ProjectilesView();
    view.onThrow(4, "frag", { x: 5, y: 1, z: 5 }, { x: 0, y: 0, z: 0 }, 3.5);

    expect(view.root.children.length).toBe(2);

    // Detonate at position
    view.onDetonate("frag", { x: 5, y: 1, z: 5 }, 4);

    // In-flight grenade mesh is removed
    expect(view.root.children.length).toBe(1); // only explosions root remains
    // Explosions root has spawned explosion components (light, fireball, shockwave, scorch, smoke, sparks)
    expect(view.explosions.root.children.length).toBeGreaterThan(5);

    // Advance explosion lifetime until complete (ground scorch mark fades out after 6s)
    for (let t = 0; t < 65; t++) {
      view.update(0.1);
    }
    // All explosion children should be cleaned up after fading out
    expect(view.explosions.root.children.length).toBe(0);
  });

  it("ExplosionFx spawns fireball, shockwave, sparks, and cleans up on clear()", () => {
    const fx = new ExplosionFx();
    fx.spawn({ x: 0, y: 0, z: 0 }, "frag");

    expect(fx.root.children.length).toBeGreaterThan(0);

    fx.clear();
    expect(fx.root.children.length).toBe(0);
  });
});
