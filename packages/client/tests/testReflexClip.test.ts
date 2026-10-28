// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildViewmodelRig } from "../src/scene/viewmodel.js";
import { Viewmodel, type ViewFrame } from "../src/engine/viewmodel.js";
import { WeaponController } from "@3d/shared/sim/weapon.js";
import { createMovement } from "@3d/shared/sim/movementState.js";

const CATALOG = path.resolve(import.meta.dirname, "../../../worlds/catalog");

async function load(file: string) {
  const bytes = fs.readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return { scene: gltf.scene, clips: gltf.animations };
}

describe("Authentic Reflex Clip test", () => {
  it("automatically loads authentic reflex ads clip when reflex is fitted", async () => {
    const m4Path = path.join(CATALOG, "weapons/iw5/iw5_m4_mp/iw5_m4_mp.glb");
    const reflexPath = path.join(CATALOG, "attachments/iw5/viewmodel_reflex_iw5/viewmodel_reflex_iw5.glb");
    const [m4Asset, reflexAsset] = await Promise.all([load(m4Path), load(reflexPath)]);

    const handsScene = new THREE.Group();
    const origin = new THREE.Bone();
    origin.name = "tag_origin";
    const view = new THREE.Bone();
    view.name = "tag_view";
    origin.add(view);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geom.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
    geom.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    geom.setIndex([0, 1, 2]);
    const mesh = new THREE.SkinnedMesh(geom, new THREE.MeshBasicMaterial());
    mesh.bind(new THREE.Skeleton([view]));
    handsScene.add(origin, mesh);
    const handsAsset = { scene: handsScene, clips: [] };

    // Build rig with reflex
    const rig = buildViewmodelRig(m4Asset, handsAsset, {
      attachments: [{ entry: { id: "reflex", tag: "tag_red_dot" }, asset: reflexAsset }],
    });

    // Check that adsUp role is viewmodel_m4_reflex_ads_up
    expect(rig.def.roles.adsUp).toBe("viewmodel_m4_reflex_ads_up");
    expect(rig.clips.has("viewmodel_m4_reflex_ads_up")).toBe(true);

    const vm = new Viewmodel();
    const ctrl = new WeaponController(rig.def);
    ctrl.ready();
    (ctrl.data as { ads: number }).ads = 1.0;
    vm.attach(rig, [], ctrl);

    const cam = new THREE.PerspectiveCamera(65, 16 / 9, 0.01, 100);
    cam.position.set(0, 1.5, 0);
    cam.lookAt(0, 1.5, -1);

    const frame: ViewFrame = {
      camera: cam,
      turn: { yaw: 0, pitch: 0 },
      movement: createMovement({ x: 0, y: 0, z: 0 }, 0, 0),
    };

    vm.update(0.016, frame);
    vm.scene.updateMatrixWorld(true);
    vm.camera.updateMatrixWorld(true);

    const reticle = rig.root.getObjectByName("optic_reticle_mesh")!;
    const retWorld = reticle.getWorldPosition(new THREE.Vector3());
    const retCam = retWorld.clone().applyMatrix4(vm.camera.matrixWorldInverse);
    const retNdc = retWorld.clone().project(vm.camera);

    console.log(`Reticle with authentic MW3 reflex clip: Cam Y=${retCam.y.toFixed(4)}, Z=${retCam.z.toFixed(4)} -> NDC Y=${retNdc.y.toFixed(4)}, X=${retNdc.x.toFixed(4)}`);
    expect(Math.abs(retNdc.x)).toBeLessThan(0.01);
    expect(Math.abs(retNdc.y)).toBeLessThan(0.05);

    // Test EOTech and ACOG
    const eotechPath = path.join(CATALOG, "attachments/iw5/viewmodel_eotech/viewmodel_eotech.glb");
    const acogPath = path.join(CATALOG, "attachments/iw5/viewmodel_acog/viewmodel_acog.glb");
    const [eotechAsset, acogAsset] = await Promise.all([load(eotechPath), load(acogPath)]);

    for (const [name, attach] of [
      ["EOTech", { entry: { id: "eotech", tag: "tag_eotech" }, asset: eotechAsset }],
      ["ACOG", { entry: { id: "acog", tag: "tag_acog_2" }, asset: acogAsset }],
    ] as const) {
      const opticRig = buildViewmodelRig(m4Asset, handsAsset, {
        attachments: [attach],
      });
      const opticVm = new Viewmodel();
      const opticCtrl = new WeaponController(opticRig.def);
      opticCtrl.ready();
      (opticCtrl.data as { ads: number }).ads = 1.0;
      opticVm.attach(opticRig, [], opticCtrl);
      opticVm.update(0.016, frame);
      opticVm.scene.updateMatrixWorld(true);
      opticVm.camera.updateMatrixWorld(true);

      const rMesh = opticRig.root.getObjectByName("optic_reticle_mesh")!;
      const rWorld = rMesh.getWorldPosition(new THREE.Vector3());
      const rCam = rWorld.clone().applyMatrix4(opticVm.camera.matrixWorldInverse);
      const rNdc = rWorld.clone().project(opticVm.camera);

      console.log(`Reticle with authentic MW3 ${name} clip: Cam Y=${rCam.y.toFixed(4)}, Z=${rCam.z.toFixed(4)} -> NDC Y=${rNdc.y.toFixed(4)}, X=${rNdc.x.toFixed(4)}`);
      expect(Math.abs(rNdc.x)).toBeLessThan(0.01);
      expect(Math.abs(rNdc.y)).toBeLessThan(0.05);
    }
  });
});
