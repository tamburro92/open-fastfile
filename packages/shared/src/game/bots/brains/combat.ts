// A soldier that fights as MW3's AI does: Survival's soldier, at a skill level a
// lobby picks (recruit, regular, hardened, veteran — `_gameskill`'s easy, normal,
// hardened, veteran). Every number it acts on is MW3's, in `../mw3Ai.ts`, with the
// file and key it came from; what MW3 leaves to its executable is marked "engine:"
// there or "ours:" here.
//
// What it does, a tick at a time:
// - **Sees** the nearest living opponent in its view cone with a clear line to them.
// - **Shoots** in MW3's shoot styles: everything up close, bursts of 1-5 rounds
//   (taps with a semi-automatic) further out, single aimed shots beyond 1600 units,
//   with MW3's pause after each burst. A shot does not land by aim alone: each one
//   is rolled against the skill's hit chance, and on its first `missTime` seconds
//   on a target it misses on purpose. A shot that is to miss is aimed beside the
//   target; one that is to hit is aimed at its chest, down the sights.
// - **Closes in**: Survival sends its AI at the players, so it walks in firing
//   until it is as close as the soldier will come (`engageMinDist`), and runs in
//   without firing past the falloff. Blocked on the way, it fights from where it is.
// - **Hunts** when it sees no one: Survival sends its AI at the players, so it goes
//   for the nearest living opponent — to its own spot within Survival's goal radius
//   of them, so that a squad spreads out instead of walking one line.
// - **Holds fire** with a teammate on the line, and moves on rather than wait behind them.
// - **Throws** its lethal, no more often than the skill's grenade timer allows.
// - **Knifes** what is within MW3's melee range.

import type { PlayerId } from "../../../net/messages/fields.js";
import type { Vec3 } from "../../../sim/capsule.js";
import { GRAVITY, STAND_EYE_HEIGHT } from "../../../sim/movementState.js";
import { eyeHeight } from "../../../sim/stance.js";
import { UNITS_PER_M } from "../../../sim/units.js";
import { GRENADE_BLAST, GRENADE_THROW_LOFT, GRENADE_THROW_SPEED, THROW_TIMES } from "../../equipment.js";
import { defineBrain, IDLE, type BotSelf, type BrainContext, type Goal } from "../brain.js";
import { SEEK_GIVE_UP, SEEK_PERIOD, SEEK_TRIES } from "./seekNearest.js";
import {
  burstDelay,
  burstShots,
  difficultyOf,
  grenadeWait,
  hitChance,
  MELEE_RANGE,
  missTime,
  shootStyle,
  SURVIVAL_GOAL_RADIUS,
  SURVIVAL_SOLDIER,
  type BotDifficulty,
  type ShootStyle,
} from "../mw3Ai.js";

export const COMBAT_BRAIN = "combat";
export type { BotDifficulty };

/** Ours: how often the whole field is looked over, s. The target in hand is looked at every tick. */
export const SCAN_PERIOD = 0.1;
/** Engine: an actor's `fovcosine`. Its default lives in the executable; read as a 120° cone. */
export const VIEW_COSINE = 0.5;
/** Ours: how fast it turns its aim, rad/s, and how far off it may be and still pull the trigger. */
export const AIM_TURN_SPEED = 6;
export const AIM_TOLERANCE = 0.06;
/** Engine: where a miss goes. Ours: this far beside the target, m, a body's width and more. */
export const MISS_OFFSET: readonly [number, number] = [0.7, 1.2];
/** Ours: reload when nobody is in sight and the magazine is below this fraction. */
export const RELOAD_WHEN_SAFE = 0.5;
/** Ours: the throw's aim is held this long past the pin's `holdFireTime`, s, so the release tick is covered. */
const THROW_SLACK = 0.1;
/**
 * Ours: a teammate this close to the line of fire, m, holds the trigger back: a body and a
 * margin. iw5sp.exe keeps its actors off their friends too, and that check is not read.
 */
export const FRIEND_CLEARANCE = 0.7;

const u = (units: number) => units / UNITS_PER_M;

