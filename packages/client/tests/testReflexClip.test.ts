// @vitest-environment happy-dom
// An optic's reticle is where the eye is when the player aims through it.
//
// This is the result that is *plausibly* wrong in every way it can be: a reticle
// a few millimetres off its sight line still draws, just beside the target, and
// nothing throws. So it is measured, over the real catalogue, for every MW3 gun
// and every optic it takes that has a reticle of its own: the gun built as the
// game builds it — the optic's model on its tag, its reticle model on the
// optic's `tag_reticle_attach`, and the aiming clips the weapon file's
// `animOverrides` gives that optic on that gun — posed at full aim, and the
// reticle's centre projected through the viewmodel camera. It must land on the
// middle of the screen.
//
// Skips without a catalogue built (`python3 -m scripts.cod catalog --dump mw3`).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createMovement } from "@3d/shared/sim/movementState.js";
import { WeaponController } from "@3d/shared/sim/weapon.js";
import { resolveWeapon, type WeaponEntry } from "@3d/shared/sim/weaponRegistry.js";
import { Viewmodel, type ViewFrame } from "../src/engine/viewmodel.js";
import type { GltfAsset } from "../src/scene/assets.js";
import { buildViewmodelRig } from "../src/scene/viewmodel.js";

const CATALOG = path.resolve(import.meta.dirname, "../../../worlds/catalog");
const WEAPONS = path.join(CATALOG, "weapons/iw5");
const HANDS = path.join(CATALOG, "viewhands/iw5");

async function load(file: string): Promise<GltfAsset> {
  const bytes = fs.readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return { scene: gltf.scene, clips: gltf.animations } as GltfAsset;
}

const attachmentGlb = (model: string) => path.join(CATALOG, "attachments/iw5", model, `${model}.glb`);

/** Every MW3 gun that takes an optic with a reticle of its own, and which optics. */
function cases(): { entry: WeaponEntry; slots: number[] }[] {
  if (!fs.existsSync(WEAPONS)) {
    return [];
  }
  const out: { entry: WeaponEntry; slots: number[] }[] = [];
  for (const id of fs.readdirSync(WEAPONS)) {
    const file = path.join(WEAPONS, id, `${id}.json`);
    if (!fs.existsSync(file)) {
      continue;
    }
    const entry = JSON.parse(fs.readFileSync(file, "utf8")) as WeaponEntry;
    const slots = entry.attachments.flatMap((a, slot) => (a.reticle && a.model && fs.existsSync(attachmentGlb(a.reticle)) ? [slot] : []));
    if (slots.length > 0) {
      out.push({ entry, slots });
    }
  }
  return out;
}

/**
 * Off by the game's own data, and kept that way: MW3's `iw5_mk12spr_mp` — a gun
 * left in the files and never in the multiplayer menu — gives its ACOG the
 * Dragunov's aiming clips (`viewmodel_dragunov_acog_ADS_up`), which put that
 * optic's sight line somewhere else on this gun.
 */
const AS_SHIPPED = new Set(["iw5_mk12spr_mp + acog"]);

const all = cases();
const handsDir = fs.existsSync(HANDS) ? fs.readdirSync(HANDS)[0] : undefined;

describe("an optic's reticle at full aim", () => {
  it.skipIf(all.length === 0 || !handsDir)(
    `is on the middle of the screen, for every MW3 gun and optic (${all.length} guns)`,
    async () => {
      const hands = await load(path.join(HANDS, handsDir!, `${handsDir}.glb`));
      const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.01, 100);
      camera.position.set(0, 1.5, 0);
      camera.lookAt(0, 1.5, -1);
      camera.updateMatrixWorld(true);
      const frame: ViewFrame = { camera, turn: { yaw: 0, pitch: 0 }, movement: createMovement({ x: 0, y: 0, z: 0 }, 0, 0) };
      const off: string[] = [];
      let measured = 0;

      for (const { entry, slots } of all) {
        const gun = await load(path.join(WEAPONS, entry.id, `${entry.id}.glb`));
        for (const slot of slots) {
          const optic = entry.attachments[slot]!;
          const [model, reticle] = await Promise.all([load(attachmentGlb(optic.model!)), load(attachmentGlb(optic.reticle!))]);
          const def = resolveWeapon(entry, [slot]);
          const rig = buildViewmodelRig(gun, hands, { def, attachments: [{ entry: optic, asset: model, reticle }] });
          const mounted = rig.root.getObjectByName("reticle");
          if (!mounted) {
            off.push(`${entry.id} + ${optic.id}: no reticle mounted`);
            continue;
          }

          const viewmodel = new Viewmodel();
          const weapon = new WeaponController(def);
          weapon.ready();
          (weapon.data as { ads: number }).ads = 1;
          viewmodel.attach(rig, [], weapon);
          viewmodel.update(0.016, frame);
          viewmodel.scene.updateMatrixWorld(true);
          viewmodel.camera.updateMatrixWorld(true);

          const centre = mounted.getWorldPosition(new THREE.Vector3()).project(viewmodel.camera);
          measured++;
          // A twentieth of the half-screen: a dot on a 1080-line screen inside 27 pixels of the middle.
          if ((Math.abs(centre.x) > 0.05 || Math.abs(centre.y) > 0.05) && !AS_SHIPPED.has(`${entry.id} + ${optic.id}`)) {
            off.push(`${entry.id} + ${optic.id}: ${centre.x.toFixed(3)}, ${centre.y.toFixed(3)}`);
          }
          viewmodel.clear();
        }
      }

      expect(measured).toBeGreaterThan(0);
      expect(off).toEqual([]);
    },
    120_000,
  );
});
