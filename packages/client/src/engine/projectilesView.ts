// 3D In-world projectile visualization and physics simulation for lethal and tactical equipment.
//
// Features:
// - Authentic MW3 3D models for Frag, Semtex, and Flashbang grenades
// - Parabolic trajectory physics, in-flight tumbling, and ground restitution
// - Semtex surface sticking and blinking red LED indicator
// - Audio integration (bounce, beeping, detonation)
// - Seamless hand-off to ExplosionFx upon detonation

import * as THREE from "three";
import type { Vec3 } from "@3d/shared/sim/capsule.js";
import type { AudioSystem } from "./audio/system.js";
import type { FirstPersonControls } from "./controls/firstPerson.js";
import { ExplosionFx } from "./fx/explosions.js";
import type { AssetStore } from "../scene/assets.js";

export type ProjectileKind = "frag" | "semtex" | "flashbang";

interface VisualProjectile {
  id: number;
  kind: ProjectileKind;
  root: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotSpeed: THREE.Vector3;
  fuseRemaining: number;
  stuck: boolean;
  ledMesh?: THREE.Mesh;
  ledLight?: THREE.PointLight;
}

export class ProjectilesView {
  readonly root = new THREE.Group();
  readonly explosions = new ExplosionFx();
  private readonly live = new Map<number, VisualProjectile>();

  // Cached template models loaded from catalog
  private readonly templates = new Map<ProjectileKind, THREE.Object3D>();
  private audio?: AudioSystem;
  private controls?: FirstPersonControls;

  constructor() {
    this.root.name = "projectiles-view";
    this.root.add(this.explosions.root);
  }

  /**
   * Bind audio and first person systems.
   */
  attachSystems(audio: AudioSystem, controls: FirstPersonControls): void {
    this.audio = audio;
    this.controls = controls;
  }

  /**
   * Preload 3D grenade models from the catalog via the AssetStore.
   */
  async prewarm(assets: AssetStore): Promise<void> {
    const models: [ProjectileKind, string][] = [
      ["frag", "/api/catalog/worldweapons/iw5/projectile_m67fraggrenade/projectile_m67fraggrenade.glb"],
      ["semtex", "/api/catalog/worldweapons/iw5/projectile_semtex_grenade/projectile_semtex_grenade.glb"],
      ["flashbang", "/api/catalog/worldweapons/iw5/projectile_m84_flashbang_grenade/projectile_m84_flashbang_grenade.glb"],
    ];

    await Promise.all(
      models.map(async ([kind, url]) => {
        try {
          const gltf = await assets.gltf(url);
          if (gltf && gltf.scene) {
            // Normalize scale and materials
            gltf.scene.traverse((obj) => {
              if (obj instanceof THREE.Mesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
              }
            });
            this.templates.set(kind, gltf.scene);
          }
        } catch (e) {
          console.warn(`[projectiles] failed to load ${kind} model from ${url}`, e);
        }
      }),
    );
  }

  /**
   * Spawn a visible projectile in flight.
   */
  onThrow(
    id: number,
    kind: ProjectileKind,
    position: Vec3,
    velocity: Vec3,
    fuseTime: number,
  ): void {
    if (this.live.has(id)) {
      return;
    }

    const template = this.templates.get(kind);
    let mesh: THREE.Object3D;

    if (template) {
      mesh = template.clone();
      mesh.scale.setScalar(1.0);
    } else {
      // Procedural fallback representation matching MW3 dimensions
      mesh = this.createFallbackMesh(kind);
    }

    const pos = new THREE.Vector3(position.x, position.y, position.z);
    mesh.position.copy(pos);

    // Initial random tumble speed
    const rotSpeed = new THREE.Vector3(
      (Math.random() - 0.5) * 16.0,
      (Math.random() - 0.5) * 12.0,
      (Math.random() - 0.5) * 14.0,
    );

    let ledMesh: THREE.Mesh | undefined;
    let ledLight: THREE.PointLight | undefined;

    if (kind === "semtex") {
      // Red blinking LED for Semtex
      const ledGeo = new THREE.SphereGeometry(0.025, 8, 8);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      ledMesh = new THREE.Mesh(ledGeo, ledMat);
      ledMesh.position.set(0, 0.08, 0.02);
      mesh.add(ledMesh);

      ledLight = new THREE.PointLight(0xff0000, 2.0, 3.0);
      ledLight.position.copy(ledMesh.position);
      mesh.add(ledLight);
    }

    this.root.add(mesh);

    this.live.set(id, {
      id,
      kind,
      root: mesh,
      position: pos,
      velocity: new THREE.Vector3(velocity.x, velocity.y, velocity.z),
      rotSpeed,
      fuseRemaining: fuseTime,
      stuck: false,
      ledMesh,
      ledLight,
    });
  }

