// The weapon under a gun's barrel, as MW3 makes it: a second weapon on the same
// gun, switched to with one clip (`altRaise`), carrying a reserve that never
// refills — two grenades for an M203 — and changing the shot itself, from a trace
// to a round that flies.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CollisionWorld } from "../src/collision/world.js";
import { Player } from "../src/sim/player.js";
import { idleInput, type PlayerInput } from "../src/sim/input.js";
import { resolveAlt, WeaponRegistry, weaponKey, type WeaponEntry } from "../src/sim/weaponRegistry.js";
import { weaponDef } from "../testing/weaponDef.js";

const key = (id: string) => weaponKey({ game: "iw5", id });

function floor(): CollisionWorld {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(40, 1, 40));
  mesh.position.set(0, -0.5, 0);
  mesh.userData.collide = true;
  root.add(mesh);
  const collision = new CollisionWorld();
  collision.rebuild(root);
  return collision;
}

const LAUNCHER = {
  model: "projectile_m203grenade",
  speed: 2400,
  speedUp: 10,
  activateDistance: 300,
  lifetime: 30,
  explosionRadius: 300,
  explosionInner: 110,
  explosionOuter: 25,
  impactExplode: true,
};

const rifle = weaponDef({ weapon: "m4", clipSize: 30, damage: { max: 42, min: 20, maxRange: 800, minRange: 1400 } });
const still = (duration: number) => ({ duration, looped: false, notes: [] });

/** An M4 offering an M203, as the exporter writes MW3's `gl`: its own magazine, clips, sound and round. */
const m4: WeaponEntry = {
  id: "m4",
  game: "iw5",
  slot: "primary",
  class: "rifle",
  // The launcher's clips live in the gun's own file, as the exporter writes them.
  def: {
    ...rifle,
    clips: { ...rifle.clips, grenade_idle: still(1), grenade_fire: still(0.3), grenade_reload: still(2.6), bullet_2_grenade: still(0.7) },
  },
  attachments: [
    { id: "silencer", overrides: { damage: { max: 31.5, min: 15 } } },
    {
      id: "gl",
      type: "underbarrel",
      overrides: { roles: { idle: "m203_idle" } },
      alt: {
        clipSize: 1,
        stock: 1,
        fireType: "Single Shot",
        weaponType: "projectile",
        projectile: LAUNCHER,
        damage: { max: 120, min: 120 },
        // `grenade_ads_up` is one of MW3's still-frame clips the exporter never wrote.
        roles: { idle: "grenade_idle", fire: "grenade_fire", reload: "grenade_reload", altRaise: "bullet_2_grenade", adsUp: "grenade_ads_up" },
        times: { fire: 0.3, reload: 2.6, altRaise: 0.7 },
        sounds: { fire: "weap_m203_fire_npc" },
      },
    },
  ],
};

const registry = new WeaponRegistry([m4]);

function run(player: Player, seconds: number, input: PlayerInput = idleInput(0, 0)): Player {
  for (let t = 0; t < seconds; t += 1 / 60) {
    player.step(input, 1 / 60);
  }
  return player;
}

function press(player: Player, what: Partial<PlayerInput>): void {
  player.step({ ...idleInput(0, 0), ...what }, 1 / 60);
}

function launcherM4(): Player {
  const player = new Player(floor(), registry);
  player.equipWeapons({ weapon: key("m4"), attachments: ["silencer", "gl"] }, null);
  player.weapon!.ready();
  return player;
}

