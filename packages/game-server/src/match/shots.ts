// The rounds a tick's replay fired: which way each went, what it met — the map,
// a player as the shooter saw them, or an actor — and what it cost them.

import type { PlayerId } from "@3d/shared/net/messages/fields.js";
import type { InputMessage } from "@3d/shared/net/messages/input.js";
import type { ActorId } from "@3d/shared/game/actors/actor.js";
import { shotDamage, type CombatRules } from "@3d/shared/game/rules.js";
import { couldHitBody } from "@3d/shared/rig/hitboxes.js";
import { rayBox } from "@3d/shared/sim/hit.js";
import { RADIUS, STAND_HEIGHT } from "@3d/shared/sim/movementState.js";
import { CROUCH_HEIGHT, PRONE_HEIGHT } from "@3d/shared/sim/stance.js";
import type { CapsuleWorld, RayHit, Vec3 } from "@3d/shared/sim/capsule.js";
import type { HitLocation } from "@3d/shared/sim/hitLocations.js";
import { createMovement, type MovementState } from "@3d/shared/sim/movement.js";
import { eyeHeight } from "@3d/shared/sim/stance.js";
import { aimAngles, aimDirection, coneSample, shotSpread, shotStream, spreadDirection, type Aim, type ReadKick } from "@3d/shared/sim/recoil.js";
import { DEFAULT_SURFACE, type SurfaceType } from "@3d/shared/sim/surfaces.js";
import { afterPenetration, MAX_PENETRATIONS, PENETRATION_STEP, penetrationDepth } from "@3d/shared/game/penetration.js";
import type { WeaponController } from "@3d/shared/sim/weapon.js";
import { BULLET_RANGE, type LauncherProjectile, type WeaponDef } from "@3d/shared/sim/weaponDef.js";
import type { Actors } from "../actors.js";
import { poseBody } from "../bodies.js";
import type { MatchClock } from "./clock.js";
import type { Damage } from "./damage.js";
import type { EventOutbox } from "./outbox.js";
import type { Rewinder, RewindTarget } from "./rewind.js";
import type { Member, Roster } from "./roster.js";

/**
 * A shot one tick's replay fired, and what it found.
 *
 * **No client ever sends one of these.** It exists because this server stepped
 * that client's own input through the same weapon state machine and the shot
 * counter advanced (`WeaponData.fired`), which is what makes rate of fire,
 * ammunition, burst discipline and reload gating unforgeable: there is nothing
 * to forge.
 */
export interface FiredShot {
  shooter: PlayerId;
  /** `WeaponData.fired` after this round left: which shot of this weapon's life it was. */
  ordinal: number;
  /** Where it came from and which way it went, for whoever has to draw or explain it. */
  from: Vec3;
  direction: Vec3;
  /** Null where the bullet reached its range without meeting anything. */
  result: ShotResult | null;
}

/** A shot that stopped on the map. */
export interface WorldShot {
  kind: "world";
  /** Metres from the shot's origin. */
  distance: number;
  normal: Vec3;
  /** Which clipmap tree answered, as `RayHit.kind` means it. */
  surface: "map" | "prop";
  /** What the triangle is made of: what a round can go through (game/penetration.ts). */
  material: SurfaceType;
}

/** A shot that landed on somebody. Damage is the caller's: this says what was hit, not what it cost. */
export interface PlayerShot {
  kind: "player";
  id: PlayerId;
  /** The joint whose box the bullet entered. `location` is what a hit on it counts as. */
  bone: string;
  location: HitLocation;
  distance: number;
}

/** A shot that landed on an actor (actors.ts). */
export interface ActorShot {
  kind: "actor";
  id: ActorId;
  /** The joint whose box it entered, or "" for a kind shot as its capsule. */
  bone: string;
  location: HitLocation;
  distance: number;
}

/** What a shot found. Null is a shot that reached its range without meeting anything. */
export type ShotResult = WorldShot | PlayerShot | ActorShot;

/** How hot a weapon was before the step that fired: the cone's width comes from it. */
export interface Heat {
  spread: number;
  ads: number;
}

/** Closer than this to the entry, a face met on the way back is the entry face. */
const ENTRY_FACE = 1e-5;

/** How far past where a round entered a body the reverse trace that finds its exit starts. */
const BODY_REACH = 2;

