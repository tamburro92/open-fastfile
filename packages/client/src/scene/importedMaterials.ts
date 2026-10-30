// How an imported map's materials are drawn: the render state the exporter
// carried out of the game (glTF `extras`, copied by GLTFLoader onto
// material.userData) turned into three.js settings. The reasoning behind each
// rule is in docs/engine/rendering.md#imported-materials.

import * as THREE from "three";
import { addPatch } from "../engine/render/patches.js";

type Materials = THREE.Material | THREE.Material[];

const each = (material: Materials): THREE.Material[] => (Array.isArray(material) ? material : [material]);

function firstUserData(material: Materials): Record<string, unknown> | undefined {
  return each(material)[0]?.userData;
}

/** Blended (glTF BLEND). three's shadow pass ignores blending, so a blended quad would shadow its whole rectangle. */
export function isBlended(material: Materials): boolean {
  return Array.isArray(material) ? material.every(isBlended) : material.transparent;
}

/** The game's own shadow flag where the exporter carried one; otherwise "not blended". */
export function castsShadow(material: Materials): boolean {
  const flag = firstUserData(material)?.castsShadow;
  return typeof flag === "boolean" ? flag : !isBlended(material);
}

/**
 * Render front faces into the shadow map whatever the material's culling.
 * three inverts `side` for the depth pass, which suits closed solids but drops
 * single-quad panels and thin brush slabs out of the shadow map entirely.
 */
export function setShadowSide(material: Materials): void {
  for (const mat of each(material)) {
    if (mat.side !== THREE.DoubleSide) {
      mat.shadowSide = THREE.FrontSide;
    }
  }
}

/** The sortKey below which a surface is ordinary opaque world geometry (1 on every imported map). */
export const OPAQUE_SORT_KEY = 6;

/**
 * Reproduce the game's draw order: `renderOrder` puts the overlay tiers in
 * sequence and a polygon offset in depth-buffer units separates each from the
 * coplanar surface under it. The slope factor must stay 0: any slope term
 * drags large ground planes through walls when viewed edge-on.
 */
export function applySortKey(mesh: THREE.Mesh, key: number): void {
  if (key < OPAQUE_SORT_KEY) {
    return;
  }

  mesh.renderOrder = key;

  for (const mat of each(mesh.material)) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 0;
    mat.polygonOffsetUnits = -(key - OPAQUE_SORT_KEY + 1);

    if (mat.transparent) {
      mat.depthWrite = false; // an overlay must not occlude the tiers above it
    }
  }
}

/** The technique an optic's reticle is drawn with: glTF `extras.technique`, and `blendedMaterialFor`'s mode for it. */
export const REFLEX_SIGHT = "reflexsight";

/**
 * A reticle's colour, linear. MW3's default masks are white while its custom
 * reticles' textures are pure red under the same technique, so the shader keeps
 * the red channel: this gives both the red the customs are authored in.
 */
const RETICLE_COLOUR = [1.0, 0.0, 0.0] as const;

/**
 * A reticle quad's image in its own space (`reticleFrameOf`): where the image's
 * centre is, and how its U and V change per unit of distance.
 */
export interface ReticleFrame {
  centre: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
}

/** The frame of a flat, linearly mapped quad, read off its first triangle; null where that has no area. */
export function reticleFrameOf(geometry: THREE.BufferGeometry): ReticleFrame | null {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!position || !uv) {
    return null;
  }
  const [a, b, c] = geometry.index ? [geometry.index.getX(0), geometry.index.getX(1), geometry.index.getX(2)] : [0, 1, 2];
  const origin = new THREE.Vector3().fromBufferAttribute(position, a);
  const e1 = new THREE.Vector3().fromBufferAttribute(position, b).sub(origin);
  const e2 = new THREE.Vector3().fromBufferAttribute(position, c).sub(origin);
  const [du1, dv1] = [uv.getX(b) - uv.getX(a), uv.getY(b) - uv.getY(a)];
  const [du2, dv2] = [uv.getX(c) - uv.getX(a), uv.getY(c) - uv.getY(a)];
  const [g11, g12, g22] = [e1.dot(e1), e1.dot(e2), e2.dot(e2)];
  const inPlane = g11 * g22 - g12 * g12;
  const inImage = du1 * dv2 - du2 * dv1;
  if (Math.abs(inPlane) < 1e-12 || Math.abs(inImage) < 1e-12) {
    return null;
  }
  // The gradient of a linear map over the plane, from its change along two edges.
  const gradient = (d1: number, d2: number) =>
    e1
      .clone()
      .multiplyScalar((d1 * g22 - d2 * g12) / inPlane)
      .addScaledVector(e2, (d2 * g11 - d1 * g12) / inPlane);
  const [toU, toV] = [0.5 - uv.getX(a), 0.5 - uv.getY(a)];
  const centre = origin
    .clone()
    .addScaledVector(e1, (toU * dv2 - toV * du2) / inImage)
    .addScaledVector(e2, (toV * du1 - toU * dv1) / inImage);
  return { centre, u: gradient(du1, du2), v: gradient(dv1, dv2) };
}

