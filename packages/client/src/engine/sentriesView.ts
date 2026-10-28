// Placed sentry guns, drawn where the server says and aimed the way it says.
//
// Every snapshot carries each sentry's place, the way its tripod faces, its
// gun's yaw and pitch and whether it is firing (`SentryState`); this interpolates
// the aim between the last two and derives the rest — the flash, the barrels
// spinning, the minigun's loop and its cooldown, the hydraulics as it turns —
// so a sentry costs the event tail nothing at 1,200 rounds a minute.
//
// MW3's own model (`sentry_minigun_weak`, which `_autosentry.gsc` puts down) is
// rigged: `tag_aim_pivot` turns it, `tag_aim` raises it, `j_spin` is the barrel
// cluster and `tag_flash` the muzzle. Its bones are in CoD's frame, x forward and
// z up, under the root's turn to y up. A root beside the scene, writing its own
// matrices, like the projectiles.

import * as THREE from "three";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import type { SentryState } from "@3d/shared/game/streaks.js";
import { SENTRY } from "@3d/shared/game/equipment.js";
import { TICK_RATE } from "@3d/shared/net/messages/fields.js";
import { MODEL_FACING } from "@3d/shared/rig/character.js";
import type { AudioSystem } from "./audio/system.js";
import type { AssetStore } from "../scene/assets.js";
import { worldWeaponUrl } from "../scene/assetUrl.js";

const INTERPOLATION_TICKS = 1;
const MODEL = "sentry_minigun_weak";
const SOUND_GAME = "iw5";
const HYDRAULICS = "sentry_gun_hydraulics";
/** `turretBarrelSpinSpeed`, read as turns a second. */
const BARREL_SPIN = 20 * Math.PI * 2;
/** Turning faster than this (radians a second) is turning, and is heard. */
const TURNING = 0.2;
/** A held sound's owner, below -1 (`AudioSystem.hold`): one pair per sentry id. */
const fireOwner = (id: number): number => -1000 - id * 2;
const turnOwner = (id: number): number => -1001 - id * 2;

interface Aim {
  at: number;
  yaw: number;
  pitch: number;
}

interface Drawn {
  id: number;
  base: THREE.Object3D;
  pivot: THREE.Object3D;
  aim: THREE.Object3D;
  spin?: THREE.Object3D;
  flash: THREE.Object3D;
  facing: number;
  from: Aim;
  to: Aim;
  firing: boolean;
  turning: boolean;
  flicker: number;
}

export class SentriesView {
  readonly root = new THREE.Group();
  private readonly live = new Map<number, Drawn>();
  private snapshotInterval = 1000 / TICK_RATE;
  private audio?: AudioSystem;
  /** The store's model, cloned per sentry and never disposed here. */
  private template?: THREE.Object3D;
  private readonly flashGeometry = new THREE.SphereGeometry(0.08, 8, 6);
  private readonly flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffcc66,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly standIn = {
    body: new THREE.BoxGeometry(0.42, 0.22, 0.32),
    metal: new THREE.MeshStandardMaterial({ color: 0x4a4f45, metalness: 0.6, roughness: 0.5 }),
  };

  constructor() {
    this.root.name = "sentries";
  }

  attachAudio(audio: AudioSystem): void {
    this.audio = audio;
  }

  setTickRate(hz: number): void {
    if (hz > 0 && Number.isFinite(hz)) {
      this.snapshotInterval = 1000 / hz;
    }
  }

  async prewarm(assets: AssetStore): Promise<void> {
    const url = worldWeaponUrl(SOUND_GAME, MODEL);
    try {
      this.template = (await assets.gltf(url))?.scene;
    } catch (e) {
      console.warn(`[sentries] no model at ${url}; drawing a stand-in`, e);
    }
  }

  get size(): number {
    return this.live.size;
  }

