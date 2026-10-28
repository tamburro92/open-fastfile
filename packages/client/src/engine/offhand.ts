// A grenade in the hand: MW3's own view model and clips, drawn in place of the
// weapon for the length of a throw.
//
// The game does not animate a throw over the gun it is holding. It puts the gun
// away and brings up the grenade's own viewmodel — `viewmodel_m67` on the view
// hands — plays `holdFireAnim` while the pin comes out and `fireAnim` as it
// leaves, then raises the gun again. The rigs are the catalogue's equipment
// entries (`catalog --equipment-only`), and the two phases are timed by the
// weapon file's `holdFireTime` and `fireTime` (`THROW_TIMES`), which is also when
// the server lets the grenade go.

import * as THREE from "three";
import { THROW_TIMES } from "@3d/shared/game/equipment.js";
import { releaseRig } from "@3d/shared/rig/release.js";
import type { ViewmodelRig } from "../scene/viewmodel.js";

export type OffhandKind = keyof typeof THROW_TIMES;

interface Held {
  rig: ViewmodelRig;
  holder: THREE.Group;
  mixer: THREE.AnimationMixer;
}

interface Throw {
  held: Held;
  kind: OffhandKind;
  elapsed: number;
  released: boolean;
}

/**
 * Hang a rig with its eye at the origin and CoD's forward (+X) facing the
 * camera's -Z: a quarter turn about Y, then the eye pulled back to it. The
 * weapon's rig and a grenade's are mounted alike.
 */
export function mountRig(rig: ViewmodelRig): THREE.Group {
  const holder = new THREE.Group();
  holder.rotation.y = Math.PI / 2;
  rig.root.position.set(0, 0, 0);
  rig.root.updateMatrixWorld(true);
  rig.root.position.copy(rig.root.worldToLocal(rig.eye.getWorldPosition(new THREE.Vector3())).negate());
  holder.add(rig.root);
  return holder;
}

export class Offhand {
  readonly root = new THREE.Group();
  private readonly held = new Map<OffhandKind, Held>();
  private current: Throw | undefined;

  constructor() {
    this.root.name = "offhand";
  }

  /** Mid-throw: the gun is away and the grenade is in hand. */
  get busy(): boolean {
    return this.current !== undefined;
  }

  /** The rigs a world's hands wear, one a kind. A kind with none is thrown with no animation. */
  set(rigs: ReadonlyMap<OffhandKind, ViewmodelRig>): void {
    this.clear();
    for (const [kind, rig] of rigs) {
      const holder = mountRig(rig);
      holder.visible = false;
      this.root.add(holder);
      this.held.set(kind, { rig, holder, mixer: new THREE.AnimationMixer(rig.root) });
    }
  }

  /** Start a throw; false when the kind has no rig or one is already under way. */
  start(kind: OffhandKind): boolean {
    const held = this.held.get(kind);
    if (!held || this.current) {
      return false;
    }
    held.holder.visible = true;
    this.current = { held, kind, elapsed: 0, released: false };
    this.play(held, "holdFire");
    return true;
  }

  /** Step the throw; true on the frame it ends, when the gun should come back up. */
  update(dt: number): boolean {
    const t = this.current;
    if (!t) {
      return false;
    }
    t.elapsed += dt;
    const times = THROW_TIMES[t.kind];
    if (!t.released && t.elapsed >= times.holdFire) {
      t.released = true;
      this.play(t.held, "fire");
    }
    t.held.mixer.update(dt);
    if (t.elapsed < times.holdFire + times.fire) {
      return false;
    }
    t.held.mixer.stopAllAction();
    t.held.holder.visible = false;
    this.current = undefined;
    return true;
  }

  /** Let go of the rigs. Their geometry and materials belong to the world's AssetStore. */
  clear(): void {
    for (const { rig, mixer, holder } of this.held.values()) {
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.root);
      releaseRig(rig.root);
      this.root.remove(holder);
    }
    this.held.clear();
    this.current = undefined;
  }

  private play({ rig, mixer }: Held, role: "holdFire" | "fire"): void {
    const name = rig.def.roles[role];
    const clip = name ? rig.clips.get(name) : undefined;
    if (!clip) {
      return;
    }
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().play();
  }
}
