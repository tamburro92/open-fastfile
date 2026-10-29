import "reflect-metadata";
import { THROW_TIMES } from "@3d/shared/game/equipment.js";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ResolvedWorld } from "@3d/shared/dsl/resolved.js";
import { catalogueViewOf } from "@3d/shared/game/catalogueView.js";
import type { CastChoice } from "@3d/shared/game/cast.js";
import { defaultGametype } from "@3d/shared/game/gametypes/default.js";
import type { GametypeDecl } from "@3d/shared/game/gametypes/declaration.js";
import type { Script } from "@3d/shared/game/hooks.js";
import type { PlayerId } from "@3d/shared/net/messages/fields.js";
import type { GameEvent } from "@3d/shared/net/messages/events.js";
import type { InputMessage } from "@3d/shared/net/messages/input.js";
import type { PlayerSnapshot } from "@3d/shared/net/messages/snapshot.js";
import { idleInput, type PlayerInput } from "@3d/shared/sim/input.js";
import type { Loadout } from "@3d/shared/sim/loadout.js";
import { CATALOG_VERSION, WeaponRegistry, type WeaponEntry } from "@3d/shared/sim/weaponRegistry.js";
import { weaponDef } from "@3d/shared/testing/weaponDef.js";
import type { BodyView, LoadedBody } from "../src/bodies.js";
import { Match } from "../src/match/match.js";

const TICK_RATE = 60;
const DT = 1 / TICK_RATE;
const GAME = "iw5";
const MAP = "dome-mw3";

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
      { position: { x: 0, y: 0, z: -1.2 }, look: { x: 0, y: 0, z: 1 }, teams: [1] },
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
      // MW3's `gl`, as the exporter writes it: an M203 with its own magazine and round.
      attachments: [
        {
          id: "gl",
          type: "underbarrel",
          alt: {
            clipSize: 1,
            stock: 1,
            fireType: "Single Shot",
            weaponType: "projectile",
            damage: { max: 120, min: 120 },
            roles: { idle: "idle", fire: "fire", reload: "reload", raise: "pullout" },
            times: { fire: 0.3, reload: 2.6 },
            projectile: {
              model: "projectile_m203grenade",
              speed: 2400,
              speedUp: 10,
              activateDistance: 300,
              lifetime: 30,
              explosionRadius: 300,
              explosionInner: 110,
              explosionOuter: 25,
              impactExplode: true,
            },
          },
        },
      ],
    },
  ];
  return new WeaponRegistry(entries);
}

const CAST: CastChoice = {
  characters: [{ id: "dummy", body: { kind: "characters", game: GAME, id: "dummy", file: "dummy.glb" } }],
  animations: { kind: "animations", game: GAME, id: "clips", file: "clips.glb" },
  hands: { kind: "hands", game: GAME, id: "hands", file: "hands.glb" },
  defaultWeapon: null,
};

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
    game: "iw5",
    primary: { weapon: "m4_mp", attachments: [] },
    secondary: { weapon: null, attachments: [] },
    lethal: "frag_grenade_mp",
    tactical: "flash_grenade_mp",
    ...over,
  };
}

function setupMatch(options: { gametype?: GametypeDecl; friendlyFire?: boolean } = {}) {
  const script: Script = {
    id: "test",
    server: {
      combatRules: () => ({
        maxHealth: 100,
        damageScale: 1.0,
        friendlyFire: options.friendlyFire ?? false,
      }),
    },
    client: { cast: () => CAST },
  };

  const match = new Match(ground, world(), TICK_RATE, 8, registry(), {
    map: MAP,
    gametype: options.gametype ?? defaultGametype,
    catalogue: catalogueViewOf({ version: CATALOG_VERSION }, new WeaponRegistry([])),
    bodies: stubBodies(),
    scripts: [script],
  });

  let seq = 0;
  const tails = new Map<PlayerId, GameEvent[]>();
  let latestPlayers: PlayerSnapshot[] = [];

  const stepTick = (inputs: Record<PlayerId, PlayerInput>) => {
    for (const [id, input] of Object.entries(inputs)) {
      const msg: InputMessage = {
        seq: ++seq,
        dt: DT,
        input,
        claim: { x: 0, y: 0, z: 0 },
        drawn: { tick: 0, frac: 0 },
      };
      match.receive(id, msg);
    }
    const snapshot = match.step();
    latestPlayers = snapshot.players;
    for (const player of snapshot.players) {
      tails.set(player.id, match.snapshotFor(player.id, snapshot.players).events);
    }
    return snapshot;
  };

  return {
    match,
    stepTick,
    getLatest: (id: PlayerId) => latestPlayers.find((p) => p.id === id),
    getEvents: (id: PlayerId) => tails.get(id) ?? [],
  };
}

