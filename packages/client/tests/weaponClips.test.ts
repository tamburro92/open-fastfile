// @vitest-environment happy-dom
// What a weapon's clips do to the gun they are played on.
//
// A clip starts from the pose the weapon is already in — a reload begins at idle
// — so any bone a clip keys has to start where the pose it interrupts left it.
// That is the only check there is on a translation being read the right way
// round, and getting it wrong is not a crash: it is a magazine hanging a hand's
// width out of the magwell for the length of the reload and drifting back
// afterwards.
//
// Measured against the real catalogue, which is the game's own content and not
// in the repository, so this skips without one
// (`python3 -m scripts.cod catalog --dump mw3`).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const WEAPONS = path.resolve(import.meta.dirname, "../../../worlds/catalog/weapons");

/** One from each game: the two were exported by different games' tools and agree about nothing by default. */
const CASES = [
  ["iw5", "iw5_m4_mp"],
  ["iw4", "ak47_mp"],
] as const;

/** The magazine's tag. A clip's keys are absolute on the hands and an offset on every joint of the gun. */
const MAGAZINE = "tag_clip";

/** Inches. A viewmodel's magwell is about four inches from the gun's origin, so this is well inside the error it catches. */
const TOLERANCE = 0.05;

function exists(game: string, name: string): string | undefined {
  const file = path.join(WEAPONS, game, name, `${name}.glb`);
  return fs.existsSync(file) ? file : undefined;
}

async function loadGltf(file: string) {
  const bytes = fs.readFileSync(file);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
}

/** A joint of the gun that MW3's own clips key at 0 or thereabouts, meaning "this far from where it rests". */
const AT_REST = [
  ["iw5", "iw5_acr_mp", "viewmodel_masada_gl_reload_empty", "j_bolt"],
  ["iw5", "iw5_barrett_mp", "viewmodel_barrett_fire", "j_recoil"],
  ["iw5", "iw5_mp412_mp", "viewmodel_mp412_tac_reload", "j_ammo1"],
] as const;

describe.skipIf(!AT_REST.every(([game, name]) => exists(game, name)))("a gun's joints in MW3's clips", () => {
  it.each(AT_REST)("start where they rest (%s/%s %s %s)", async (game, name, clipName, joint) => {
    const gltf = await loadGltf(exists(game, name)!);
    const bone = gltf.scene.getObjectByName(joint)!;
    const track = gltf.animations.find((c) => c.name === clipName)!.tracks.find((t) => t.name === `${joint}.position`)!;
    const first = new THREE.Vector3(track.values[0], track.values[1], track.values[2]);
    expect(first.distanceTo(bone.position)).toBeLessThan(0.2);
    // Away from the gun's origin, or an absolute reading would pass this too.
    expect(bone.position.length()).toBeGreaterThan(0.5);
  });

  it("keep a revolver's rounds in its cylinder, not beside it", async () => {
    for (const name of ["iw5_mp412_mp", "iw5_44magnum_mp"]) {
      const gltf = await loadGltf(exists("iw5", name)!);
      const idle = gltf.animations.find((c) => c.name.endsWith("_idle") && c.tracks.some((t) => t.name === "j_cylinder_ammo.position"))!;
      const track = idle.tracks.find((t) => t.name === "j_cylinder_ammo.position")!;
      // Sideways: the cylinder is on the gun's centre line, and these keys are 3.15 in to cancel a bind of -3.15.
      expect(Math.abs(track.values[1]!), name).toBeLessThan(0.1);
    }
  });
});

describe.skipIf(!CASES.every(([game, name]) => exists(game, name)))("a catalogued weapon's clips", () => {
  it.each(CASES)("start the magazine in the magwell (%s/%s)", async (game, name) => {
    const gltf = await loadGltf(exists(game, name)!);

    const bind = new Map<string, THREE.Vector3>();
    gltf.scene.traverse((item) => {
      if (item instanceof THREE.Bone) {
        bind.set(item.name, item.position.clone());
      }
    });
    const magwell = bind.get(MAGAZINE);
    expect(magwell, `${name} should carry a ${MAGAZINE} joint`).toBeTruthy();
    // The magwell is genuinely away from the gun's origin, or this proves nothing.
    expect(magwell!.length()).toBeGreaterThan(1);

    const keyed = gltf.animations.filter((clip) => clip.tracks.some((track) => track.name === `${MAGAZINE}.position`));
    expect(keyed.length, `${name} should have clips that move the magazine`).toBeGreaterThan(0);

    for (const clip of keyed) {
      const track = clip.tracks.find((t) => t.name === `${MAGAZINE}.position`)!;
      const first = new THREE.Vector3(track.values[0], track.values[1], track.values[2]);
      expect(first.distanceTo(magwell!), `${clip.name} starts the magazine ${first.distanceTo(magwell!).toFixed(2)}in from the magwell`).toBeLessThan(
        TOLERANCE,
      );
    }
  });
});
