// High-fidelity Call of Duty: Modern Warfare 3 explosion visual and audio effects.
//
// Detonations spawn:
// - Expanding fiery blast core / fireball (orange/yellow hot core)
// - Shockwave blast ring expanding rapidly outwards
// - Billowing rising smoke clouds
// - Flying high-velocity sparks / glowing shrapnel debris
// - Ground scorch mark decal
// - Spatial 3D explosion sound dispatch (grenade_explode_default / flashbang_explode_default)
// - Visceral camera shake / trauma jitter for players in blast range

//
// No light. A `PointLight` added to the scene changes the number of lights every
// lit material's program is keyed on, so three recompiles the whole map's shaders
// — once as it appears and again as it goes: seconds of a frozen game per
// explosion. The fireball's additive glow is the flash.

import * as THREE from "three";
import type { Vec3 } from "@3d/shared/sim/capsule.js";
import type { AudioSystem } from "../audio/system.js";
import type { FirstPersonControls } from "../controls/firstPerson.js";
import type { DetonationKind } from "@3d/shared/sim/projectile.js";
import { PREDATOR } from "@3d/shared/game/equipment.js";

/** Where the prewarm's explosion goes off: under any map, and out of every view. */
const PREWARM_DEPTH = -10_000;

interface Spark {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  color: THREE.Color;
}

interface SmokePuff {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  initialScale: number;
  targetScale: number;
}

interface ActiveExplosion {
  kind: DetonationKind;
  origin: THREE.Vector3;
  age: number;
  fireball?: THREE.Mesh;
  shockwave?: THREE.Mesh;
  scorch?: THREE.Mesh;
  smoke: SmokePuff[];
  sparks: Spark[];
  sparksMesh?: THREE.InstancedMesh;
}

export class ExplosionFx {
  readonly root = new THREE.Group();
  private readonly active: ActiveExplosion[] = [];

  // Reusable materials & geometries for zero-allocation pooling
  private fireballGeometry = new THREE.SphereGeometry(1, 16, 12);
  private shockwaveGeometry = new THREE.RingGeometry(0.2, 0.6, 24);
  private scorchGeometry = new THREE.CircleGeometry(1.6, 16);
  private smokeGeometry = new THREE.PlaneGeometry(1, 1);
  private sparkGeometry = new THREE.BoxGeometry(0.04, 0.04, 0.08);

  private readonly dummy = new THREE.Object3D();

  constructor() {
    this.root.name = "explosions-fx";
  }

  /**
   * One explosion far below the map, for the load's shader prewarm to draw: its
   * materials compile behind the loading screen instead of on the first grenade.
   * It fades away on its own like any other; nothing can see it meanwhile.
   */
  prewarm(): void {
    this.spawn({ x: 0, y: PREWARM_DEPTH, z: 0 }, "frag");
  }