export interface CombatMemory {
  readonly difficulty: BotDifficulty;
  readonly rng: () => number;
  /** Who it is fighting, and until when it misses them on purpose. */
  targetId: PlayerId | null;
  missUntil: number;
  /** When it last looked over the whole field. */
  scannedAt: number;
  /** The burst in hand: its style, the rounds left in it, and the pause after it. */
  style: ShootStyle;
  shotsLeft: number;
  pauseUntil: number;
  /** The magazine as of last tick, which is how a shot is counted. */
  lastAmmo: number;
  /** Whether the next shot lands, rolled after each one; where a miss goes, m across and up; the range it was rolled at, units. */
  nextHits: boolean;
  missOffset: number;
  missLift: number;
  lastDistUnits: number;
  /** It held the trigger last tick: a semi-automatic needs it let go between shots. */
  firedLastTick: boolean;
  /** Who it is hunting, the goal it hunts them with until `huntAt`, and who it could not reach, until when. */
  quarry: PlayerId | null;
  hunting: Goal | null;
  huntAt: number;
  avoid: Map<PlayerId, number>;
  /** Its own spot around whoever it goes for, as an angle and a distance within the goal radius, m. */
  spot: { angle: number; distance: number };
  /** Until when it fights its target from where it stands: the motor could not take it closer. */
  holdUntil: number;
  /** The grenade timer, and a throw in progress: aim held until the grenade leaves. */
  grenadeReadyAt: number;
  throwUntil: number;
  throwAim: Vec3 | null;
}

export const combatBrain = defineBrain<CombatMemory>({
  id: COMBAT_BRAIN,
  // Every tick: a shot is rolled as it is fired, and a semi-automatic is tapped.
  init: (_self, rng, params) => {
    const difficulty = difficultyOf(params.difficulty);
    return {
      difficulty,
      rng,
      targetId: null,
      missUntil: 0,
      scannedAt: -Infinity,
      style: "burst",
      shotsLeft: 0,
      pauseUntil: 0,
      lastAmmo: -1,
      nextHits: false,
      missOffset: 0,
      missLift: 0,
      lastDistUnits: 0,
      firedLastTick: false,
      quarry: null,
      hunting: null,
      huntAt: -Infinity,
      avoid: new Map(),
      spot: rollSpot(rng),
      holdUntil: -Infinity,
      grenadeReadyAt: grenadeWait(difficulty, rng),
      throwUntil: -Infinity,
      throwAim: null,
    };
  },
  think: (ctx, self, memory) => thinkCombat(ctx, self, memory),
});

interface Seen {
  readonly id: PlayerId;
  readonly feet: Vec3;
  readonly chest: Vec3;
  /** m. */
  readonly distance: number;
}