describe("an underbarrel weapon", () => {
  it("is laid over the gun as fitted, keeping what the launcher leaves unsaid", () => {
    const alt = resolveAlt(m4, [0, 1])!;
    expect(alt.stock).toBe(1);
    expect(alt.def.clipSize).toBe(1);
    expect(alt.def.projectile).toEqual(LAUNCHER);
    // Its own clips and nothing of the rifle's — and none the file lacks, which would be a rig nobody can build.
    expect(alt.def.roles).toEqual({ idle: "grenade_idle", fire: "grenade_fire", reload: "grenade_reload", altRaise: "bullet_2_grenade" });
    expect(alt.def.sounds?.fire).toBe("weap_m203_fire_npc");
    // A silencer is the rifle's, not the launcher's.
    expect(alt.def.silenced).toBe(false);
    expect(resolveAlt(m4, [0])).toBeNull();
  });

  it("is switched to with one press, and back with another", () => {
    const player = launcherM4();
    expect(player.hasAlt).toBe(true);
    press(player, { alt: true });
    expect(player.altHeld).toBe(true);
    expect(player.weapon!.def.clipSize).toBe(1);
    expect(player.weapon!.data.clip?.role).toBe("altRaise");
    run(player, 1);
    expect(player.weapon!.data.state).toBe("idle");

    press(player, { alt: true });
    expect(player.altHeld).toBe(false);
    expect(player.weapon!.def.clipSize).toBe(30);
  });

  it("carries two grenades in all, and never reloads a third", () => {
    const player = launcherM4();
    press(player, { alt: true });
    run(player, 1);
    press(player, { fire: true });
    run(player, 0.5);
    expect(player.weapon!.data.ammo).toBe(0);
    // The game reloads an emptied launcher by itself, out of its one grenade of stock.
    run(player, 3);
    expect(player.weapon!.data.ammo).toBe(1);
    expect(player.weapon!.stock).toBe(0);

    press(player, { fire: true });
    run(player, 3);
    expect(player.weapon!.data.ammo).toBe(0);
    expect(player.weapon!.data.state).toBe("idle");
    press(player, { reload: true });
    run(player, 3);
    expect(player.weapon!.data.ammo).toBe(0);
  });

  it("keeps each half's magazine across a switch, on the wire as in hand", () => {
    const player = launcherM4();
    press(player, { fire: true });
    run(player, 0.3);
    const rifle = player.weapon!.data.ammo;
    expect(rifle).toBeLessThan(30);
    press(player, { alt: true });
    run(player, 1);
    press(player, { fire: true });
    run(player, 0.4);

    const state = player.snapshot();
    expect(state.alt).toEqual({ held: true, ammo: rifle, stock: 1 });

    // A fresh copy of the same player, rebuilt from nothing but that state.
    const peer = new Player(floor(), registry);
    peer.restore(state);
    expect(peer.altHeld).toBe(true);
    expect(peer.snapshot().alt).toEqual(state.alt);
    press(peer, { alt: true });
    expect(peer.weapon!.data.ammo).toBe(rifle);
  });

  it("switches mid-reload, cancelling it as a weapon change does, but never mid-shot or mid-draw", () => {
    const player = launcherM4();
    press(player, { fire: true });
    run(player, 0.3);
    const left = player.weapon!.data.ammo;
    press(player, { reload: true });
    press(player, { alt: true });
    expect(player.altHeld).toBe(true);
    // Its own draw is not over: a second press waits for it.
    press(player, { alt: true });
    expect(player.altHeld).toBe(true);
    run(player, 1);
    press(player, { alt: true });
    expect(player.weapon!.data.ammo).toBe(left);
  });

  it("of a hybrid sight is the same gun on the same magazine, aimed through the other optic", () => {
    const hybrid: WeaponEntry = {
      ...m4,
      attachments: [
        {
          id: "hybrid",
          type: "underbarrel",
          overrides: { adsZoomFov: 30, roles: { altRaise: "bullet_2_grenade" } },
          alt: { shareAmmo: true, stock: 0, adsZoomFov: 55, roles: { altRaise: "bullet_2_grenade" } },
        },
      ],
    };
    const player = new Player(floor(), new WeaponRegistry([hybrid]));
    player.equipWeapons({ weapon: key("m4"), attachments: ["hybrid"] }, null);
    player.weapon!.ready();
    expect(player.weapon!.def.adsZoomFov).toBe(30);
    press(player, { fire: true });
    run(player, 0.3);
    const left = player.weapon!.data.ammo;

    press(player, { alt: true });
    expect(player.weapon!.def.adsZoomFov).toBe(55);
    expect(player.weapon!.def.clipSize).toBe(30);
    expect(player.weapon!.data.ammo).toBe(left);
    // No reserve to run out: it reloads as the gun does.
    expect(player.weapon!.stock).toBeNull();
  });
});
