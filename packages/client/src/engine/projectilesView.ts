// Thrown equipment in the world, drawn where the server says it is.
//
// The server owns the flight (game-server/src/match/projectiles.ts) and every
// snapshot carries each projectile's position, so this interpolates between the
// last two like an actor rather than re-simulating a throw it can only guess at:
// a second simulation drifts from the first at the first bounce, and the
// explosion then happens a metre from the grenade everyone watched land.
//
// Owns a root beside the scene, like corpses and actors, and writes its own
// matrices: the scene's `matrixWorldAutoUpdate` is off, so nothing else would.
// The cosmetic parts — tumble, a bounce's sound, semtex's warning — are derived
// here from the positions, and cost the wire nothing. The models and the sounds
// are MW3's own (@3d/shared/game/equipment.ts says where each came from).

import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Vec3 } from "@3d/shared/sim/capsule.js";
import type { DetonateEvent } from "@3d/shared/net/messages/events.js";
import { PROJECTILE_KINDS, type ProjectileKind, type ProjectileState } from "@3d/shared/sim/projectile.js";
import { TICK_RATE } from "@3d/shared/net/messages/fields.js";
import type { AudioSystem } from "./audio/system.js";
import type { FirstPersonControls } from "./controls/firstPerson.js";
import { ExplosionFx } from "./fx/explosions.js";
import type { AssetStore } from "../scene/assets.js";
import { worldWeaponUrl } from "../scene/assetUrl.js";
import { GRENADE_BOUNCE_SOUND, PREDATOR, SEMTEX_WARNING_SOUND } from "@3d/shared/game/equipment.js";
import type { SurfaceType } from "@3d/shared/sim/surfaces.js";

/** One tick behind the newer snapshot, as peers and actors are drawn. */
const INTERPOLATION_TICKS = 1;
/** The LED's blink: a light, and nothing the game times. */
const BLINK_PERIOD = 0.5;
/** The bank these sounds are in: the models are MW3's, and so are their recordings. */
const SOUND_GAME = "iw5";
/** A fall this fast (m/s) that stops or turns upward was a bounce, worth a sound. */
const BOUNCE_SPEED = 1.5;

/** The long axis of what is drawn: a CoD model's forward is +x, the stand-in cylinder's is +y. */
const MODEL_FORWARD = new THREE.Vector3(1, 0, 0);
const STAND_IN_FORWARD = new THREE.Vector3(0, 1, 0);
const FLIGHT = new THREE.Vector3();

/** The MW3 models, in `worlds/catalog/worldweapons/iw5/`. A kind with none is drawn as its stand-in. */
const MODELS: Partial<Record<ProjectileKind, string>> = {
  frag: "projectile_m67fraggrenade",
  semtex: "projectile_semtex_grenade",
  flashbang: "projectile_m84_flashbang_grenade",
  missile: PREDATOR.model,
};

interface Sample {
  at: number;
  position: Vec3;
}

interface Drawn {
  id: number;
  kind: ProjectileKind;
  object: THREE.Object3D;
  from: Sample;
  to: Sample;
  /** Vertical speed between the last two samples, which is how a bounce is noticed. */
  fall: number;
  spin: THREE.Vector3;
  age: number;
  sinceBeep: number;
  /** Semtex's light: its own material, so one blinking does not blink them all. */
  led?: THREE.MeshBasicMaterial;
  /** Which local axis points along its flight, for a missile. */
  forward: THREE.Vector3;
}

export class ProjectilesView {
  readonly root = new THREE.Group();
  readonly explosions = new ExplosionFx();
  private readonly live = new Map<number, Drawn>();
  /** Loaded models, owned by the session's `AssetStore`: cloned, never disposed here. */
  private readonly templates = new Map<ProjectileKind, THREE.Object3D>();
  /** Stand-ins for a model that did not load, built once and owned here. */
  private readonly fallbacks = new Map<ProjectileKind, { geometry: THREE.BufferGeometry; material: THREE.Material }>();
  private readonly ledGeometry = new THREE.SphereGeometry(0.02, 8, 8);
  private snapshotInterval = 1000 / TICK_RATE;
  private audio?: AudioSystem;
  private controls?: FirstPersonControls;
  private surfaceAt?: (at: Vec3) => SurfaceType | null;

  constructor() {
    this.root.name = "projectiles-view";
    this.root.add(this.explosions.root);
  }