export function thinkCombat(ctx: BrainContext, self: BotSelf, memory: CombatMemory): Goal {
  const feet = self.movement.feet;
  const eye: Vec3 = { x: feet.x, y: feet.y + eyeHeight(self.movement), z: feet.z };
  const weapon = ctx.state(self.id)?.weapon;
  const now = ctx.now;

  // A shot fired since last tick: the burst has one round fewer, and the next is rolled.
  const ammo = weapon?.ammo ?? 0;
  if (memory.lastAmmo >= 0 && ammo < memory.lastAmmo) {
    memory.shotsLeft -= memory.lastAmmo - ammo;
    if (memory.shotsLeft <= 0) {
      memory.pauseUntil = now + burstDelay(memory.difficulty, weapon?.weaponClass, memory.rng);
    }
    rollShot(memory, null, weapon?.weaponClass);
  }
  memory.lastAmmo = ammo;

  // The motor's verdict on the last walk: a quarry it could not reach is passed over
  // for a while, as seek-nearest does, and a target it could not close on is fought from here.
  // Either way it takes another spot around them, which is usually what was in the way.
  const blocked = self.motor.status === "noPath" || self.motor.status === "stuck";
  if (blocked && self.motor.goal.kind === "moveTo") {
    memory.spot = rollSpot(memory.rng);
    if (memory.targetId !== null) {
      memory.holdUntil = now + SEEK_GIVE_UP;
    } else if (memory.quarry !== null) {
      memory.avoid.set(memory.quarry, now + SEEK_GIVE_UP);
      memory.huntAt = now;
    }
  }

  const target = see(ctx, self, eye, memory);
  if (!target) {
    // There, and nobody in sight: there is nothing to wait for at this spot, so on to another.
    if (self.motor.status === "arrived" && memory.quarry !== null) {
      memory.spot = rollSpot(memory.rng);
      memory.huntAt = now;
    }
    memory.targetId = null;
    memory.firedLastTick = false;
    return hunt(ctx, self, memory, weapon);
  }
  memory.quarry = null;
  memory.hunting = null;

  const distUnits = target.distance * UNITS_PER_M;
  if (target.id !== memory.targetId) {
    memory.targetId = target.id;
    memory.missUntil = now + missTime(memory.difficulty, distUnits);
    memory.shotsLeft = 0;
    memory.pauseUntil = now;
    rollShot(memory, distUnits, weapon?.weaponClass);
  }

  // A grenade on its way out: hold the throw's aim until it leaves the hand.
  if (now < memory.throwUntil && memory.throwAim) {
    return { kind: "look", point: memory.throwAim, aimAt: memory.throwAim, turnSpeed: AIM_TURN_SPEED, fire: false };
  }

  const reload = weapon !== undefined && weapon.ammo === 0 && weapon.state !== "reloading";
  const semiAuto = weapon?.fireType !== undefined && !/full auto/i.test(weapon.fireType);

  // A new burst once the last one's pause is over.
  if (memory.shotsLeft <= 0 && now >= memory.pauseUntil) {
    memory.style = shootStyle(distUnits, weapon?.weaponClass, semiAuto);
    memory.shotsLeft = burstShots(memory.style, memory.rng);
    rollShot(memory, distUnits, weapon?.weaponClass);
  }
  const tap = semiAuto || memory.style === "semi" || memory.style === "single";
  const clear = !friendInLine(ctx, self, eye, target);
  const fire = clear && !reload && weapon?.state !== "reloading" && memory.shotsLeft > 0 && !(tap && memory.firedLastTick);

  const hits = memory.nextHits && now >= memory.missUntil;
  const aim = hits ? target.chest : missPoint(eye, target.chest, memory.missOffset, memory.missLift);

  const melee = distUnits <= MELEE_RANGE;
  const lethal = !melee && throwLethal(ctx, eye, target, memory);
  if (lethal) {
    return { kind: "look", point: memory.throwAim!, aimAt: memory.throwAim!, turnSpeed: AIM_TURN_SPEED, lethal: true, fire: false };
  }
  memory.firedLastTick = fire;

  const engaged = {
    aimAt: aim,
    turnSpeed: AIM_TURN_SPEED,
    triggerDiscipline: AIM_TOLERANCE,
    fire,
    // Down the sights while it fights, so a shot rolled to hit goes where it is aimed.
    ads: !melee,
    reload,
    melee,
  };

  // A friend in the way sends it on, even from where it would stand: waiting behind them fires at nobody.
  if (clear && (now < memory.holdUntil || distUnits <= SURVIVAL_SOLDIER.engageMinDist)) {
    return { kind: "look", point: aim, ...engaged };
  }
  if (distUnits > SURVIVAL_SOLDIER.engageMaxFalloff) {
    return { kind: "moveTo", point: spotNear(ctx, target.feet, memory.spot), run: true, aimAt: aim, turnSpeed: AIM_TURN_SPEED, reload };
  }
  return { kind: "moveTo", point: spotNear(ctx, target.feet, memory.spot), run: false, ...engaged };
}

/** The opponent it fights: the one in hand while it stays in sight, else the nearest in sight, looked for every `SCAN_PERIOD`. */
function see(ctx: BrainContext, self: BotSelf, eye: Vec3, memory: CombatMemory): Seen | null {
  if (memory.targetId !== null) {
    const held = seen(ctx, self, eye, memory.targetId);
    if (held) {
      return held;
    }
  }
  if (ctx.now - memory.scannedAt < SCAN_PERIOD) {
    return null;
  }
  memory.scannedAt = ctx.now;
  let best: Seen | null = null;
  for (const player of ctx.players) {
    if (player.id === self.id || isTeammate(self, player.team)) {
      continue;
    }
    const candidate = seen(ctx, self, eye, player.id);
    if (candidate && (!best || candidate.distance < best.distance)) {
      best = candidate;
    }
  }
  return best;
}

