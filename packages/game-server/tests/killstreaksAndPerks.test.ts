import "reflect-metadata";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ResolvedWorld } from "@3d/shared/dsl/resolved.js";
import { catalogueViewOf } from "@3d/shared/game/catalogueView.js";
import { defaultGametype } from "@3d/shared/game/gametypes/default.js";
import type { InputMessage } from "@3d/shared/net/messages/input.js";
import { idleInput } from "@3d/shared/sim/input.js";
import type { CapsuleWorld } from "@3d/shared/sim/capsule.js";
import type { Loadout } from "@3d/shared/sim/loadout.js";
import { CATALOG_VERSION, WeaponRegistry, type WeaponEntry } from "@3d/shared/sim/weaponRegistry.js";
import { weaponDef } from "@3d/shared/testing/weaponDef.js";
import type { BodyView, LoadedBody } from "../src/bodies.js";
import { Match } from "../src/match/match.js";
import type { Member } from "../src/match/roster.js";
import type { Damage } from "../src/match/damage.js";

const TICK_RATE = 60;
const GAME = "iw5";

const ground = {
  ready: true,
  resolveCapsule(
    position: { x: number; y: number; z: number },
    _r: number,
    _h: number,
    out?: { position: { x: number; y: number; z: number }; grounded: boolean; normal: { x: number; y: number; z: number } },
  ) {
    const result = out ?? { position: { x: 0, y: 0, z: 0 }, grounded: false, normal: { x: 0, y: 0, z: 0 } };
    result.position.x = position.x;
    result.position.y = Math.max(position.y, 0);
    result.position.z = position.z;
    result.grounded = position.y <= 0;
    result.normal.x = 0;
    result.normal.y = result.grounded ? 1 : 0;
    result.normal.z = 0;
    return result;
  },
  overlapsCapsule: (position: { y: number }) => position.y < 0,
  overlapsSweep: (from: { y: number }, to: { y: number }, radius: number) => Math.min(from.y, to.y) < radius,
  groundBelow: (from: { y: number }, distance: number, normal?: { x: number; y: number; z: number }) => {
    if (from.y < 0 || from.y - distance > 0) {
      return null;
    }
    if (normal) {
      normal.x = 0;
      normal.y = 1;
      normal.z = 0;
    }
    return 0;
  },
  surfaceAt: () => null,
  traceRay: (from: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, dist: number) => {
    if (dir.y < -0.0001 && from.y >= -0.05) {
      const hitDist = Math.max(0, from.y) / -dir.y;
      if (hitDist <= dist) {
        return { distance: hitDist, normal: { x: 0, y: 1, z: 0 }, kind: "map" as const, surface: "default" as const };
      }
    }
    return null;
  },
};

function world(): ResolvedWorld {
  return {
    game: GAME,
    spawn: { position: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: -1 } },
    spawnPoints: [
      { position: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: -1 }, teams: [0] },
      { position: { x: 0, y: 0, z: 5 }, look: { x: 0, y: 0, z: -1 }, teams: [1] },
    ],
    triggers: [],
    mantles: [],
    ladders: [],
    points: [],
    solids: [],
    rooms: [],
    topLevelObjects: [],
  } as unknown as ResolvedWorld;
}

function registry(): WeaponRegistry {
  const entries: WeaponEntry[] = [
    {
      id: "m4_mp",
      game: GAME,
      slot: "primary",
      class: "rifle",
      def: weaponDef({ clipSize: 30 }),
      attachments: [],
    },
  ];
  return new WeaponRegistry(entries);
}

function stubBodies(): BodyView {
  const root = new THREE.Object3D();
  const body = {
    id: "dummy",
    game: GAME,
    rig: { root },
    poser: { update: () => undefined },
    boxes: { trace: () => null },
  } as unknown as LoadedBody;
  return { get: () => body };
}

function loadout(over: Partial<Loadout> = {}): Loadout {
  return {
    name: "Assault",
    game: GAME,
    primary: { weapon: "m4_mp", attachments: [] },
    secondary: { weapon: null, attachments: [] },
    perks: {
      perk1: "sleight_of_hand",
      perk2: "quickdraw",
      perk3: "stalker",
    },
    strikePackage: {
      package: "assault",
      streaks: ["uav", "predator_missile", "sentry_gun"],
    },
    ...over,
  };
}

interface MatchInternals {
  roster: { get(id: string): Member | undefined };
  damage: Damage;
}