  /** `surfaceAt` is what a bounce lands on, which is what it sounds like. */
  attachSystems(audio: AudioSystem, controls: FirstPersonControls, surfaceAt?: (at: Vec3) => SurfaceType | null): void {
    this.audio = audio;
    this.controls = controls;
    this.surfaceAt = surfaceAt;
  }

  setTickRate(hz: number): void {
    if (hz > 0 && Number.isFinite(hz)) {
      this.snapshotInterval = 1000 / hz;
    }
  }

  /** Fetch the three models through the session's store, so leaving the world frees them. */
  async prewarm(assets: AssetStore): Promise<void> {
    await Promise.all(
      PROJECTILE_KINDS.map(async (kind) => {
        const model = MODELS[kind];
        if (!model) {
          return;
        }
        const url = worldWeaponUrl("iw5", model);
        try {
          const gltf = await assets.gltf(url);
          if (gltf) {
            this.templates.set(kind, gltf.scene);
          }
        } catch (e) {
          console.warn(`[projectiles] no model for ${kind} at ${url}; drawing a stand-in`, e);
        }
      }),
    );
  }

  /** One snapshot's projectiles. Membership is the snapshot's: one that is gone went off, or was never going to. */
  apply(states: readonly ProjectileState[], now: number): void {
    for (const state of states) {
      const sample: Sample = { at: now, position: { ...state.position } };
      const drawn = this.live.get(state.id);
      if (drawn && drawn.kind === state.kind) {
        const span = (sample.at - drawn.to.at) / 1000;
        const fall = span > 0 ? (sample.position.y - drawn.to.position.y) / span : drawn.fall;
        if (drawn.fall < -BOUNCE_SPEED && fall > -0.2) {
          this.bounced(drawn);
        }
        drawn.fall = fall;
        drawn.from = drawn.to;
        drawn.to = sample;
        continue;
      }
      if (drawn) {
        this.release(drawn); // an id the server wrapped round onto another kind
      }
      this.live.set(state.id, this.build(state, sample));
    }
    if (states.length !== this.live.size) {
      const present = new Set(states.map((s) => s.id));
      for (const [id, drawn] of this.live) {
        if (!present.has(id)) {
          this.release(drawn);
          this.live.delete(id);
        }
      }
    }
  }

  /** Something went off: the blast where the server says, and the grenade gone if it is still drawn. */
  detonate(event: DetonateEvent): void {
    for (const [id, drawn] of this.live) {
      const p = drawn.to.position;
      if (drawn.kind === event.what && Math.hypot(p.x - event.at.x, p.y - event.at.y, p.z - event.at.z) < 1) {
        this.release(drawn);
        this.live.delete(id);
        break;
      }
    }
    this.explosions.spawn(event.at, event.what, this.audio, this.controls);
  }

  /**
   * The nearest live frag or semtex to `feet` within `radius`, as an offset from
   * them; null when there is none. What the danger indicator points at.
   */
  nearestThreat(feet: Vec3, radius: number): Vec3 | null {
    let best: Vec3 | null = null;
    let bestDistance = radius;
    for (const drawn of this.live.values()) {
      if (drawn.kind === "flashbang" || drawn.kind === "missile") {
        continue; // MW3 marks a grenade at your feet, and nothing else
      }
      const p = drawn.to.position;
      const offset = { x: p.x - feet.x, y: p.y - feet.y, z: p.z - feet.z };
      const distance = Math.hypot(offset.x, offset.y, offset.z);
      if (distance <= bestDistance) {
        best = offset;
        bestDistance = distance;
      }
    }
    return best;
  }

  get size(): number {
    return this.live.size;
  }

