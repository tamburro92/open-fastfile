// @vitest-environment happy-dom
// An optic's reticle, drawn as MW3's `mc_reflexsight` draws it.
//
// The failure this guards is the one that shipped: a reticle whose colour map is
// a white mask on black with no alpha (DXT1), blended ONE/INVSRCALPHA at alpha 1,
// is an opaque black square in front of the optic. Nothing throws, and the sight
// still has a dot in it somewhere — the player just cannot see through it.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { blendedMaterialFor, REFLEX_SIGHT, techniqueOf } from "../src/scene/importedMaterials.js";

const ATTACHMENTS = path.resolve(import.meta.dirname, "../../../worlds/catalog/attachments/iw5");

async function materialsOf(model: string): Promise<THREE.Material[] | null> {
  const file = path.join(ATTACHMENTS, model, `${model}.glb`);
  if (!fs.existsSync(file)) {
    return null; // no catalogue built in this checkout
  }
  const bytes = fs.readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  const found = new Set<THREE.Material>();
  gltf.scene.traverse((item) => {
    if (item instanceof THREE.Mesh) {
      for (const material of Array.isArray(item.material) ? item.material : [item.material]) {
        found.add(material);
      }
    }
  });
  return [...found];
}

describe("an optic's reticle", () => {
  it("arrives marked with the technique its material is drawn by, the hybrid sight's own reticles included", async () => {
    for (const [model, reticles] of [
      ["viewmodel_reticle_eotech", ["mc/mtl_weapon_red_dot3"]],
      ["viewmodel_reticle_reflex", ["mc/mtl_weapon_reflex_red_dot"]],
      ["viewmodel_reticle_acog", ["mc/mtl_weapon_m68_reticle"]],
      ["viewmodel_hamr_hybrid", ["mc/mtl_weapon_hamr_reticle", "mc/mtl_weapon_red_cross_small2"]],
    ] as const) {
      const materials = await materialsOf(model);
      if (!materials) {
        return;
      }
      const marked = materials.filter((m) => techniqueOf(m) === REFLEX_SIGHT).map((m) => m.name);
      expect(marked.sort(), model).toEqual([...reticles].sort());
    }
  });

  it("keys out the black of its mask and lights the mark, over the material's own ONE/INVSRCALPHA", () => {
    const source = new THREE.MeshStandardMaterial({ name: "mc/mtl_weapon_red_dot3", map: new THREE.Texture(), transparent: true });
    const reticle = blendedMaterialFor(source, REFLEX_SIGHT)! as THREE.MeshBasicMaterial;
    expect(reticle.map).toBe(source.map);
    expect(reticle.blending).toBe(THREE.CustomBlending);
    expect(reticle.blendSrc).toBe(THREE.OneFactor);
    expect(reticle.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(reticle.depthWrite).toBe(false);
    expect(reticle.toneMapped).toBe(false);

    const shader = { fragmentShader: "void main() {\n#include <opaque_fragment>\n}" } as THREE.WebGLProgramParametersWithUniforms;
    reticle.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    // The coverage is the mask itself: black is alpha 0 and adds nothing, so the
    // optic behind it shows through. Alpha 1 everywhere was the opaque square.
    expect(shader.fragmentShader).toContain("float mask = max( max( diffuseColor.r, diffuseColor.g ), diffuseColor.b );");
    expect(shader.fragmentShader).toMatch(/gl_FragColor = vec4\( vec3\( [\d., ]+ \) \* mask, mask \);/);
  });
});
