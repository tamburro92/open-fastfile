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
import { blendedMaterialFor, collimateReticle, REFLEX_SIGHT, reticleFrameOf, techniqueOf } from "../src/scene/importedMaterials.js";

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
    const source = new THREE.MeshStandardMaterial({ name: "mc/mtl_weapon_red_dot3", map: new THREE.Texture(), transparent: true, vertexColors: true });
    const reticle = blendedMaterialFor(source, REFLEX_SIGHT)! as THREE.MeshBasicMaterial;
    expect(reticle.map).toBe(source.map);
    expect(reticle.blending).toBe(THREE.CustomBlending);
    expect(reticle.blendSrc).toBe(THREE.OneFactor);
    expect(reticle.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(reticle.depthWrite).toBe(false);
    expect(reticle.toneMapped).toBe(false);
    expect(reticle.side).toBe(THREE.DoubleSide);
    expect(reticle.vertexColors).toBe(false);

    const shader = {
      uniforms: {},
      vertexShader: "void main() {\n#include <uv_vertex>\n}",
      fragmentShader: "void main() {\n#include <opaque_fragment>\n}",
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    reticle.onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer);
    // The coverage is the mask itself: black is alpha 0 and adds nothing, so the
    // optic behind it shows through. Alpha 1 everywhere was the opaque square.
    expect(shader.fragmentShader).toContain("float mask = max( max( diffuseColor.r, diffuseColor.g ), diffuseColor.b );");
    expect(shader.fragmentShader).toMatch(/gl_FragColor = vec4\( vec3\( [\d., ]+ \) \* mask, mask \);/);
  });

  it("clamps its image, so a collimated reticle does not come back in from the other side of the glass", () => {
    const map = new THREE.Texture();
    blendedMaterialFor(new THREE.MeshStandardMaterial({ map }), REFLEX_SIGHT);
    expect(map.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(map.wrapT).toBe(THREE.ClampToEdgeWrapping);
  });

  it("reads where its image's centre is off the quad, for the eye's offset to be measured from", () => {
    // MW3's own quad: 1.37 across in the x = 0 plane, its UVs running past the image.
    const half = 0.6848;
    const slope = 0.6377 / half;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, -half, half, 0, half, half, 0, -half, -half], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([1.1377, 1.1377, -0.1377, 1.1377, 1.1377, -0.1377], 2));
    const frame = reticleFrameOf(geometry)!;
    expect(frame.centre.length()).toBeCloseTo(0, 3);
    expect(frame.u.y).toBeCloseTo(-slope, 3);
    expect(frame.v.z).toBeCloseTo(slope, 3);

    const reticle = blendedMaterialFor(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), REFLEX_SIGHT)!;
    collimateReticle(reticle, frame);
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "#include <uv_vertex>", fragmentShader: "" };
    reticle.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.uniforms.reticleCollimated!.value).toBe(1);
    expect(shader.vertexShader).toContain("vMapUv -= vec2( dot( reticleU, fromCentre ), dot( reticleV, fromCentre ) )");
  });

  it("is not collimated without a frame: the hybrid sight's reticles are surfaces on an atlas", () => {
    const reticle = blendedMaterialFor(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), REFLEX_SIGHT)!;
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "#include <uv_vertex>", fragmentShader: "" };
    reticle.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.uniforms.reticleCollimated!.value).toBe(0);
  });
});