/**
 * Collimate a reticle: its image stays on the sight's axis as the eye moves off
 * it, as a real sight's does, instead of sliding with the glass. Only for a
 * lone quad: the hybrid sight's reticles are surfaces on an atlas, with no frame.
 */
export function collimateReticle(material: THREE.Material, frame: ReticleFrame): void {
  material.userData.reticleFrame = frame;
}

/** The technique a material asks to be drawn with (`extras.technique`), if any. */
export function techniqueOf(material: THREE.Material): string | undefined {
  const technique = (material.userData as { technique?: unknown }).technique;
  return typeof technique === "string" ? technique : undefined;
}

/**
 * A replacement material that draws the game's blend equation, or null to keep
 * the original. glTF can only say "alpha blend"; most decals multiply or add.
 * The replacement is unlit, not tone mapped and not fogged, because it
 * modulates a wall that already went through all three, and it fades toward
 * its equation's identity by vertex alpha, which none of these equations read.
 */
export function blendedMaterialFor(source: THREE.Material, mode: string): THREE.Material | null {
  const src = source as THREE.MeshStandardMaterial;
  const mat = new THREE.MeshBasicMaterial({
    map: src.map,
    color: src.color,
    vertexColors: src.vertexColors,
    transparent: true,
    depthWrite: false,
    side: src.side,
    alphaTest: src.alphaTest,
    toneMapped: false,
    fog: false,
  });

  mat.name = src.name;
  mat.userData = { ...src.userData }; // a copy: the picker writes tags per material

  if (mode === REFLEX_SIGHT) {
    // `mc_reflexsight`, an optic's reticle. Its colour map is a white mask on
    // black with no alpha at all (DXT1), so the mask is the coverage and the
    // shader supplies the colour: black keys out, the mark is the reticle's red.
    // Then ONE/INVSRCALPHA, the material's own blend, over a premultiplied result.
    mat.color = new THREE.Color(1, 1, 1);
    // Whichever way a surface winds: the magnified EOTech's faces away from the eye.
    mat.side = THREE.DoubleSide;
    // The technique reads none: the magnified EOTech's reticle has black vertices.
    mat.vertexColors = false;
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    // Its UVs run past the image onto a black edge. Repeated, a collimated
    // reticle would come back in from the other side of the glass.
    if (mat.map) {
      mat.map.wrapS = mat.map.wrapT = THREE.ClampToEdgeWrapping;
      mat.map.needsUpdate = true;
    }
    addPatch(mat, {
      name: "reflex-sight",
      key: "reflex-sight",
      apply: (shader) => {
        const frame = mat.userData.reticleFrame as ReticleFrame | undefined;
        shader.uniforms.reticleCollimated = { value: frame ? 1 : 0 };
        shader.uniforms.reticleCentre = { value: frame?.centre ?? new THREE.Vector3() };
        shader.uniforms.reticleU = { value: frame?.u ?? new THREE.Vector3() };
        shader.uniforms.reticleV = { value: frame?.v ?? new THREE.Vector3() };
        shader.vertexShader = `uniform float reticleCollimated;
uniform vec3 reticleCentre;
uniform vec3 reticleU;
uniform vec3 reticleV;
${shader.vertexShader}`.replace(
          "#include <uv_vertex>",
          `#include <uv_vertex>
       #ifdef USE_MAP
       if ( reticleCollimated > 0.5 ) {
         // The image at a point is the one on the line through it parallel to the
         // axis, so only the eye's offset across the quad moves it.
         vec3 fromCentre = ( inverse( modelViewMatrix ) * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz - reticleCentre;
         vec3 axis = normalize( cross( reticleU, reticleV ) );
         fromCentre -= axis * dot( fromCentre, axis );
         vMapUv -= vec2( dot( reticleU, fromCentre ), dot( reticleV, fromCentre ) );
       }
       #endif`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          `#include <opaque_fragment>
       float mask = max( max( diffuseColor.r, diffuseColor.g ), diffuseColor.b );
       gl_FragColor = vec4( vec3( ${RETICLE_COLOUR.map((c) => c.toFixed(3)).join(", ")} ) * mask, mask );`,
        );
      },
    });
    keepAlpha(mat);
    return mat;
  }

  // A new material, so it carries none of the source's patches (layers, wind).
  const toward = mode === "multiply" ? "vec3( 1.0 )" : "vec3( 0.0 )";
  addPatch(mat, {
    name: "decal-fade",
    key: `decal-fade-${mode}`,
    apply: (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
       gl_FragColor.rgb = mix( ${toward}, gl_FragColor.rgb, gl_FragColor.a );`,
      );
    },
  });

  switch (mode) {
    case "multiply":
      // ZERO/SRC_COLOR, CoD's `zero/srccolor`. Not THREE.MultiplyBlending: that
      // emits a plain `blendFunc`, so its factors hit alpha too (keepAlpha).
      mat.blending = THREE.CustomBlending;
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.ZeroFactor;
      mat.blendDst = THREE.SrcColorFactor;
      break;

    case "add":
      // ONE/ONE, not THREE.AdditiveBlending (SRC_ALPHA/ONE): these textures have no alpha.
      mat.blending = THREE.CustomBlending;
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneFactor;
      break;

    case "screen":
      mat.blending = THREE.CustomBlending;
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.OneMinusDstColorFactor;
      mat.blendDst = THREE.OneFactor;
      break;

    default:
      mat.dispose();
      return null;
  }
  keepAlpha(mat);
  return mat;
}

/**
 * Blend the colour only, leaving the framebuffer's alpha alone.
 *
 * three always creates the context with `alpha: true` and composites it
 * premultiplied, so the canvas's alpha is what the page shows through. A decal's
 * own alpha is its fade weight, not coverage — and three writes CustomBlending's
 * alpha factors from the colour ones unless they are set, so `dst.a *= src.a`
 * punches a decal-shaped hole in the frame that the compositor fills with the
 * page behind it. ZERO/ONE keeps `dst.a` exactly as the pass before it left it.
 */
export function keepAlpha(mat: THREE.Material): void {
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
}

/** The blend equation carried in glTF `extras`, if any. */
export function blendModeOf(material: Materials): string | undefined {
  const mode = firstUserData(material)?.blend;
  return typeof mode === "string" ? mode : undefined;
}

/** The game's draw order carried in glTF `extras`, if any. */
export function sortKeyOf(material: Materials): number | undefined {
  const key = firstUserData(material)?.sortKey;
  return typeof key === "number" ? key : undefined;
}

/** For a `decal: on` model without sort keys: pull it out of the depth fight with the surface under it. */
export function applyDecalBias(material: Materials): void {
  for (const mat of each(material)) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    mat.depthWrite = false;
  }
}

/**
 * Settings for a baked lightmap atlas: the second UV set, glTF's vertical
 * convention, clamped, and no mipmaps (neighbouring charts are unrelated parts
 * of the map, so mip levels bleed them into bright or dark seams).
 */
export function configureLightmapTexture(tex: THREE.Texture): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.channel = 1;
  tex.flipY = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter; // with mipmaps off, a mipmapping filter samples nothing

  return tex;
}

/**
 * Hang a lightmap off every standard material under `root` whose mesh has a
 * second UV set; returns how many. These materials are shared by every
 * placement of the asset, which suits the one case this serves: a map shell,
 * placed once.
 */
export function applyLightmap(root: THREE.Object3D, tex: THREE.Texture, intensity: number): number {
  let applied = 0;
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !child.geometry.getAttribute("uv1")) {
      return;
    }

    for (const mat of each(child.material)) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) {
        continue;
      }

      mat.lightMapIntensity = intensity; // a uniform: set every time, or a hot reload keeps the old value

      if (mat.lightMap !== tex) {
        mat.lightMap = tex; // a compile-time define, so only on change
        mat.needsUpdate = true;
      }

      applied++;
    }
  });

  return applied;
}
