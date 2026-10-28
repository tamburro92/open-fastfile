import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { THROW_TIMES } from "@3d/shared/game/equipment.js";
import { Offhand } from "../src/engine/offhand.js";
import type { ViewmodelRig } from "../src/scene/viewmodel.js";

/** A rig with the two roles a throw plays, each a clip that moves one bone so the mixer has something to drive. */
function grenadeRig(): ViewmodelRig {
  const root = new THREE.Group();
  const eye = new THREE.Object3D();
  root.add(eye);
  const clip = (name: string) => new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack(".position[x]", [0, 1], [0, 1])]);
  return {
    root,
    eye,
    clips: new Map([
      ["viewmodel_m67_pullpin", clip("viewmodel_m67_pullpin")],
      ["viewmodel_m67_throw", clip("viewmodel_m67_throw")],
    ]),
    def: { roles: { holdFire: "viewmodel_m67_pullpin", fire: "viewmodel_m67_throw" } },
  } as unknown as ViewmodelRig;
}

describe("a grenade in the hand", () => {
  it("is drawn for the pin and the throw, by the weapon file's two times, and then the gun comes back", () => {
    const offhand = new Offhand();
    offhand.set(new Map([["frag", grenadeRig()]]));
    const holder = offhand.root.children[0]!;
    expect(holder.visible).toBe(false);

    expect(offhand.start("frag")).toBe(true);
    expect(holder.visible).toBe(true);
    // A second press mid-throw is refused, as the server refuses it.
    expect(offhand.start("frag")).toBe(false);

    const { holdFire, fire } = THROW_TIMES.frag;
    expect(offhand.update(holdFire + fire - 0.01)).toBe(false);
    expect(offhand.update(0.02)).toBe(true);
    expect(holder.visible).toBe(false);
    expect(offhand.busy).toBe(false);
  });

  it("refuses a kind it has no rig for, so the gun is never put away for nothing", () => {
    const offhand = new Offhand();
    offhand.set(new Map([["frag", grenadeRig()]]));
    expect(offhand.start("flashbang")).toBe(false);
  });
});