function internals(match: Match): MatchInternals {
  return match as unknown as MatchInternals;
}

function getMember(match: Match, id: string): Member {
  const member = internals(match).roster.get(id);
  if (!member) {
    throw new Error(`Member ${id} not found in roster`);
  }
  return member;
}

function makeMatch(): Match {
  const weapons = registry();
  return new Match(ground as unknown as CapsuleWorld, world(), TICK_RATE, 16, weapons, {
    map: "dome",
    gametype: defaultGametype,
    catalogue: catalogueViewOf({ version: CATALOG_VERSION }, weapons),
    bodies: stubBodies(),
  });
}

describe("MW3 Strike Packages & Killstreaks", () => {
  it("earns Assault killstreaks on consecutive kills and resets streak progress on death", () => {
    const match = makeMatch();
    match.join("killer", loadout({ strikePackage: { package: "assault", streaks: ["uav", "predator_missile", "sentry_gun"] } }));
    match.join("victim", loadout(), "", 0, 1);

    const killer = getMember(match, "killer");
    const victim = getMember(match, "victim");

    expect(killer.streaks.ready).toEqual([false, false, false]);

    // Kill 1 & 2
    match.killstreaks.onKill(killer, victim);
    match.killstreaks.onKill(killer, victim);
    expect(killer.streaks.killsThisLife).toBe(2);
    expect(killer.streaks.ready[0]).toBe(false);

    // Kill 3: UAV earned
    match.killstreaks.onKill(killer, victim);
    expect(killer.streaks.killsThisLife).toBe(3);
    expect(killer.streaks.ready[0]).toBe(true);
    expect(killer.streaks.ready[1]).toBe(false);

    // Kill 4 & 5: Predator & Sentry earned
    match.killstreaks.onKill(killer, victim);
    match.killstreaks.onKill(killer, victim);
    expect(killer.streaks.killsThisLife).toBe(5);
    expect(killer.streaks.ready).toEqual([true, true, true]);

    // Death resets killsThisLife, but ready streaks remain in reserve
    match.killstreaks.onDeath(killer);
    expect(killer.streaks.killsThisLife).toBe(0);
    expect(killer.streaks.ready).toEqual([true, true, true]);
  });

  it("earns a streak once per life: a used UAV does not come back on the next kill", () => {
    const match = makeMatch();
    match.join("killer", loadout({ strikePackage: { package: "assault", streaks: ["uav", "predator_missile", "sentry_gun"] } }));
    match.join("victim", loadout(), "", 0, 1);
    const killer = getMember(match, "killer");
    const victim = getMember(match, "victim");

    for (let i = 0; i < 3; i++) {
      match.killstreaks.onKill(killer, victim);
    }
    expect(match.killstreaks.activate(killer)).toBe(true);
    expect(killer.streaks.ready[0]).toBe(false);
    match.killstreaks.onKill(killer, victim);
    expect(killer.streaks.ready[0]).toBe(false);

    // A death starts the count again, and three more earn it again.
    match.killstreaks.onDeath(killer);
    for (let i = 0; i < 3; i++) {
      match.killstreaks.onKill(killer, victim);
    }
    expect(killer.streaks.ready[0]).toBe(true);
  });

  it("tells each player their own package on every snapshot, as the class chose it", () => {
    const match = makeMatch();
    match.join(
      "support",
      loadout({
        perks: { perk1: "sleight_of_hand", perk2: "hardline", perk3: "stalker" },
        strikePackage: { package: "support", streaks: ["uav", "sam_turret", "ac130"] },
      }),
    );
    match.join("victim", loadout(), "", 0, 1);
    match.killstreaks.onKill(getMember(match, "support"), getMember(match, "victim"));
    const { players } = match.step();
    expect(match.snapshotFor("support", players).streaks).toEqual({
      package: "support",
      streaks: ["uav", "sam_turret", "ac130"],
      ready: [false, false, false],
      progress: 1,
      hardline: true,
    });
    expect(match.snapshotFor("victim", players).streaks?.package).toBe("assault");
    expect(match.snapshotFor("nobody", players).streaks).toBeNull();
  });

  it("applies Hardline perk discount (-1 kill requirement)", () => {
    const match = makeMatch();
    match.join(
      "hardlineUser",
      loadout({
        perks: { perk1: "sleight_of_hand", perk2: "hardline", perk3: "stalker" },
        strikePackage: { package: "assault", streaks: ["uav", "predator_missile", "sentry_gun"] },
      }),
    );
    match.join("victim", loadout(), "", 0, 1);

    const user = getMember(match, "hardlineUser");
    const victim = getMember(match, "victim");

    // UAV requires 2 kills instead of 3 with Hardline
    match.killstreaks.onKill(user, victim);
    match.killstreaks.onKill(user, victim);
    expect(user.streaks.ready[0]).toBe(true); // UAV ready at 2 kills!
  });

  it("persists Support strike package points across death", () => {
    const match = makeMatch();
    match.join(
      "supportUser",
      loadout({
        strikePackage: { package: "support", streaks: ["uav", "sam_turret", "sentry_gun"] },
      }),
    );
    match.join("victim", loadout(), "", 0, 1);

    const user = getMember(match, "supportUser");
    const victim = getMember(match, "victim");

    // 2 kills
    match.killstreaks.onKill(user, victim);
    match.killstreaks.onKill(user, victim);
    expect(user.streaks.totalPoints).toBe(2);

    // Dies: killsThisLife resets, but totalPoints does NOT reset
    match.killstreaks.onDeath(user);
    expect(user.streaks.killsThisLife).toBe(0);
    expect(user.streaks.totalPoints).toBe(2);

    // 2 more kills (total 4) -> Support UAV earned (cost: 4)
    match.killstreaks.onKill(user, victim);
    match.killstreaks.onKill(user, victim);
    expect(user.streaks.totalPoints).toBe(4);
    expect(user.streaks.ready[0]).toBe(true);
  });

  it("unlocks bonus perks for Specialist strike package", () => {
    const match = makeMatch();
    match.join(
      "specialistUser",
      loadout({
        strikePackage: { package: "specialist", streaks: ["uav", "predator_missile", "sentry_gun"] },
      }),
    );
    match.join("victim", loadout(), "", 0, 1);

    const user = getMember(match, "specialistUser");
    const victim = getMember(match, "victim");

    // 2 kills: scavenger unlocked
    match.killstreaks.onKill(user, victim);
    match.killstreaks.onKill(user, victim);
    expect(user.perks.bonusPerks.has("scavenger")).toBe(true);

    // 4 kills: assassin unlocked
    match.killstreaks.onKill(user, victim);
    match.killstreaks.onKill(user, victim);
    expect(user.perks.bonusPerks.has("assassin")).toBe(true);

    // 8 kills: All-Perks bonus
    for (let i = 0; i < 4; i++) {
      match.killstreaks.onKill(user, victim);
    }
    expect(user.perks.bonusPerks.has("blind_eye")).toBe(true);
    expect(user.perks.bonusPerks.has("blast_shield")).toBe(true);

    // On death: specialist bonus perks reset
    match.killstreaks.onDeath(user);
    expect(user.perks.bonusPerks.size).toBe(0);
  });

  it("activates UAV and reveals enemies without Assassin perk on radar", () => {
    const match = makeMatch();
    match.join("pilot", loadout(), "", 0, 0);
    match.join("enemyNormal", loadout({ perks: { perk1: "sleight_of_hand", perk2: "quickdraw", perk3: "stalker" } }), "", 0, 1);
    match.join("enemyAssassin", loadout({ perks: { perk1: "sleight_of_hand", perk2: "assassin", perk3: "stalker" } }), "", 0, 1);

    const pilot = getMember(match, "pilot");
    pilot.streaks.ready[0] = true; // UAV ready

    // Pilot activates UAV via killstreak input message
    const msg: InputMessage = {
      seq: 1,
      dt: 1 / 60,
      input: { ...idleInput(0, 0), killstreak: true },
      claim: { x: 0, y: 0, z: 0 },
      drawn: { tick: 0, frac: 0 },
    };
    match.receive("pilot", msg);
    const { players } = match.step();
    expect(pilot.streaks.ready[0]).toBe(false);

    // The pilot's own snapshot flags the normal enemy and not the Assassin, nor themself.
    const shown = (viewer: string) => players.filter((_, i) => match.snapshotFor(viewer, players).revealed[i]).map((p) => p.id);
    expect(shown("pilot")).toEqual(["enemyNormal"]);
    // A UAV is its side's, not the other side's.
    expect(match.snapshotFor("enemyNormal", players).revealed).toEqual([]);
  });

  it("deploys Sentry Gun which targets enemies and ignores Blind Eye users", () => {
    const match = makeMatch();
    match.join("engineer", loadout(), "", 0, 0);
    match.join("targetBlindEye", loadout({ perks: { perk1: "blind_eye", perk2: "quickdraw", perk3: "stalker" } }), "", 0, 1);
    match.join("targetNormal", loadout({ perks: { perk1: "sleight_of_hand", perk2: "quickdraw", perk3: "stalker" } }), "", 0, 1);

    const engineer = getMember(match, "engineer");
    engineer.streaks.ready[2] = true; // Sentry ready (slot 2)

    // Position targets in front of engineer
    match.place("engineer", { x: 0, y: 0, z: 0 }, 0, 0);
    match.place("targetBlindEye", { x: 0, y: 0, z: -5 }, 0, 0);
    match.place("targetNormal", { x: 1, y: 0, z: -5 }, 0, 0);

    // Activate Sentry Gun
    engineer.streaks.ready = [false, false, true];
    match.killstreaks.activate(engineer);

    // Step match to simulate sentry targeting & firing
    const normalEnemy = getMember(match, "targetNormal");
    const blindEyeEnemy = getMember(match, "targetBlindEye");

    const hpNormalBefore = normalEnemy.player.health;
    const hpBlindBefore = blindEyeEnemy.player.health;

    // Advance 0.2s of simulation
    for (let i = 0; i < 15; i++) {
      match.step();
    }

    // Normal enemy was targeted and took sentry damage
    expect(normalEnemy.player.health).toBeLessThan(hpNormalBefore);

    // Blind Eye enemy was completely ignored by Sentry Gun
    expect(blindEyeEnemy.player.health).toBe(hpBlindBefore);
  });

  it("caps explosive damage to 65 for players using Blast Shield", () => {
    const match = makeMatch();
    match.join("victimNormal", loadout({ perks: { perk1: "sleight_of_hand", perk2: "quickdraw", perk3: "stalker" } }), "", 0, 0);
    match.join("victimShield", loadout({ perks: { perk1: "sleight_of_hand", perk2: "blast_shield", perk3: "stalker" } }), "", 0, 0);

    const normal = getMember(match, "victimNormal");
    const shielded = getMember(match, "victimShield");

    expect(normal.player.health).toBe(100);
    expect(shielded.player.health).toBe(100);

    // 200 explosion damage dealt to normal player -> lethal
    internals(match).damage.hurt({
      id: "victimNormal",
      amount: 200,
      by: null,
      cause: "explosion",
    });
    match.step();
    expect(normal.player.dead).toBe(true);

    // 200 explosion damage dealt to Blast Shield player -> capped to 65, survives with 35 HP
    internals(match).damage.hurt({
      id: "victimShield",
      amount: 200,
      by: null,
      cause: "explosion",
    });
    match.step();
    expect(shielded.player.dead).toBe(false);
    expect(shielded.player.health).toBe(35);
  });

  it("spawns Predator Missile descending from sky and detonates with blast radius", () => {
    const match = makeMatch();
    match.join("operator", loadout(), "", 0, 0);
    match.join("enemyInBlast", loadout(), "", 0, 1);
    match.join("enemyFarAway", loadout(), "", 0, 1);

    const op = getMember(match, "operator");
    op.streaks.ready = [false, true, false]; // Predator ready (slot 1)

    // Position operator and enemies
    match.place("operator", { x: 0, y: 0, z: 0 }, 0, 0);
    match.place("enemyInBlast", { x: 2, y: 0, z: -15 }, 0, 0); // ~2m from impact (center is z: -15)
    match.place("enemyFarAway", { x: 50, y: 0, z: -15 }, 0, 0); // 50m away (beyond 12m radius)

    const enemyClose = getMember(match, "enemyInBlast");
    const enemyFar = getMember(match, "enemyFarAway");

    // Activate Predator missile
    const activated = match.killstreaks.activate(op);
    expect(activated).toBe(true);

    // Step match until missile hits ground (speed is 40 m/s from y: 100 -> ~2.5s)
    for (let i = 0; i < 200; i++) {
      match.step();
      if (enemyClose.player.dead) {
        break;
      }
    }

    // Enemy in blast radius took lethal damage
    expect(enemyClose.player.dead).toBe(true);

    // Enemy far away took no damage
    expect(enemyFar.player.health).toBe(100);
    expect(enemyFar.player.dead).toBe(false);
  });
});