  /** One snapshot's sentries. Membership is the snapshot's: one that is gone was destroyed or packed up. */
  apply(states: readonly SentryState[], now: number): void {
    for (const state of states) {
      const aim: Aim = { at: now, yaw: state.yaw, pitch: state.pitch };
      const drawn = this.live.get(state.id) ?? this.build(state, aim);
      drawn.base.position.set(state.position.x, state.position.y, state.position.z);
      drawn.facing = state.facing;
      drawn.base.rotation.set(0, state.facing + MODEL_FACING, 0);
      const span = (aim.at - drawn.to.at) / 1000;
      drawn.turning = span > 0 && Math.abs(Math.atan2(Math.sin(aim.yaw - drawn.to.yaw), Math.cos(aim.yaw - drawn.to.yaw))) / span > TURNING;
      drawn.from = drawn.to;
      drawn.to = aim;
      this.setFiring(drawn, state.firing);
      this.live.set(state.id, drawn);
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

  update(dt: number, now: number): void {
    const at = now - this.snapshotInterval * INTERPOLATION_TICKS;
    for (const drawn of this.live.values()) {
      const { from, to } = drawn;
      const span = to.at - from.at;
      const t = span > 0 ? Math.min(Math.max((at - from.at) / span, 0), 1) : 1;
      const turn = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
      // In the bones' own frame: about z (up) to turn, about y (left) to raise, nose-up negative.
      drawn.pivot.rotation.z = from.yaw + turn * t - drawn.facing;
      drawn.aim.rotation.y = -(from.pitch + (to.pitch - from.pitch) * t);
      if (drawn.firing && drawn.spin) {
        drawn.spin.rotation.x += BARREL_SPIN * dt;
      }
      drawn.flicker = (drawn.flicker + dt) % SENTRY.fireTime;
      drawn.flash.visible = drawn.firing && drawn.flicker < SENTRY.fireTime / 2;
      this.hydraulics(drawn);
    }
    this.root.updateMatrixWorld(true);
  }

  clear(): void {
    for (const drawn of this.live.values()) {
      this.release(drawn);
    }
    this.live.clear();
  }

  /** On leaving a world. The model is the store's. */
  dispose(): void {
    this.clear();
    this.template = undefined;
    for (const owned of [this.flashGeometry, this.flashMaterial, this.standIn.body, this.standIn.metal]) {
      owned.dispose();
    }
  }

  /** The minigun's loop while it fires, and its cooldown when it stops (`loopFireSound`, `stopFireSound`). */
  private setFiring(drawn: Drawn, firing: boolean): void {
    if (firing === drawn.firing) {
      return;
    }
    drawn.firing = firing;
    const at = drawn.base.position;
    if (firing) {
      this.audio?.hold(SENTRY.loopFireSound, at, fireOwner(drawn.id), { channel: "sfx", game: SOUND_GAME });
    } else {
      this.audio?.release(fireOwner(drawn.id));
      this.audio?.playAt(SENTRY.stopFireSound, at, { channel: "sfx", game: SOUND_GAME });
    }
  }

  /** `scanSound`: the hydraulics, for as long as it is turning. */
  private hydraulics(drawn: Drawn): void {
    if (drawn.turning) {
      this.audio?.hold(HYDRAULICS, drawn.base.position, turnOwner(drawn.id), { channel: "sfx", game: SOUND_GAME });
    } else {
      this.audio?.release(turnOwner(drawn.id));
    }
  }

  private release(drawn: Drawn): void {
    this.audio?.release(fireOwner(drawn.id));
    this.audio?.release(turnOwner(drawn.id));
    this.root.remove(drawn.base);
  }

  private build(state: SentryState, aim: Aim): Drawn {
    const base = this.template ? SkeletonUtils.clone(this.template) : this.buildStandIn();
    base.name = `sentry-${state.id}`;
    const pivot = base.getObjectByName("tag_aim_pivot") ?? base;
    const aimBone = base.getObjectByName("tag_aim") ?? pivot;
    const muzzle = base.getObjectByName("tag_flash") ?? aimBone;
    const flash = new THREE.Mesh(this.flashGeometry, this.flashMaterial);
    flash.visible = false;
    muzzle.add(flash);
    this.root.add(base);
    return {
      id: state.id,
      base,
      pivot,
      aim: aimBone,
      spin: base.getObjectByName("j_spin") ?? undefined,
      flash,
      facing: state.facing,
      from: aim,
      to: aim,
      firing: false,
      turning: false,
      flicker: 0,
    };
  }

  /**
   * Until the catalogue holds the model: a box on a post, built as the real one
   * is rigged — a root turned to y up, a pivot that turns about its z, a gun
   * that pitches about its y, facing +x — so `update` drives both the same way.
   */
  private buildStandIn(): THREE.Object3D {
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    const pivot = new THREE.Group();
    pivot.name = "tag_aim_pivot";
    pivot.position.z = 0.8;
    root.add(pivot);
    const aim = new THREE.Group();
    aim.name = "tag_aim";
    pivot.add(aim);
    aim.add(new THREE.Mesh(this.standIn.body, this.standIn.metal));
    const flash = new THREE.Group();
    flash.name = "tag_flash";
    flash.position.x = 0.5;
    aim.add(flash);
    const outer = new THREE.Group();
    outer.add(root);
    return outer;
  }
}