  /** Every frame: interpolate, tumble, beep, and the explosions' own step. */
  update(dt: number, now: number, camera?: THREE.Camera): void {
    const at = now - this.snapshotInterval * INTERPOLATION_TICKS;
    for (const drawn of this.live.values()) {
      const { from, to, object } = drawn;
      const span = to.at - from.at;
      const t = span > 0 ? Math.min(Math.max((at - from.at) / span, 0), 1) : 1;
      object.position.set(
        from.position.x + (to.position.x - from.position.x) * t,
        from.position.y + (to.position.y - from.position.y) * t,
        from.position.z + (to.position.z - from.position.z) * t,
      );
      const moved = Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y, to.position.z - from.position.z);
      if (drawn.kind === "missile") {
        // Nose along its flight rather than tumbling: the stand-in's long axis is y.
        if (moved > 0.01) {
          FLIGHT.set(to.position.x - from.position.x, to.position.y - from.position.y, to.position.z - from.position.z).normalize();
          object.quaternion.setFromUnitVectors(drawn.forward, FLIGHT);
        }
      } else if (moved > 0.01) {
        object.rotation.x += drawn.spin.x * dt;
        object.rotation.y += drawn.spin.y * dt;
        object.rotation.z += drawn.spin.z * dt;
      }
      drawn.age += dt;
      if (drawn.kind === "semtex") {
        drawn.sinceBeep = (drawn.sinceBeep + dt) % BLINK_PERIOD;
        drawn.led?.color.setHex(drawn.sinceBeep < 0.1 ? 0xff2020 : 0x400000);
      }
    }
    this.explosions.update(dt, camera);
    this.root.updateMatrixWorld(true);
  }

  clear(): void {
    for (const drawn of this.live.values()) {
      this.release(drawn);
    }
    this.live.clear();
    this.explosions.clear();
  }

  /** On leaving a world: what this view built itself. The models are the store's. */
  dispose(): void {
    this.clear();
    this.templates.clear();
    for (const { geometry, material } of this.fallbacks.values()) {
      geometry.dispose();
      material.dispose();
    }
    this.fallbacks.clear();
    this.ledGeometry.dispose();
  }

  private build(state: ProjectileState, sample: Sample): Drawn {
    const template = this.templates.get(state.kind);
    // SkeletonUtils, not `clone()`: MW3's models are skinned, and a plain clone keeps the template's bones.
    const object = template ? SkeletonUtils.clone(template) : new THREE.Mesh(...this.fallback(state.kind));
    object.position.set(sample.position.x, sample.position.y, sample.position.z);
    let led: THREE.MeshBasicMaterial | undefined;
    if (state.kind === "semtex") {
      led = new THREE.MeshBasicMaterial({ color: 0x400000 });
      const bulb = new THREE.Mesh(this.ledGeometry, led);
      bulb.position.set(0, 0.06, 0.02);
      object.add(bulb);
    }
    this.root.add(object);
    if (state.kind === "semtex") {
      // `projIgnitionSound`: once, as it is armed, and two seconds long — the length of its fuse.
      this.audio?.playAt(SEMTEX_WARNING_SOUND, sample.position, { channel: "sfx", game: SOUND_GAME });
    }
    // A spin of its own per id, so two grenades in the air do not turn in step.
    const spin = new THREE.Vector3(Math.sin(state.id * 12.9898) * 8, Math.sin(state.id * 78.233) * 6, Math.sin(state.id * 37.719) * 7);
    const forward = template ? MODEL_FORWARD : STAND_IN_FORWARD;
    return { id: state.id, kind: state.kind, object, from: sample, to: sample, fall: 0, spin, age: 0, sinceBeep: 0, led, forward };
  }

  private bounced(drawn: Drawn): void {
    drawn.spin.multiplyScalar(0.6);
    // `bounceSound` is a prefix the surface completes, as the game spells it.
    const surface = this.surfaceAt?.(drawn.to.position) ?? "default";
    const alias = `${GRENADE_BOUNCE_SOUND}_${surface}`;
    const known = this.audio?.knows(alias, SOUND_GAME) ? alias : `${GRENADE_BOUNCE_SOUND}_default`;
    this.audio?.playAt(known, drawn.to.position, { channel: "sfx", game: SOUND_GAME });
  }

  private release(drawn: Drawn): void {
    this.root.remove(drawn.object);
    drawn.led?.dispose();
  }

  private fallback(kind: ProjectileKind): [THREE.BufferGeometry, THREE.Material] {
    let built = this.fallbacks.get(kind);
    if (!built) {
      built =
        kind === "frag"
          ? { geometry: new THREE.SphereGeometry(0.065, 12, 12), material: new THREE.MeshStandardMaterial({ color: 0x445533, roughness: 0.6 }) }
          : kind === "semtex"
            ? { geometry: new THREE.BoxGeometry(0.08, 0.14, 0.06), material: new THREE.MeshStandardMaterial({ color: 0x224422, roughness: 0.9 }) }
            : kind === "flashbang"
              ? { geometry: new THREE.CylinderGeometry(0.03, 0.03, 0.13, 12), material: new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.7 }) }
              : // A hellfire, nose down its flight and burning: unlit, so it reads against a dark sky.
                { geometry: new THREE.CylinderGeometry(0.09, 0.09, 1.6, 10), material: new THREE.MeshBasicMaterial({ color: 0xffd28a }) };
      this.fallbacks.set(kind, built);
    }
    return [built.geometry, built.material];
  }
}
