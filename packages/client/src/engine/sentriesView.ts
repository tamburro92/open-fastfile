// Placed sentry guns, drawn where the server says and aimed the way it says.
//
// Every snapshot carries each sentry's place, its gun's yaw and pitch and whether
// it is firing (`SentryState`); this interpolates the aim between the last two and
// derives the rest — the muzzle flash and the report — from `firing`, so a sentry
// costs the event tail nothing at six hundred rounds a minute.
//
// A root beside the scene, writing its own matrices, like the projectiles.

import * as THREE from "three";
import type { SentryState } from "@3d/shared/game/streaks.js";
import { TICK_RATE } from "@3d/shared/net/messages/fields.js";
import type { AudioSystem } from "./audio/system.js";

const INTERPOLATION_TICKS = 1;
/** Its rounds: the server's 600 a minute, heard at the same rate. */
const FIRE_INTERVAL = 0.1;
/** The bank and the round it is heard as. MW3's own sentry report is not in the exported bank yet. */
const SOUND_GAME = "iw5";
const FIRE_ALIAS = "weap_mk46_fire_npc";
const MUZZLE_HEIGHT = 0.8;

interface Aim {
  at: number;
  yaw: number;
  pitch: number;
}

interface Drawn {
  base: THREE.Group;
  head: THREE.Group;
  gun: THREE.Group;
  flash: THREE.Mesh;
  from: Aim;
  to: Aim;
  firing: boolean;
  sinceShot: number;
}

export class SentriesView {
  readonly root = new THREE.Group();
  private readonly live = new Map<number, Drawn>();
  private snapshotInterval = 1000 / TICK_RATE;
  private audio?: AudioSystem;
  private readonly parts = {
    leg: new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6),
    body: new THREE.BoxGeometry(0.32, 0.22, 0.42),
    barrel: new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8),
    flash: new THREE.SphereGeometry(0.09, 8, 6),
    metal: new THREE.MeshStandardMaterial({ color: 0x4a4f45, metalness: 0.6, roughness: 0.5 }),
    flashMaterial: new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
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

  get size(): number {
    return this.live.size;
  }

  /** One snapshot's sentries. Membership is the snapshot's: one that is gone was destroyed or packed up. */
  apply(states: readonly SentryState[], now: number): void {
    for (const state of states) {
      const aim: Aim = { at: now, yaw: state.yaw, pitch: state.pitch };
      const drawn = this.live.get(state.id) ?? this.build(state, aim);
      drawn.base.position.set(state.position.x, state.position.y, state.position.z);
      drawn.from = drawn.to;
      drawn.to = aim;
      drawn.firing = state.firing;
      this.live.set(state.id, drawn);
    }
    if (states.length !== this.live.size) {
      const present = new Set(states.map((s) => s.id));
      for (const [id, drawn] of this.live) {
        if (!present.has(id)) {
          this.root.remove(drawn.base);
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
      drawn.head.rotation.y = from.yaw + turn * t;
      drawn.gun.rotation.x = from.pitch + (to.pitch - from.pitch) * t;
      drawn.sinceShot += dt;
      if (drawn.firing && drawn.sinceShot >= FIRE_INTERVAL) {
        drawn.sinceShot = 0;
        drawn.flash.getWorldPosition(MUZZLE);
        this.audio?.playAt(FIRE_ALIAS, MUZZLE, { channel: "sfx", game: SOUND_GAME });
      }
      drawn.flash.visible = drawn.firing && drawn.sinceShot < FIRE_INTERVAL / 2;
    }
    this.root.updateMatrixWorld(true);
  }

  clear(): void {
    for (const drawn of this.live.values()) {
      this.root.remove(drawn.base);
    }
    this.live.clear();
  }

  dispose(): void {
    this.clear();
    const { leg, body, barrel, flash, metal, flashMaterial } = this.parts;
    for (const owned of [leg, body, barrel, flash, metal, flashMaterial]) {
      owned.dispose();
    }
  }

  /**
   * A stand-in until the MW3 model is in the catalogue: a tripod, a body that
   * turns about y, and a gun that pitches about x, facing -z as yaw 0 does.
   */
  private build(state: SentryState, aim: Aim): Drawn {
    const { leg, body, barrel, flash: flashGeometry, metal, flashMaterial } = this.parts;
    const base = new THREE.Group();
    base.name = `sentry-${state.id}`;
    for (let i = 0; i < 3; i++) {
      const foot = new THREE.Mesh(leg, metal);
      const around = (i / 3) * Math.PI * 2;
      foot.position.set(Math.sin(around) * 0.22, 0.4, Math.cos(around) * 0.22);
      foot.rotation.set(Math.cos(around) * 0.35, 0, -Math.sin(around) * 0.35);
      base.add(foot);
    }
    const head = new THREE.Group();
    head.position.y = MUZZLE_HEIGHT;
    base.add(head);
    const gun = new THREE.Group();
    head.add(gun);
    gun.add(new THREE.Mesh(body, metal));
    const tube = new THREE.Mesh(barrel, metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = -0.45;
    gun.add(tube);
    const flash = new THREE.Mesh(flashGeometry, flashMaterial);
    flash.position.z = -0.8;
    flash.visible = false;
    gun.add(flash);
    this.root.add(base);
    return { base, head, gun, flash, from: aim, to: aim, firing: false, sinceShot: FIRE_INTERVAL };
  }
}

const MUZZLE = new THREE.Vector3();
