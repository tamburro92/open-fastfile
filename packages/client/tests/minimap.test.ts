// The HUD map: the `minimap` node, and placing the player on its image.

import { describe, expect, it } from "vitest";
import { minimapAlly, minimapInfo, minimapPoint, minimapPose } from "../src/app/minimap.js";
import { parseWorldFile } from "@3d/shared/dsl/parser.js";
import { resolveWorld } from "@3d/shared/dsl/resolve.js";
import type { ResolvedMinimap } from "@3d/shared/dsl/resolved.js";

function resolve(source: string) {
  const { ast } = parseWorldFile(source);
  return resolveWorld(ast.statements);
}

function errors(source: string): string[] {
  return resolve(source)
    .diagnostics.filter((d) => d.severity === "error")
    .map((d) => d.code ?? d.message);
}

// worlds/dome-mw3/minimap.world: image up is +X, image right +Z.
const DOME: ResolvedMinimap = {
  source: "assets/minimap.png",
  center: { x: 5.08, z: -24.587 },
  width: 103.632,
  depth: 103.632,
  rotation: -Math.PI / 2,
  range: 40,
};

describe("the minimap node", () => {
  it("resolves to metres and radians, with a default range", () => {
    const { world, diagnostics } = resolve(`minimap { source: "assets/minimap.png", at: 5 -24, size: 100cm 2, rotate: -90 }`);
    expect(diagnostics).toEqual([]);
    const map = world!.minimap!;
    expect(map).toMatchObject({ source: "assets/minimap.png", center: { x: 5, z: -24 }, width: 1, depth: 2, range: 40 });
    expect(map.rotation).toBeCloseTo(-Math.PI / 2);
    expect(resolve(`minimap { source: "m.png", at: 0 0, size: 1 1, range: 25 }`).world!.minimap!.range).toBe(25);
  });

  it("needs a source, a centre and a size; a world without one has none", () => {
    expect(errors(`minimap { at: 0 0 }`)).toEqual(["missing-property", "missing-property"]);
    expect(resolve(`world { name: "x" }`).world!.minimap).toBeUndefined();
  });

  it("rejects a size or range that is not positive, and more than one angle", () => {
    expect(errors(`minimap { source: "m.png", at: 0 0, size: 0 10 }`)).toEqual(["minimap-bad-size"]);
    expect(errors(`minimap { source: "m.png", at: 0 0, size: 10 10, range: -5 }`)).toEqual(["minimap-bad-range"]);
    expect(errors(`minimap { source: "m.png", at: 0 0, size: 10 10, rotate: 0 90 0 }`)).toEqual(["bad-arity"]);
  });

  it("warns about a second one", () => {
    const { diagnostics } = resolve(`minimap { source: "a.png", at: 0 0, size: 1 1 }\nminimap { source: "b.png", at: 0 0, size: 1 1 }`);
    expect(diagnostics.map((d) => d.code)).toContain("duplicate-minimap");
  });
});

describe("placing the player on the minimap", () => {
  it("puts the image's corners at its corners", () => {
    // export_metadata.json's image_corners for mp_dome, in engine x z.
    const at = (x: number, z: number) => minimapPose(DOME, x, z, 0);
    expect(at(56.896, -76.403)).toMatchObject({ u: expect.closeTo(0, 4), v: expect.closeTo(0, 4) });
    expect(at(56.896, 27.229)).toMatchObject({ u: expect.closeTo(1, 4), v: expect.closeTo(0, 4) });
    expect(at(-46.736, -76.403)).toMatchObject({ u: expect.closeTo(0, 4), v: expect.closeTo(1, 4) });
  });

  // A heading drawn sideways or mirrored still looks like a working minimap, so
  // this walks one metre forward and checks the image turned under the arrow
  // moves that step straight up the screen, for any heading and any map rotation.
  it.each([
    [0, 0],
    [0, 1],
    [-Math.PI / 2, 0],
    [-Math.PI / 2, 2.5],
    [(54 * Math.PI) / 180, -4],
  ])("turns the player's heading to the top (map rotation %f, yaw %f)", (rotation, yaw) => {
    const map = { ...DOME, rotation };
    const from = minimapPose(map, 3, -7, yaw);
    const to = minimapPose(map, 3 - Math.sin(yaw), -7 - Math.cos(yaw), yaw); // firstPerson's forward
    // Image metres, x right and y down, as the screen draws it; CSS rotate(a) turns clockwise there.
    const dx = (to.u - from.u) * map.width;
    const dy = (to.v - from.v) * map.depth;
    const c = Math.cos(from.rotation);
    const s = Math.sin(from.rotation);
    expect(dx * c - dy * s).toBeCloseTo(0);
    expect(dx * s + dy * c).toBeCloseTo(-1);
  });

  it("sizes the image against a map twice the range across", () => {
    expect(minimapInfo(DOME, "/worlds/dome-mw3/")).toEqual({ image: "/worlds/dome-mw3/assets/minimap.png", width: 103.632 / 80, height: 103.632 / 80 });
  });

  it("converts world coordinates to minimap (u, v) points", () => {
    const pt = minimapPoint(DOME, 56.896, -76.403);
    expect(pt.u).toBeCloseTo(0, 4);
    expect(pt.v).toBeCloseTo(0, 4);

    const center = minimapPoint(DOME, DOME.center.x, DOME.center.z);
    expect(center.u).toBeCloseTo(0.5, 4);
    expect(center.v).toBeCloseTo(0.5, 4);
  });
});

describe("a teammate on the minimap", () => {
  it("stands where a ping at their feet would", () => {
    const ally = minimapAlly(DOME, "#b2", 12, -30, 0.4);
    expect({ u: ally.u, v: ally.v }).toEqual(minimapPoint(DOME, 12, -30));
  });

  it("points up on screen when facing the way the player faces, whatever the way", () => {
    for (const yaw of [0, 1, -2.5]) {
      const player = minimapPose(DOME, 0, 0, yaw);
      const ally = minimapAlly(DOME, "#b2", 20, -10, yaw);
      // The arrow sits on the image, which the player's pose turns: the two add.
      expect(player.rotation + ally.rotation).toBeCloseTo(0);
    }
  });

  it("turns with its own heading: a quarter turn of yaw is a quarter turn of the arrow", () => {
    const a = minimapAlly(DOME, "#b2", 0, 0, 0);
    const b = minimapAlly(DOME, "#b2", 0, 0, Math.PI / 2);
    expect(Math.abs(a.rotation - b.rotation)).toBeCloseTo(Math.PI / 2);
  });
});