describe("MW3 Melee Combat", () => {
  it("delivers authentic 135 damage 1-hit kill at close range with hit marker and kill feed", () => {
    const sim = setupMatch();
    sim.match.join("attacker", loadout());
    sim.match.join("victim", loadout());

    // Attacker at (0, 0, 0) facing -Z (yaw = 0)
    // Victim at (0, 0, -1.2) - inside 2.0m melee range
    sim.match.place("attacker", { x: 0, y: 0, z: 0 }, 0, 0);
    sim.match.place("victim", { x: 0, y: 0, z: -1.2 }, Math.PI, 0);

    // Initial tick to stabilize placement
    sim.stepTick({
      attacker: idleInput(0, 0),
      victim: idleInput(Math.PI, 0),
    });

    const victimBefore = sim.getLatest("victim");
    expect(victimBefore?.state.health).toBe(100);

    // Attacker presses melee (KeyE/KeyV)
    sim.stepTick({
      attacker: { ...idleInput(0, 0), melee: true },
      victim: idleInput(Math.PI, 0),
    });

    const victimAfter = sim.getLatest("victim");
    expect(victimAfter?.state.dead).toBe(true);
    expect(victimAfter?.state.health).toBe(0);

    // Attacker receives lethal hit marker
    const events = sim.getEvents("attacker");
    const hitMarker = events.find((e) => e.kind === "hit");
    expect(hitMarker).toBeDefined();
    if (hitMarker && hitMarker.kind === "hit") {
      expect(hitMarker.lethal).toBe(true);
    }

    // Victim kill event recorded
    const deathEvent = events.find((e) => e.kind === "death");
    expect(deathEvent).toBeDefined();
    if (deathEvent && deathEvent.kind === "death") {
      expect(deathEvent.victim).toBe("victim");
      expect(deathEvent.killer).toBe("attacker");
      expect(deathEvent.cause).toBe("melee");
    }
  });

  it("enforces 0.66s melee cooldown", () => {
    const sim = setupMatch({ friendlyFire: true });
    sim.match.join("attacker", loadout());
    sim.match.join("victim1", loadout());
    sim.match.join("victim2", loadout());

    sim.match.place("attacker", { x: 0, y: 0, z: 0 }, 0, 0);
    sim.match.place("victim1", { x: 0, y: 0, z: -1.2 }, 0, 0);
    sim.match.place("victim2", { x: 0.5, y: 0, z: -1.2 }, 0, 0);

    // First melee kills victim1
    sim.stepTick({
      attacker: { ...idleInput(0, 0), melee: true },
      victim1: idleInput(0, 0),
      victim2: idleInput(0, 0),
    });
    expect(sim.getLatest("victim1")?.state.dead).toBe(true);

    // Next tick (16ms later < 0.66s), attacker tries to melee victim2
    sim.stepTick({
      attacker: { ...idleInput(0, 0), melee: true },
      victim1: idleInput(0, 0),
      victim2: idleInput(0, 0),
    });
    // Cooldown prevents second melee attack!
    expect(sim.getLatest("victim2")?.state.health).toBe(100);

    // Advance 40 ticks (~0.67s > 0.66s)
    for (let i = 0; i < 40; i++) {
      sim.stepTick({
        attacker: idleInput(0, 0),
        victim1: idleInput(0, 0),
        victim2: idleInput(0, 0),
      });
    }

    // Now second melee succeeds
    sim.stepTick({
      attacker: { ...idleInput(0, 0), melee: true },
      victim1: idleInput(0, 0),
      victim2: idleInput(0, 0),
    });
    expect(sim.getLatest("victim2")?.state.dead).toBe(true);
  });

  it("misses when target is beyond 2.0 meters reach", () => {
    const sim = setupMatch();
    sim.match.join("attacker", loadout());
    sim.match.join("victim", loadout());

    // Victim at 2.5m (beyond 2.0m reach)
    sim.match.place("attacker", { x: 0, y: 0, z: 0 }, 0, 0);
    sim.match.place("victim", { x: 0, y: 0, z: -2.5 }, 0, 0);

    sim.stepTick({
      attacker: { ...idleInput(0, 0), melee: true },
      victim: idleInput(0, 0),
    });

    expect(sim.getLatest("victim")?.state.health).toBe(100);
    expect(sim.getLatest("victim")?.state.dead).toBe(false);

    // Miss announces melee_swing rather than melee_hit
    const events = sim.getEvents("attacker");
    const swing = events.find((e) => e.kind === "announce" && e.what === "melee_swing");
    expect(swing).toBeDefined();
  });
});

