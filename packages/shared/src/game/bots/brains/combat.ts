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
// - **Keeps its distance**: stands and fights within the soldier's engagement
//   range, walks in firing beyond it, and runs in past its falloff.
// - **Throws** its lethal, no more often than the skill's grenade timer allows.
// - **Knifes** what is within MW3's melee range.
// - **Hunts** when it sees no one: Survival sends its AI at the players, so it goes
//   to the nearest living opponent.

import type { PlayerId } from "../../../net/messages/fields.js";
import type { Vec3 } from "../../../sim/capsule.js";
import { GRAVITY, STAND_EYE_HEIGHT } from "../../../sim/movementState.js";
import { eyeHeight } from "../../../sim/stance.js";
import { UNITS_PER_M } from "../../../sim/units.js";
import { GRENADE_BLAST, GRENADE_THROW_LOFT, GRENADE_THROW_SPEED, THROW_TIMES } from "../../equipment.js";
import { defineBrain, IDLE, type BotSelf, type BrainContext, type Goal } from "../brain.js";
import {
  burstDelay,
  burstShots,
  difficultyOf,
  grenadeWait,
  hitChance,
  MELEE_RANGE,
  missTime,
  shootStyle,
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

  const target = see(ctx, self, eye, memory);
  if (!target) {
    memory.targetId = null;
    memory.firedLastTick = false;
    return hunt(ctx, self, weapon);
  }

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
  const fire = !reload && weapon?.state !== "reloading" && memory.shotsLeft > 0 && !(tap && memory.firedLastTick);

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

  // Engagement: fighting where it stands within the soldier's range, walking in
  // beyond it, and running in past its falloff without firing.
  if (distUnits > SURVIVAL_SOLDIER.engageMaxFalloff) {
    return { kind: "moveTo", point: target.feet, track: target.id, route: ctx.nav.route(feet, target.feet) ?? undefined, run: true, aimAt: aim, turnSpeed: AIM_TURN_SPEED, reload };
  }
  if (distUnits > SURVIVAL_SOLDIER.engageMaxDist) {
    return { kind: "moveTo", point: target.feet, track: target.id, route: ctx.nav.route(feet, target.feet) ?? undefined, run: false, ...engaged };
  }
  return { kind: "look", point: aim, ...engaged };
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

/** Nobody in sight: reload if the magazine is low, and go for the nearest living opponent it can reach. */
function hunt(ctx: BrainContext, self: BotSelf, weapon: { ammo: number; clipSize: number; state: string } | undefined): Goal {
  const reload = weapon !== undefined && weapon.ammo < weapon.clipSize * RELOAD_WHEN_SAFE && weapon.state !== "reloading";
  const feet = self.movement.feet;
  const opponents: { id: PlayerId; feet: Vec3; d: number }[] = [];
  for (const player of ctx.players) {
    if (player.id === self.id || isTeammate(self, player.team)) {
      continue;
    }
    const state = ctx.state(player.id);
    if (state?.alive) {
      opponents.push({ id: player.id, feet: state.feet, d: Math.hypot(state.feet.x - feet.x, state.feet.y - feet.y, state.feet.z - feet.z) });
    }
  }
  opponents.sort((a, b) => a.d - b.d);
  for (const quarry of opponents.slice(0, 3)) {
    const route = ctx.nav.route(feet, quarry.feet);
    if (route) {
      return { kind: "moveTo", point: quarry.feet, track: quarry.id, route, run: true, reload };
    }
  }
  return reload ? { kind: "idle", reload } : IDLE;
}

function isTeammate(self: BotSelf, team: string | undefined): boolean {
  return self.team !== undefined && team === self.team;
}