function seen(ctx: BrainContext, self: BotSelf, eye: Vec3, id: PlayerId): Seen | null {
  const state = ctx.state(id);
  if (!state || !state.alive) {
    return null;
  }
  const height = state.eyeHeight ?? STAND_EYE_HEIGHT;
  const chest: Vec3 = { x: state.feet.x, y: state.feet.y + height * 0.75, z: state.feet.z };
  const head: Vec3 = { x: state.feet.x, y: state.feet.y + height, z: state.feet.z };
  const dx = state.feet.x - eye.x;
  const dz = state.feet.z - eye.z;
  const horizontal = Math.hypot(dx, dz);
  if (horizontal > 0.1) {
    const cos = (-Math.sin(self.movement.yaw) * dx - Math.cos(self.movement.yaw) * dz) / horizontal;
    if (cos < VIEW_COSINE) {
      return null;
    }
  }
  if (!ctx.hasLineOfSight(eye, chest) && !ctx.hasLineOfSight(eye, head)) {
    return null;
  }
  return { id, feet: { ...state.feet }, chest, distance: Math.hypot(state.feet.x - self.movement.feet.x, state.feet.y - self.movement.feet.y, state.feet.z - self.movement.feet.z) };
}

/** Whether the next shot lands, against the skill's hit chance at this range; and which side a miss goes. */
function rollShot(memory: CombatMemory, distUnits: number | null, weaponClass: string | undefined): void {
  if (distUnits !== null) {
    memory.lastDistUnits = distUnits;
  }
  memory.nextHits = memory.rng() < hitChance(memory.difficulty, weaponClass, memory.lastDistUnits);
  const side = memory.rng() < 0.5 ? -1 : 1;
  memory.missOffset = side * (MISS_OFFSET[0] + (MISS_OFFSET[1] - MISS_OFFSET[0]) * memory.rng());
  memory.missLift = (memory.rng() - 0.5) * 0.4;
}

/** A point beside `chest`, square to the line of fire: `offset` m across and `lift` m up. */
function missPoint(eye: Vec3, chest: Vec3, offset: number, lift: number): Vec3 {
  const dx = chest.x - eye.x;
  const dz = chest.z - eye.z;
  const h = Math.hypot(dx, dz) || 1;
  return { x: chest.x + (dz / h) * offset, y: chest.y + lift, z: chest.z - (dx / h) * offset };
}

/**
 * Whether to pull the pin now: the grenade timer has run out, the target is
 * past the frag's own blast radius, and a throw at MW3's speed reaches it. It
 * starts the throw — the aim held until the grenade leaves — and the timer again.
 */
function throwLethal(ctx: BrainContext, eye: Vec3, target: Seen, memory: CombatMemory): boolean {
  if (ctx.now < memory.grenadeReadyAt || target.distance <= GRENADE_BLAST.radius) {
    return false;
  }
  const pitch = throwPitch(Math.hypot(target.feet.x - eye.x, target.feet.z - eye.z), target.feet.y - eye.y);
  if (pitch === null) {
    return false;
  }
  const dx = target.feet.x - eye.x;
  const dz = target.feet.z - eye.z;
  const h = Math.hypot(dx, dz) || 1;
  memory.throwAim = { x: eye.x + (dx / h) * Math.cos(pitch) * 10, y: eye.y + Math.sin(pitch) * 10, z: eye.z + (dz / h) * Math.cos(pitch) * 10 };
  memory.throwUntil = ctx.now + THROW_TIMES.frag.holdFire + THROW_SLACK;
  memory.grenadeReadyAt = ctx.now + grenadeWait(memory.difficulty, memory.rng);
  memory.firedLastTick = false;
  return true;
}

/** The flattest pitch, rad, that lands a thrown grenade `horizontal` m off and `dy` m up; null out of reach. */
export function throwPitch(horizontal: number, dy: number): number | null {
  for (let pitch = -0.4; pitch <= Math.PI / 4; pitch += 0.01) {
    const vh = GRENADE_THROW_SPEED * Math.cos(pitch);
    const vy = GRENADE_THROW_SPEED * Math.sin(pitch) + GRENADE_THROW_LOFT;
    const disc = vy * vy - 2 * GRAVITY * dy;
    if (disc < 0) {
      continue;
    }
    const t = (vy + Math.sqrt(disc)) / GRAVITY;
    if (vh * t >= horizontal) {
      return pitch;
    }
  }
  return null;
}