  /**
   * Spawn an authentic explosion effect at the given 3D position.
   */
  spawn(position: Vec3, kind: DetonationKind = "frag", audio?: AudioSystem, controls?: FirstPersonControls): void {
    const pos = new THREE.Vector3(position.x, position.y, position.z);

    // 1. Audio: 3D spatialized explosion sound
    if (audio) {
      const alias = kind === "flashbang" ? "flashbang_explode_default" : kind === "missile" ? PREDATOR.explosionSound : "grenade_explode_default";
      if (audio.knows(alias, "iw5") || audio.knows(alias)) {
        audio.playAt(alias, position, { channel: "sfx", game: "iw5" });
      }
    }

    // 2. Camera shake / trauma for local player
    if (controls) {
      const camPos = controls.player.movement.feet;
      const dx = pos.x - camPos.x;
      const dy = pos.y - (camPos.y + 1.5);
      const dz = pos.z - camPos.z;
      const dist = Math.hypot(dx, dy, dz);
      const maxShakeDist = kind === "flashbang" ? 22.0 : 16.0;

      if (dist < maxShakeDist) {
        const shakeStrength = Math.max(0, 1.0 - dist / maxShakeDist);
        controls.addTrauma(shakeStrength * (kind === "flashbang" ? 0.75 : 1.0));
      }
    }

    // 4. Fireball / Flash core mesh
    const fireballMat = new THREE.MeshBasicMaterial({
      color: kind === "flashbang" ? 0xffffff : 0xffbb33,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const fireball = new THREE.Mesh(this.fireballGeometry, fireballMat);
    fireball.position.copy(pos);
    fireball.scale.setScalar(0.3);
    this.root.add(fireball);

    // 5. Blast shockwave ring
    const shockwaveMat = new THREE.MeshBasicMaterial({
      color: kind === "flashbang" ? 0xddddff : 0xff7722,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shockwave = new THREE.Mesh(this.shockwaveGeometry, shockwaveMat);
    shockwave.position.copy(pos);
    shockwave.position.y += 0.05;
    shockwave.rotation.x = -Math.PI / 2; // Flat on horizontal plane
    this.root.add(shockwave);

    // 6. Ground scorch mark
    const scorchMat = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const scorch = new THREE.Mesh(this.scorchGeometry, scorchMat);
    scorch.position.copy(pos);
    scorch.position.y += 0.02;
    scorch.rotation.x = -Math.PI / 2;
    this.root.add(scorch);

    // 7. Billowing smoke puffs
    const smoke: SmokePuff[] = [];
    const puffCount = kind === "flashbang" ? 4 : 8;
    for (let i = 0; i < puffCount; i++) {
      const angle = (i / puffCount) * Math.PI * 2 + Math.random() * 0.5;
      const speed = 0.8 + Math.random() * 1.5;
      const mat = new THREE.MeshBasicMaterial({
        color: kind === "flashbang" ? 0xcccccc : 0x222222,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      });
      const puffMesh = new THREE.Mesh(this.smokeGeometry, mat);
      puffMesh.position.set(pos.x + Math.cos(angle) * 0.3, pos.y + 0.2 + Math.random() * 0.3, pos.z + Math.sin(angle) * 0.3);
      puffMesh.scale.setScalar(0.4);
      this.root.add(puffMesh);

      smoke.push({
        mesh: puffMesh,
        velocity: new THREE.Vector3(Math.cos(angle) * speed * 0.4, 1.2 + Math.random() * 1.0, Math.sin(angle) * speed * 0.4),
        age: 0,
        lifetime: 1.4 + Math.random() * 0.8,
        initialScale: 0.4,
        targetScale: 2.2 + Math.random() * 1.2,
      });
    }

    // 8. Flying glowing sparks / shrapnel debris
    const sparks: Spark[] = [];
    const sparkCount = kind === "flashbang" ? 12 : 28;
    for (let i = 0; i < sparkCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.2) * Math.PI * 0.5;
      const speed = 8.0 + Math.random() * 14.0;

      sparks.push({
        position: pos.clone().add(new THREE.Vector3(0, 0.2, 0)),
        velocity: new THREE.Vector3(Math.cos(theta) * Math.cos(phi) * speed, Math.sin(phi) * speed + 3.0, Math.sin(theta) * Math.cos(phi) * speed),
        age: 0,
        lifetime: 0.4 + Math.random() * 0.45,
        color: new THREE.Color(kind === "flashbang" ? 0xffffff : Math.random() > 0.3 ? 0xffaa22 : 0xff3300),
      });
    }

    const sparksMat = new THREE.MeshBasicMaterial({
      color: 0xffaa22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sparksMesh = new THREE.InstancedMesh(this.sparkGeometry, sparksMat, sparkCount);
    sparksMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.root.add(sparksMesh);

    this.active.push({
      kind,
      origin: pos,
      age: 0,
      fireball,
      shockwave,
      scorch,
      smoke,
      sparks,
      sparksMesh,
    });
  }

  /**
   * Update active explosion visual elements across dt.
   */
  update(dt: number, camera?: THREE.Camera): void {
    if (this.active.length === 0) {
      return;
    }

    for (let i = this.active.length - 1; i >= 0; i--) {
      const exp = this.active[i]!;
      exp.age += dt;

      // 2. Fireball expansion and fade (0.35s)
      if (exp.fireball) {
        const maxScale = exp.kind === "flashbang" ? 3.5 : 2.8;
        if (exp.age < 0.12) {
          const t = exp.age / 0.12;
          exp.fireball.scale.setScalar(0.3 + (maxScale - 0.3) * t);
          (exp.fireball.material as THREE.MeshBasicMaterial).opacity = 0.95;
        } else if (exp.age < 0.35) {
          const t = (exp.age - 0.12) / 0.23;
          exp.fireball.scale.setScalar(maxScale + t * 0.4);
          (exp.fireball.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1.0 - t);
        } else {
          this.root.remove(exp.fireball);
          (exp.fireball.material as THREE.Material).dispose();
          exp.fireball = undefined;
        }
      }

      // 3. Shockwave ring expansion and fade (0.22s)
      if (exp.shockwave) {
        const t = Math.min(1.0, exp.age / 0.22);
        const radiusScale = 1.0 + t * 7.0;
        exp.shockwave.scale.set(radiusScale, radiusScale, 1.0);
        (exp.shockwave.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1.0 - t);
        if (t >= 1.0) {
          this.root.remove(exp.shockwave);
          (exp.shockwave.material as THREE.Material).dispose();
          exp.shockwave = undefined;
        }
      }

      // 4. Ground scorch mark fade (fades over 6s)
      if (exp.scorch) {
        if (exp.age > 3.0) {
          const t = Math.min(1.0, (exp.age - 3.0) / 3.0);
          (exp.scorch.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1.0 - t);
        }
        if (exp.age >= 6.0) {
          this.root.remove(exp.scorch);
          (exp.scorch.material as THREE.Material).dispose();
          exp.scorch = undefined;
        }
      }

      // 5. Smoke puffs billow and billboard towards camera
      for (let s = exp.smoke.length - 1; s >= 0; s--) {
        const puff = exp.smoke[s]!;
        puff.age += dt;
        const t = Math.min(1.0, puff.age / puff.lifetime);

        puff.mesh.position.addScaledVector(puff.velocity, dt);
        puff.velocity.y *= 0.96; // drag

        const currentScale = puff.initialScale + (puff.targetScale - puff.initialScale) * Math.sqrt(t);
        puff.mesh.scale.setScalar(currentScale);

        // Billboarding
        if (camera) {
          puff.mesh.quaternion.copy(camera.quaternion);
        }

        const opacity = t < 0.2 ? (t / 0.2) * 0.65 : 0.65 * (1.0 - (t - 0.2) / 0.8);
        (puff.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, opacity);

        if (t >= 1.0) {
          this.root.remove(puff.mesh);
          (puff.mesh.material as THREE.Material).dispose();
          exp.smoke.splice(s, 1);
        }
      }

      // 6. Flying sparks / shrapnel particles
      if (exp.sparksMesh) {
        let aliveSparks = 0;
        for (let sp = 0; sp < exp.sparks.length; sp++) {
          const spark = exp.sparks[sp]!;
          spark.age += dt;
          if (spark.age < spark.lifetime) {
            spark.velocity.y -= 14.0 * dt; // Gravity
            spark.position.addScaledVector(spark.velocity, dt);

            this.dummy.position.copy(spark.position);
            // Orient along velocity vector
            if (spark.velocity.lengthSq() > 0.1) {
              this.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), spark.velocity.clone().normalize());
            }
            const sparkFrac = 1.0 - spark.age / spark.lifetime;
            this.dummy.scale.set(sparkFrac, sparkFrac, sparkFrac * 2.0);
            this.dummy.updateMatrix();
            exp.sparksMesh.setMatrixAt(sp, this.dummy.matrix);
            aliveSparks++;
          } else {
            this.dummy.scale.set(0, 0, 0);
            this.dummy.updateMatrix();
            exp.sparksMesh.setMatrixAt(sp, this.dummy.matrix);
          }
        }
        exp.sparksMesh.instanceMatrix.needsUpdate = true;

        if (aliveSparks === 0 && exp.age > 1.0) {
          this.root.remove(exp.sparksMesh);
          (exp.sparksMesh.material as THREE.Material).dispose();
          exp.sparksMesh = undefined;
        }
      }

      // 7. Cleanup active explosion entry when all parts are done
      if (!exp.fireball && !exp.shockwave && !exp.sparksMesh && exp.smoke.length === 0 && (!exp.scorch || exp.age >= 6.0)) {
        if (exp.scorch) {
          this.root.remove(exp.scorch);
          (exp.scorch.material as THREE.Material).dispose();
        }
        this.active.splice(i, 1);
      }
    }
  }

  /**
   * Clear all active visual effects and free GPU resources.
   */
  clear(): void {
    for (const exp of this.active) {
      if (exp.fireball) {
        this.root.remove(exp.fireball);
        (exp.fireball.material as THREE.Material).dispose();
      }
      if (exp.shockwave) {
        this.root.remove(exp.shockwave);
        (exp.shockwave.material as THREE.Material).dispose();
      }
      if (exp.scorch) {
        this.root.remove(exp.scorch);
        (exp.scorch.material as THREE.Material).dispose();
      }
      if (exp.sparksMesh) {
        this.root.remove(exp.sparksMesh);
        (exp.sparksMesh.material as THREE.Material).dispose();
      }
      for (const puff of exp.smoke) {
        this.root.remove(puff.mesh);
        (puff.mesh.material as THREE.Material).dispose();
      }
    }
    this.active.length = 0;
  }
}