const IDENTITY: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export class Shots {
  /** Every shot this tick's replay fired, in the order they left. Cleared at the top of each tick. */
  readonly fired: FiredShot[] = [];
  /**
   * Where a round that flies goes instead of being traced: an underbarrel
   * launcher's (`WeaponDef.projectile`). `Match` points it at `Projectiles.launch`.
   */
  launcher: ((shooter: PlayerId, eye: Vec3, aim: Vec3, def: LauncherProjectile, impact: number) => void) | null = null;
  /**
   * One shot's scratch: where a player was, what the map answered, and the far end
   * of the segment. A burst of pellets allocates its answers and nothing else.
   */
  private readonly rewound: MovementState = createMovement({ x: 0, y: 0, z: 0 }, 0, 0);
  private readonly mapHit: RayHit = { distance: 0, normal: { x: 0, y: 0, z: 0 }, kind: "map", surface: DEFAULT_SURFACE };
  private readonly shotEnd: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly boxMin: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly boxMax: Vec3 = { x: 0, y: 0, z: 0 };
  /** A penetrating round's scratch: where its next trace starts, its far probe, and the map's far face. */
  private readonly exitFrom: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly exitFar: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly backward: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly exitHit: RayHit = { distance: 0, normal: { x: 0, y: 0, z: 0 }, kind: "map", surface: DEFAULT_SURFACE };
  /** Where a shot leaves along, refilled per round: the shooter's intent plus the kick. */
  private readonly shotAim: Aim = { yaw: 0, pitch: 0 };
  private readonly shotDirection: Vec3 = { x: 0, y: 0, z: 0 };
  /** Where in this round's cone it goes, refilled per round (sim/recoil.ts). */
  private readonly shotCone = { angle: 0, radius: 0 };

  constructor(
    private readonly clock: MatchClock,
    private readonly collision: CapsuleWorld,
    private readonly roster: Roster,
    private readonly actors: Actors,
    private readonly rewinder: Rewinder,
    private readonly damage: Damage,
    private readonly outbox: EventOutbox,
    private readonly rules: () => CombatRules,
  ) {}

  clear(): void {
    this.fired.length = 0;
  }

  /**
   * The shots the replay of `message` fired, traced, recorded and paid for: the
   * damage is queued as each round is traced, so a target killed by the first
   * round of a burst does not take the rest of it.
   *
   * `weapon` is the controller that was held *before* the step. A swap that
   * completed inside it hands back a different one, counting from its own
   * total: subtracting across the two would invent a burst out of nothing, or
   * 65535 of them. Neither weapon can have fired on such a step — the one going
   * away is `dropping` and the one arriving is `raising` — so identity is the
   * whole check, and the same check covers a respawn that rebuilt the weapon.
   *
   * `kick` is the view kick as it stood *before* the step. A step that fired more
   * than one round — a sprint cut short by the trigger, on a weapon whose
   * `fireTime` is 0 — traces all of them along it: they left within one step of
   * each other, and it is the last aim their shooter saw.
   */
  fire(member: Member, weapon: WeaponController | undefined, before: number, kick: ReadKick | null, heat: Heat | null, message: InputMessage): void {
    const held = member.player.weapon;
    if (held === undefined || held !== weapon) {
      return;
    }
    // Wrap-safe: `fired` is a uint16 on both ends, and the difference is the
    // count however many times it has been round.
    const count = (held.data.fired - before) & 0xffff;
    if (count === 0) {
      return;
    }

    // Where they ended the step, not where they started it: a client turns and
    // fires on one input, and `roundInput` means both ends turned by the same
    // quantized amount before stepping.
    //
    // Their intent **plus the view kick they had already taken** — the aim's own
    // recoil, not the gun's, which rocks the model and decides nothing. It is the
    // half of the aim this server owns outright: it cannot reproduce a mouse, so
    // it takes the client's word for where they were looking and bounds it, while
    // the kick is its own arithmetic off a seed derived from the player's id and
    // the shot's own ordinal. A client that sent a finished aim could hide a kick
    // it never took — so it sends intent and nothing else.
    const shooter = member.id;
    const movement = member.player.movement;
    const { feet } = movement;
    // The eye as their stance has it, as the step left it: a round leaves from
    // where they see from, and its cone is the stance's by the same height.
    const up = eyeHeight(movement);
    const eye = { x: feet.x, y: feet.y + up, z: feet.z };
    // Degrees wide, from how hot the weapon was before this step and how far into
    // the sights they had got. **This server decides it**: the width is the
    // weapon's own numbers, and where in it each round lands is drawn from the
    // same seeded stream the recoil is, so a client has nothing to send and
    // nothing to bend. It predicts the identical cone from the identical seed.
    const cone = heat ? shotSpread(held.def, heat.spread, heat.ads, up) : 0;
    // A shotgun's `shotCount` pellets, each in the same cone on a stream of its own
    // (`shotStream`'s `pellet`); a rifle's one is pellet 0, the stream it always had.
    const pellets = Math.max(1, held.def.shotCount ?? 1);
    for (let i = 0; i < count; i++) {
      const ordinal = (before + i + 1) & 0xffff;
      // One marker a round however many of its pellets landed: a marker per pellet
      // would fill a snapshot's event tail with one shotgun blast.
      let marked = false;
      let lethal = false;
      for (let pellet = 0; pellet < pellets; pellet++) {
        // Per round rather than per step: two rounds of a burst share an aim and
        // must not share a deviation.
        const aim = aimDirection(aimAngles(movement, kick, this.shotAim), this.shotDirection);
        spreadDirection(aim, cone, coneSample(shotStream(member.player.seed, ordinal, pellet), this.shotCone));
        if (held.def.projectile) {
          // A round that flies: launched along the same aim and cone, and judged where it lands.
          this.launcher?.(shooter, { ...eye }, { ...aim }, held.def.projectile, held.def.damage?.max ?? 0);
          continue;
        }
        // Once a round: every trace it takes through walls is judged at the same moment.
        const target = this.targetFor(shooter, message);
        const result = this.trace(shooter, eye, aim, BULLET_RANGE, message, undefined, target);
        this.fired.push({ shooter, ordinal, from: { ...eye }, direction: { ...aim }, result });
        const struck = this.penetrate(shooter, held.def, eye, aim, result, message, target);
        marked ||= struck.marked;
        lethal ||= struck.lethal;
      }
      if (marked) {
        this.outbox.push({ kind: "hit", lethal }, shooter, 0);
      }
    }
  }

  /**
   * What a shot from `shooter` hits: nothing, the map, or somebody.
   *
   * `direction` is a unit vector and `range` the bullet's reach in metres;
   * `message` is the input the shot came with, whose `drawn` names the moment
   * the shooter was drawing — every other player is judged there
   * rather than here, and the moment is worked out once for the whole shot.
   *
   * **The nearest of everything wins**, and the map is one of the candidates: a
   * bullet that meets a wall before reaching a body is a miss, and the two are
   * compared as fractions of one segment because a bone's box answers in those.
   * The map's own trace is the `"shots"` channel, which is not the geometry a
   * capsule walks into — `clip_player` over a window stops a player and not a
   * bullet.
   *
   * Applies no damage and records nothing. What was hit is the whole answer.
   */
  trace(
    shooter: PlayerId,
    from: Vec3,
    direction: Vec3,
    range: number,
    message: InputMessage,
    through?: ReadonlySet<PlayerId>,
    target?: RewindTarget,
  ): ShotResult | null {
    if (!(range > 0)) {
      return null;
    }
    const to = this.shotEnd;
    to.x = from.x + direction.x * range;
    to.y = from.y + direction.y * range;
    to.z = from.z + direction.z * range;
    const at = target ?? this.targetFor(shooter, message);

    // The map first, so a body behind a wall is rejected by a fraction rather than
    // by a second trace per player.
    const map = this.collision.traceRay(from, direction, range, "shots", this.mapHit);
    let nearest = map === null ? 1 : map.distance / range;
    let best: ShotResult | null =
      map === null ? null : { kind: "world", distance: map.distance, normal: { ...map.normal }, surface: map.kind, material: map.surface };

    for (const member of this.roster.values()) {
      // Nobody shoots themselves: the origin is inside the shooter's own body, so
      // every one of their shots would stop on their own chest. A body waiting to
      // respawn is not there to be shot either — it would stop a round meant for
      // whoever is behind it.
      if (member.id === shooter || member.player.dead || through?.has(member.id)) {
        continue;
      }
      const rewound = this.rewinder.sample(member.history, at, this.rewound);
      if (rewound === null) {
        continue;
      }

      // The broad phase, against where a pose can reach rather than a pose — posing
      // is the expensive half and almost nobody survives this. The stance decides
      // the reach: a lying body is not inside the capsule that walks.
      const hitFraction = couldHitBody(from, to, rewound);
      if (hitFraction === null) {
        continue;
      }

      if (member.body !== undefined) {
        // The weapon in their hands now rather than the one they held at the moment
        // rewound to, which is what the client draws a peer with as well: the pose
        // needs a weapon's state and the history keeps only a `MovementState`.
        poseBody(member.body, rewound, member.player.weapon?.data ?? null);
        const hit = member.body.boxes.trace(from, to);
        if (hit !== null && hit.fraction < nearest) {
          nearest = hit.fraction;
          best = { kind: "player", id: member.id, bone: hit.bone, location: hit.location, distance: hit.fraction * range };
        }
      } else {
        // Capsule fallback when a player has no loaded skeletal body (e.g. missing asset or stand-in):
        const { feet, stance } = rewound;
        const h = stance.kind === "prone" ? PRONE_HEIGHT : stance.kind === "crouch" ? CROUCH_HEIGHT : STAND_HEIGHT;
        this.boxMin.x = feet.x - RADIUS;
        this.boxMin.y = feet.y;
        this.boxMin.z = feet.z - RADIUS;
        this.boxMax.x = feet.x + RADIUS;
        this.boxMax.y = feet.y + h;
        this.boxMax.z = feet.z + RADIUS;
        const fraction = rayBox(from, to, IDENTITY, this.boxMin, this.boxMax);
        if (fraction !== null && fraction < nearest) {
          nearest = fraction;
          best = { kind: "player", id: member.id, bone: "", location: "torsoUpper", distance: fraction * range };
        }
      }
    }
    if (this.actors.size > 0) {
      const actor = this.actors.trace(from, to, at, this.clock.tick, nearest);
      if (actor !== null) {
        best = { kind: "actor", id: actor.id, bone: actor.bone, location: actor.location, distance: actor.fraction * range };
      }
    }
    return best;
  }

  /**
   * Everything one round does from the first thing it met: MW3's
   * `Bullet_FireExtended` (game/penetration.ts says where each rule is read
   * from). Every body it reaches is hurt with what the round still carries, and
   * the map and bodies alike are gone through where their surface and the
   * weapon's `penetrateType` allow, up to `MAX_PENETRATIONS` of them.
   *
   * The damage falloff is measured from the eye to each hit, walls included, as
   * the game measures it from where the round was fired.
   */
  private penetrate(
    shooter: PlayerId,
    def: WeaponDef,
    eye: Vec3,
    aim: Vec3,
    first: ShotResult | null,
    message: InputMessage,
    target: RewindTarget,
  ): { marked: boolean; lethal: boolean } {
    let marked = false;
    let lethal = false;
    // `bp.damageMultiplier`, a float in the game: what the round keeps of itself.
    let carried = 1;
    // `specialty_bulletpenetration` is MW3's Impact proficiency, which no class here carries.
    const perk = false;
    const through = new Set<PlayerId>();
    let result = first;
    // Metres from the eye to where `result`'s trace began.
    let travelled = 0;
    for (let pass = 0; result !== null; pass++) {
      const at = travelled + result.distance;
      if (result.kind === "player") {
        // `held.def` rather than the entry's: it is the definition with this
        // player's attachments already merged into it (`resolveWeapon`), so a
        // silencer's damage penalty is in the number without being looked up twice.
        const amount = shotDamage(def, result.location, at, this.rules(), carried);
        const victim = this.roster.get(result.id);
        const was = victim?.player.health ?? 0;
        if (amount > 0) {
          this.damage.hurt({ id: result.id, amount, by: shooter, cause: "bullet", location: result.location, along: { ...aim } });
        }
        // **After** the damage, and only if it cost them something: a round a
        // teammate absorbs with friendly fire off, or one a script ignored, draws nothing.
        if (victim && victim.player.health < was) {
          marked = true;
          lethal ||= victim.player.dead;
        }
        through.add(result.id);
      } else if (result.kind === "actor") {
        const amount = shotDamage(def, result.location, at, this.rules(), carried);
        const was = this.actors.health(result.id);
        if (amount > 0) {
          this.damage.hurt({ kind: "actor", actor: result.id, amount, by: shooter, cause: "bullet", location: result.location });
        }
        if (this.actors.health(result.id) < was) {
          marked = true;
          lethal ||= !this.actors.alive(result.id);
        }
        break; // a creature is not gone through: nothing in MW3 to be faithful to
      }
      if (pass === MAX_PENETRATIONS) {
        break;
      }

      // What it entered, and how much of that its type goes through.
      const entryDepth = penetrationDepth(def.penetrateType, result.kind === "world" ? result.material : "flesh", perk);
      if (!(entryDepth > 0)) {
        break;
      }
      // Where it leaves, as the game finds it: a trace on from a step past the
      // entry to whatever is next, then one back from there to the surface it
      // came out of. The collision soup answers either winding, so where nothing
      // lies between the entry and the next map face, that face *is* the far side
      // of the wall it is in: a clipmap brush is closed.
      const step = at + PENETRATION_STEP;
      let next = this.trace(shooter, this.pointOn(eye, aim, step, this.exitFrom), aim, BULLET_RANGE - step, message, through, target);
      let nextAt = next === null ? BULLET_RANGE : step + next.distance;
      let thickness: number;
      let exitDepth = entryDepth;
      if (result.kind === "world") {
        const back = this.backTo(eye, aim, nextAt, at);
        if (back !== null) {
          thickness = back.distance;
          exitDepth = penetrationDepth(def.penetrateType, back.surface, perk);
        } else if (next?.kind === "world") {
          thickness = nextAt - at;
          exitDepth = penetrationDepth(def.penetrateType, next.material, perk);
          const beyond = nextAt + PENETRATION_STEP;
          next = this.trace(shooter, this.pointOn(eye, aim, beyond, this.exitFrom), aim, BULLET_RANGE - beyond, message, through, target);
          nextAt = next === null ? BULLET_RANGE : beyond + next.distance;
        } else {
          thickness = 0; // a sheet: measured as the one unit the game never goes under
        }
      } else {
        const out = this.exitThrough(result.id, this.pointOn(eye, aim, at, this.exitFrom), aim, target);
        if (out === null) {
          break;
        }
        thickness = out;
      }
      carried = Math.fround(afterPenetration(carried, thickness, entryDepth, exitDepth));
      if (!(carried > 0) || next === null) {
        break;
      }
      // `next.distance` is from where its trace began; the loop's `at` is from the eye.
      travelled = nextAt - next.distance;
      result = next;
    }
    return { marked, lethal };
  }

  /**
   * The reverse trace: from `from` metres down the shot back toward `to`, the
   * first map face met — the far side of what the round entered at `to` — as its
   * distance from `to` and what it is made of. Null where the first face back is
   * the entry itself, or there is none: nothing lies between the two.
   */
  private backTo(eye: Vec3, aim: Vec3, from: number, to: number): { distance: number; surface: SurfaceType } | null {
    const length = from - to;
    if (!(length > PENETRATION_STEP)) {
      return null;
    }
    this.backward.x = -aim.x;
    this.backward.y = -aim.y;
    this.backward.z = -aim.z;
    const hit = this.collision.traceRay(this.pointOn(eye, aim, from, this.exitFar), this.backward, length, "shots", this.exitHit);
    if (hit === null) {
      return null;
    }
    // A face this close to the entry is the entry face itself, met from behind.
    const distance = length - hit.distance;
    return distance > ENTRY_FACE ? { distance, surface: hit.surface } : null;
  }

  /**
   * How far a round that entered `id`'s body at `entry` goes before it leaves:
   * the game's reverse trace, from `BODY_REACH` on back to the entry, against the
   * same rewound pose the round hit. Null for a body that is not there to trace.
   */
  private exitThrough(id: PlayerId, entry: Vec3, direction: Vec3, target: RewindTarget): number | null {
    const member = this.roster.get(id);
    if (member?.body === undefined) {
      return null;
    }
    const rewound = this.rewinder.sample(member.history, target, this.rewound);
    if (rewound === null) {
      return null;
    }
    poseBody(member.body, rewound, member.player.weapon?.data ?? null);
    const far = this.pointOn(entry, direction, BODY_REACH, this.exitFar);
    const hit = member.body.boxes.trace(far, entry);
    return hit === null ? null : BODY_REACH * (1 - hit.fraction);
  }

  private pointOn(from: Vec3, direction: Vec3, distance: number, out: Vec3): Vec3 {
    out.x = from.x + direction.x * distance;
    out.y = from.y + direction.y * distance;
    out.z = from.z + direction.z * distance;
    return out;
  }

  /** The moment `shooter` was drawing when they sent `message`: counted once, whoever it is judged against. */
  targetFor(shooter: PlayerId, message: InputMessage): RewindTarget {
    return this.rewinder.target(this.roster.get(shooter)?.sentTick ?? -1, message);
  }
}