/**
 * Nobody in sight: reload if the magazine is low, and go for the nearest living
 * opponent it can reach. Chosen every `SEEK_PERIOD`, as seek-nearest chooses, and
 * the same goal held in between: a path asked for every tick is a path the motor
 * would be handed afresh every tick.
 */
function hunt(ctx: BrainContext, self: BotSelf, memory: CombatMemory, weapon: { ammo: number; clipSize: number; state: string } | undefined): Goal {
  const reload = weapon !== undefined && weapon.ammo < weapon.clipSize * RELOAD_WHEN_SAFE && weapon.state !== "reloading";
  if (memory.hunting && ctx.now < memory.huntAt) {
    return reload && memory.hunting.kind === "moveTo" ? { ...memory.hunting, reload } : memory.hunting;
  }
  memory.huntAt = ctx.now + SEEK_PERIOD;
  const feet = self.movement.feet;
  const opponents: { id: PlayerId; feet: Vec3; d: number }[] = [];
  for (const player of ctx.players) {
    if (player.id === self.id || isTeammate(self, player.team)) {
      continue;
    }
    const state = ctx.state(player.id);
    if (state?.alive && ctx.now >= (memory.avoid.get(player.id) ?? -Infinity)) {
      opponents.push({ id: player.id, feet: state.feet, d: Math.hypot(state.feet.x - feet.x, state.feet.y - feet.y, state.feet.z - feet.z) });
    }
  }
  opponents.sort((a, b) => a.d - b.d);
  for (const quarry of opponents.slice(0, SEEK_TRIES)) {
    if (quarry.id !== memory.quarry) {
      memory.spot = rollSpot(memory.rng);
    }
    const point = spotNear(ctx, quarry.feet, memory.spot);
    const route = ctx.nav.route(feet, point);
    if (route) {
      memory.quarry = quarry.id;
      memory.hunting = { kind: "moveTo", point, route, run: true };
      return { ...memory.hunting, reload };
    }
  }
  memory.quarry = null;
  memory.hunting = reload ? { kind: "idle", reload } : IDLE;
  return memory.hunting;
}

/** Whether a living teammate stands between the eye and the target, within `FRIEND_CLEARANCE` of the line. */
function friendInLine(ctx: BrainContext, self: BotSelf, eye: Vec3, target: Seen): boolean {
  if (self.team === undefined) {
    return false;
  }
  const dx = target.chest.x - eye.x;
  const dy = target.chest.y - eye.y;
  const dz = target.chest.z - eye.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  for (const player of ctx.players) {
    if (player.id === self.id || !isTeammate(self, player.team)) {
      continue;
    }
    const state = ctx.state(player.id);
    if (!state?.alive) {
      continue;
    }
    // Their chest, as the target's is measured: a body is taller than the margin only at its ends.
    const px = state.feet.x - eye.x;
    const py = state.feet.y + (state.eyeHeight ?? STAND_EYE_HEIGHT) * 0.75 - eye.y;
    const pz = state.feet.z - eye.z;
    const t = (px * dx + py * dy + pz * dz) / lengthSq;
    if (t > 0 && t < 1 && Math.hypot(px - t * dx, py - t * dy, pz - t * dz) < FRIEND_CLEARANCE) {
      return true;
    }
  }
  return false;
}

/** A spot within Survival's goal radius: anywhere around, never right on top of them. */
function rollSpot(rng: () => number): { angle: number; distance: number } {
  return { angle: rng() * 2 * Math.PI, distance: u(SURVIVAL_GOAL_RADIUS) * (0.25 + 0.75 * rng()) };
}

/** The graph's node nearest this bot's spot around `feet`, or `feet` itself where none is near. */
function spotNear(ctx: BrainContext, feet: Vec3, spot: { angle: number; distance: number }): Vec3 {
  const at = { x: feet.x + Math.cos(spot.angle) * spot.distance, y: feet.y, z: feet.z + Math.sin(spot.angle) * spot.distance };
  const node = ctx.nav.ready ? ctx.nav.nearestNode(at) : -1;
  return node >= 0 ? ctx.nav.nodeFeet(node) : feet;
}

function isTeammate(self: BotSelf, team: string | undefined): boolean {
  return self.team !== undefined && team === self.team;
}