type Sim = ReturnType<typeof setupMatch>;
type Inputs = Parameters<Sim["stepTick"]>[0];

/** Until the pin is out and the grenade has left the hand. */
function waitForPin(sim: Sim, inputs: Inputs): void {
  for (let i = 0; i < Math.ceil(THROW_TIMES.frag.holdFire * TICK_RATE); i++) {
    sim.stepTick(inputs);
  }
}

/** Until the whole throw is over, the slowest arm (the flashbang's) included. */
function waitForThrow(sim: Sim, inputs: Inputs): void {
  for (let i = 0; i < Math.ceil((THROW_TIMES.flashbang.holdFire + THROW_TIMES.flashbang.fire) * TICK_RATE) + 1; i++) {
    sim.stepTick(inputs);
  }
}

describe("MW3 Lethal & Tactical Equipment", () => {
  it("takes the pin out first, as MW3 does, and throws nothing else until the arm has come through", () => {
    const sim = setupMatch();
    sim.match.join("player1", loadout());
    sim.stepTick({ player1: idleInput(0, 0) });

    sim.stepTick({ player1: { ...idleInput(0, 0), lethal: true } });
    expect(sim.match.projectiles.live.length).toBe(0);
    // A second press while the pin is out is the same throw, not another.
    sim.stepTick({ player1: { ...idleInput(0, 0), tactical: true } });
    waitForPin(sim, { player1: idleInput(0, 0) });
    expect(sim.match.projectiles.live.map((p) => p.kind)).toEqual(["frag"]);
  });

  it("spawns with 1 lethal and 2 tactical equipment, and spends one a throw", () => {
    const sim = setupMatch();
    sim.match.join("player1", loadout());
    sim.stepTick({ player1: idleInput(0, 0) });
    const throwOne = (key: "lethal" | "tactical") => {
      sim.stepTick({ player1: { ...idleInput(0, 0), [key]: true } });
      waitForThrow(sim, { player1: idleInput(0, 0) });
    };

    const thrown: string[] = [];
    const seen = new Set<number>();
    const record = () => {
      for (const p of sim.match.projectiles.live) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          thrown.push(p.kind);
        }
      }
    };
    for (const key of ["lethal", "lethal", "tactical", "tactical", "tactical"] as const) {
      throwOne(key);
      record();
    }
    // One frag, two flashbangs, and the third press of each found the pouch empty.
    expect(thrown).toEqual(["frag", "flashbang", "flashbang"]);
  });

  it("detonates Frag grenade after 3.5s fuse dealing radial explosion damage with wall LoS check", () => {
    const sim = setupMatch();
    sim.match.join("thrower", loadout({ lethal: "frag_grenade_mp" }));
    sim.match.join("nearbyEnemy", loadout());

    sim.match.place("thrower", { x: 0, y: 0, z: 0 }, 0, 0);
    // A few metres ahead: thrown at the ground at MW3's 940 units a second, it lands and rolls inside 256 units of them.
    sim.match.place("nearbyEnemy", { x: 0, y: 0, z: -4.0 }, 0, 0);

    // Throw frag grenade downward in front of nearbyEnemy
    sim.stepTick({
      thrower: { ...idleInput(0, -Math.PI / 3), lethal: true },
      nearbyEnemy: idleInput(0, 0),
    });
    waitForPin(sim, { thrower: idleInput(0, -Math.PI / 3), nearbyEnemy: idleInput(0, 0) });

    expect(sim.match.projectiles.live.length).toBe(1);
    const frag = sim.match.projectiles.live[0]!;
    expect(frag.kind).toBe("frag");
    expect(frag.fuseRemaining).toBeCloseTo(3.5, 0.1);
    // Every client is told where it is, on every snapshot.
    expect(sim.match.snapshotFor("nearbyEnemy", []).projectiles).toEqual([{ id: frag.id, kind: "frag", position: frag.position }]);

    // Step for 3.4 seconds (not yet exploded)
    const ticks34s = Math.round(3.4 * TICK_RATE);
    for (let i = 0; i < ticks34s; i++) {
      sim.stepTick({
        thrower: idleInput(0, 0),
        nearbyEnemy: idleInput(0, 0),
      });
    }

    expect(sim.match.projectiles.live.length).toBe(1);
    expect(sim.getLatest("nearbyEnemy")?.state.health).toBe(100);

    // Step across 3.5s fuse threshold: explosion!
    for (let i = 0; i < 15; i++) {
      sim.stepTick({
        thrower: idleInput(0, 0),
        nearbyEnemy: idleInput(0, 0),
      });
    }

    expect(sim.match.projectiles.live.length).toBe(0);
    expect(sim.match.snapshotFor("nearbyEnemy", []).projectiles).toEqual([]);
    // Everyone hears where it went off, not just that it did.
    const blast = sim.getEvents("nearbyEnemy").find((event) => event.kind === "detonate");
    expect(blast).toMatchObject({ what: "frag", by: "thrower" });
    // Nearby enemy within blast radius took explosion damage
    const enemyAfter = sim.getLatest("nearbyEnemy");
    expect(enemyAfter?.state.health).toBeLessThan(100);
  });

  it("Semtex grenade sticks to target player, beeps, and detonates for lethal kill", () => {
    const sim = setupMatch();
    sim.match.join("thrower", loadout({ lethal: "semtex_mp" }));
    sim.match.join("victim", loadout());

    sim.match.place("thrower", { x: 0, y: 0, z: 0 }, 0, 0);
    sim.match.place("victim", { x: 0, y: 0, z: -1.0 }, 0, 0);

    sim.stepTick({
      thrower: { ...idleInput(0, 0), lethal: true },
      victim: idleInput(0, 0),
    });
    waitForPin(sim, { thrower: idleInput(0, 0), victim: idleInput(0, 0) });

    const semtex = sim.match.projectiles.live[0]!;
    expect(semtex.kind).toBe("semtex");
    expect(semtex.fuseRemaining).toBeCloseTo(2.0, 0.1);

    // Step until fuse expires (2.0s = 120 ticks)
    for (let i = 0; i < 130; i++) {
      sim.stepTick({
        thrower: idleInput(0, 0),
        victim: idleInput(0, 0),
      });
    }

    expect(sim.match.projectiles.live.length).toBe(0);
    const victim = sim.getLatest("victim");
    expect(victim?.state.dead).toBe(true);

    const events = sim.getEvents("thrower");
    const death = events.find((e) => e.kind === "death" && e.victim === "victim");
    expect(death).toBeDefined();
    if (death && death.kind === "death") {
      expect(death.cause).toBe("explosion");
    }
  });

  it("Flashbang detonates after 1.5s, checks facing angle, and sets flashed duration", () => {
    const sim = setupMatch();
    sim.match.join("thrower", loadout({ tactical: "flash_grenade_mp" }));
    sim.match.join("victim", loadout());

    sim.match.place("thrower", { x: 0, y: 0, z: 0 }, 0, 0);
    // Victim facing towards flashbang landing zone (-Z)
    sim.match.place("victim", { x: 0, y: 0, z: -18.0 }, 0, 0);

    sim.stepTick({
      thrower: { ...idleInput(0, -Math.PI / 3), tactical: true },
      victim: idleInput(0, 0),
    });
    waitForPin(sim, { thrower: idleInput(0, -Math.PI / 3), victim: idleInput(0, 0) });

    const flash = sim.match.projectiles.live[0]!;
    expect(flash.kind).toBe("flashbang");
    expect(flash.fuseRemaining).toBeCloseTo(1.5, 0.1);

    // Advance 1.6s
    for (let i = 0; i < 100; i++) {
      sim.stepTick({
        thrower: idleInput(0, 0),
        victim: idleInput(0, 0),
      });
    }

    // Flashbang exploded and flashed victim!
    expect(sim.match.projectiles.live.length).toBe(0);
    const events = sim.getEvents("victim");
    const flashEvent = events.find((e) => e.kind === "announce" && e.what === "flashbang");
    expect(flashEvent).toBeDefined();
  });

  describe("an underbarrel launcher", () => {
    const grenadier = () => loadout({ primary: { weapon: `${GAME}/m4_mp`, attachments: ["gl"] } });
    /** Switched to the launcher and given time to bring it up, aimed level down -z. */
    function aimed(sim: ReturnType<typeof setupMatch>, target: number) {
      sim.match.join("grenadier", grenadier());
      sim.match.join("target", loadout());
      sim.match.place("grenadier", { x: 0, y: 0, z: 0 }, 0, 0);
      sim.match.place("target", { x: 0, y: 0, z: target }, 0, 0);
      const wait = (seconds: number) => {
        for (let i = 0; i < TICK_RATE * seconds; i++) {
          sim.stepTick({ grenadier: idleInput(0, 0), target: idleInput(0, 0) });
        }
      };
      wait(1.5); // the rifle's first draw, which no switch may cut short
      sim.stepTick({ grenadier: { ...idleInput(0, 0), alt: true }, target: idleInput(0, 0) });
      wait(1.5);
      expect(sim.getLatest("grenadier")!.state.alt).toMatchObject({ held: true });
    }
    const fire = (sim: ReturnType<typeof setupMatch>, seconds: number) => {
      sim.stepTick({ grenadier: { ...idleInput(0, 0), fire: true }, target: idleInput(0, 0) });
      const events: GameEvent[] = [];
      for (let i = 0; i < TICK_RATE * seconds; i++) {
        sim.stepTick({ grenadier: idleInput(0, 0), target: idleInput(0, 0) });
        events.push(...sim.getEvents("target"));
      }
      return events;
    };

    it("fires a round that flies, arms past its distance, and goes off where it lands", () => {
      const sim = setupMatch();
      aimed(sim, -22);
      const events = fire(sim, 1.5);
      const blast = events.find((event) => event.kind === "detonate");
      expect(blast).toMatchObject({ what: "launcher", by: "grenadier" });
      expect(sim.getLatest("target")!.state.health).toBeLessThan(100);
      // Its one grenade of stock reloads it, and that is the last.
      expect(sim.getLatest("grenadier")!.state.alt).toMatchObject({ held: true });
    });

    it("is a dud short of arming: it hits whoever it meets, and does not go off", () => {
      const sim = setupMatch();
      aimed(sim, -3);
      const events = fire(sim, 0.5);
      expect(events.some((event) => event.kind === "detonate")).toBe(false);
      // `damage.max`, 120: a 40 mm round in the chest from three metres kills.
      expect(sim.getLatest("target")!.state.dead).toBe(true);
    });
  });
});
