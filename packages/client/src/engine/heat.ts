// Bodies white-hot through a thermal optic.
//
// Every lit material a body is drawn with is made fully emissive white, and the
// output pass's thermal grade (render/output.ts) keeps what saturates white and
// greys everything else. Through `emissive` because it is a uniform: no program
// is recompiled either way, which a light or a material swap would cost the
// whole map (fx/explosions.ts says why that matters).
//
// A body's materials are shared with every clone of it, so turning heat on for
// one root turns it on for that body wherever it is drawn — which is what a
// thermal optic shows anyway.

import * as THREE from "three";

const WHITE = new THREE.Color(1, 1, 1);
/** What each material glowed before, so turning the optic off puts it back exactly. */
const before = new WeakMap<THREE.Material, { colour: THREE.Color; intensity: number }>();

/** Turn every emissive material under `root` white-hot, or back to what it was. */
export function setHeat(root: THREE.Object3D, hot: boolean): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const lit = material as THREE.MeshStandardMaterial;
      if (!lit.emissive) {
        continue;
      }
      if (hot) {
        if (!before.has(lit)) {
          before.set(lit, { colour: lit.emissive.clone(), intensity: lit.emissiveIntensity });
        }
        lit.emissive.copy(WHITE);
        lit.emissiveIntensity = 1;
      } else {
        const was = before.get(lit);
        if (was) {
          lit.emissive.copy(was.colour);
          lit.emissiveIntensity = was.intensity;
          before.delete(lit);
        }
      }
    }
  });
}