  /**
   * Handle server bounce announcement.
   */
  onBounce(id: number, position: Vec3, velocity?: Vec3): void {
    const p = this.live.get(id);
    if (!p) {
      return;
    }
    p.position.set(position.x, position.y, position.z);
    p.root.position.copy(p.position);
    if (velocity) {
      p.velocity.set(velocity.x, velocity.y, velocity.z);
    }
    // Dampen tumbling
    p.rotSpeed.multiplyScalar(0.7);

    // Play bounce sound
    if (this.audio) {
      this.audio.playAt("grenade_bounce", position, { channel: "sfx", game: "iw5" });
    }
  }

  /**
   * Handle Semtex sticking to a surface or player.
   */
  onStick(id: number, _target: string, position: Vec3): void {
    const p = this.live.get(id);
    if (!p) {
      return;
    }
    p.position.set(position.x, position.y, position.z);
    p.root.position.copy(p.position);
    p.velocity.set(0, 0, 0);
    p.rotSpeed.set(0, 0, 0);
    p.stuck = true;
  }

  /**
   * Handle Semtex warning beep audio.
   */
  onBeep(id: number, position: Vec3): void {
    if (this.audio) {
      this.audio.playAt("semtex_beep", position, { channel: "sfx", game: "iw5" });
    }
    const p = this.live.get(id);
    if (p && p.ledLight) {
      // Flash the LED brightly on beep
      p.ledLight.intensity = 4.0;
    }
  }

  /**
   * Handle detonation event: remove 3D grenade and spawn explosion effect.
   */
  onDetonate(kind: ProjectileKind, position: Vec3, id?: number): void {
    if (id !== undefined && this.live.has(id)) {
      const p = this.live.get(id)!;
      this.root.remove(p.root);
      this.disposeObject(p.root);
      this.live.delete(id);
    } else {
      // Find closest grenade to position
      let closestId: number | undefined;
      let closestDist = 2.5; // within 2.5m
      for (const [pId, p] of this.live.entries()) {
        const d = p.position.distanceTo(new THREE.Vector3(position.x, position.y, position.z));
        if (d < closestDist) {
          closestDist = d;
          closestId = pId;
        }
      }
      if (closestId !== undefined) {
        const p = this.live.get(closestId)!;
        this.root.remove(p.root);
        this.disposeObject(p.root);
        this.live.delete(closestId);
      }
    }

    // Spawn authentic explosion FX
    this.explosions.spawn(position, kind, this.audio, this.controls);
  }

  /**
   * Step in-flight projectiles and explosion effects.
   */
  update(dt: number, camera?: THREE.Camera): void {
    // 1. Step in-flight grenades
    for (const p of this.live.values()) {
      p.fuseRemaining -= dt;

      if (!p.stuck) {
        // Gravity (-15 m/s^2)
        p.velocity.y -= 15.0 * dt;

        p.position.addScaledVector(p.velocity, dt);
        p.root.position.copy(p.position);

        // Tumbling rotation
        p.root.rotation.x += p.rotSpeed.x * dt;
        p.root.rotation.y += p.rotSpeed.y * dt;
        p.root.rotation.z += p.rotSpeed.z * dt;
      }

      // Semtex blinking LED
      if (p.kind === "semtex" && p.ledLight) {
        const blinkCycle = Math.sin(performance.now() * 0.015);
        p.ledLight.intensity = blinkCycle > 0.2 ? 2.0 : 0.2;
      }
    }

    // 2. Update explosion FX
    this.explosions.update(dt, camera);
  }

  /**
   * Clear all live grenades and explosion effects.
   */
  clear(): void {
    for (const p of this.live.values()) {
      this.root.remove(p.root);
      this.disposeObject(p.root);
    }
    this.live.clear();
    this.explosions.clear();
  }

  private createFallbackMesh(kind: ProjectileKind): THREE.Object3D {
    const group = new THREE.Group();
    if (kind === "frag") {
      // M67 baseball grenade shape
      const geo = new THREE.SphereGeometry(0.065, 12, 12);
      const mat = new THREE.MeshStandardMaterial({ color: 0x445533, roughness: 0.6 });
      const body = new THREE.Mesh(geo, mat);
      group.add(body);

      const capGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8);
      const capMat = new THREE.MeshStandardMaterial({ color: 0x888877, metalness: 0.8 });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = 0.07;
      group.add(cap);
    } else if (kind === "semtex") {
      // Sticky Semtex brick shape
      const geo = new THREE.BoxGeometry(0.08, 0.14, 0.06);
      const mat = new THREE.MeshStandardMaterial({ color: 0x224422, roughness: 0.9 });
      const body = new THREE.Mesh(geo, mat);
      group.add(body);
    } else {
      // M84 flashbang cylinder
      const geo = new THREE.CylinderGeometry(0.03, 0.03, 0.13, 12);
      const mat = new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.7 });
      const body = new THREE.Mesh(geo, mat);
      group.add(body);
    }
    return group;
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
}
