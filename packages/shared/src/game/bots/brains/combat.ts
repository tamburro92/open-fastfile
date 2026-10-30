// A bot that plays as a player does: Bot Warfare's logic for MW3 (`../botWarfare.ts`
// has the credit and the numbers), at the difficulty a lobby picks. The functions here
// follow the mod's in `maps/mp/bots/_bot_internal.gsc`, named where they map on.
//
// - **Who** (`target_loop`): everyone in view with a clear line is tracked. One in
//   sight only counts once seen for `init_react_time`; the one seen most recently and
//   nearest is the target, and one out of sight is known for `remember_time`.
// - **Aim** (`aim_loop`, `bot_lookat`): a look takes `aim_time`, leads a moving target,
//   and starts off by an offset that closes over `aim_offset_time`. Shots go where
//   the gun points; nothing is rolled.
// - **Fire**: after `reaction_time` in sight, with the crosshair on, down the sights
//   unless up close; on at the last place for `shoot_after_time` once they are gone.
// - **Move** (`walk_loop`): with a target it can shoot it stands or strafes, as
//   its `rand` for that target decided, and jumps or drops as it first looks. Otherwise
//   it goes to where the target was last seen, and with no target to a **random node
//   of the map**, which is what keeps a team from walking one line.
//
// Not carried over, for what they need that a world here lacks: camping and grenade
// spots (the mod's hand-placed waypoints), objectives, killstreaks, weapon swaps.
// Ours: bones are heights, the rolls made "at each waypoint" are made each second,
// and a teammate on the line holds the trigger back.

import type { PlayerId } from "../../../net/messages/fields.js";
import type { Vec3 } from "../../../sim/capsule.js";
import { STAND_EYE_HEIGHT } from "../../../sim/movementState.js";
import { eyeHeight } from "../../../sim/stance.js";
import { UNITS_PER_M } from "../../../sim/units.js";
import { THROW_TIMES } from "../../equipment.js";
import { defineBrain, IDLE, type BotSelf, type BrainContext, type Goal } from "../brain.js";
import {
  ADS_AIM_MULTI,
  ADS_FOV_MULTI,
  AIM_HEIGHT,
  BOT_RANGE,
  BOT_SKILLS,
  canAds,
  difficultyOf,
  inRange,
  sightRate,
  type AimBone,
  type BotDifficulty,
  type BotSkill,
} from "../botWarfare.js";

export const COMBAT_BRAIN = "combat";
export type { BotDifficulty };

/** The mod's loops run every 0.05 s, and this is its clock. */
export const THINK_PERIOD = 0.05;
const THINK_MS = THINK_PERIOD * 1000;
/** Ours: a gap this long between thinks is a death: everything it knew is gone. */
const RESPAWN_GAP = 0.5;
/** `strafe`: one side for 2 s; `watchToLook`: one jump or drop per 5 s, and a drop stays down 2.5 s. */
const STRAFE_TIME = 2;
const JUMP_COOLDOWN = 5;
const DROP_TIME = 2.5;
/** `strafe` traces 500 units each side. */
const STRAFE_REACH = 500;
/** `aim_loop`: how far on target to fire, or to knife, or to stay down the sights. */
const FIRE_CONE = 0.99;
const AFTER_CONE = 0.95;
const KNIFE_CONE = 0.9;
const ADS_CONE = 0.75;
/** The reach of a knife here, m (game-server's `MELEE_RANGE`): the mod's 128 units is MW3's lunge, which this game does not have. */
const KNIFE_REACH = 2;
/** `reload_thread`: 2.5 s since the last shot, with no target, and under half a magazine. */
const RELOAD_WAIT = 2.5;
const RELOAD_BELOW = 0.5;
/** `bot_listen_to_steps`: within 100 units, of anyone moving at 141 u/s and more, every second, from level 3. */
const LISTEN_DIST = 100;
const LISTEN_SPEED = Math.sqrt(20000);
const LISTEN_LEVEL = 3;
/** `bot_think_follow`: a roll every 3 to 5 s; a follow of 10 to 20 s. */
const FOLLOW_ROLL: readonly [number, number] = [3, 5];
const FOLLOW_TIME: readonly [number, number] = [10, 20];
/** `stance_loop`: no new sprint within 2 s of the last; ours: one lasts 3 s. */
const SPRINT_GAP = 2;
const SPRINT_TIME = 3;
/** `aim_loop`, over a grenade: headroom at both ends, units. */
const NADE_HEADROOM = { self: 75, target: 100 } as const;
/** Ours: how many random nodes it tries for a path in one think. */
const GOAL_TRIES = 8;
/** Ours: a teammate this close to the line of fire, m, holds the trigger back: a body and a margin. */
export const FRIEND_CLEARANCE = 0.7;
/** Ours: seconds between rolls for stance and sprint. */
const STANCE_PERIOD = 1;

const u = (units: number) => units / UNITS_PER_M;

/** `createTargetObj`: what it knows of one opponent. */
export interface Tracked {
  /** When first seen, s. */
  created: number;
  /** ms in sight, and out of it; only one is ever non-zero. */
  traceTime: number;
  noTraceTime: number;
  /** When last in sight, s: the most recent is who it fights. */
  seenAt: number;
  lastSeen: Vec3;
  /** Units. */
  dist: number;
  /** 0-99, for good: whether it strafes this one, and throws at them. */
  rand: number;
  didLook: boolean;
  bone: AimBone;
  boneAt: number;
  offset: Vec3 | null;
}

export interface CombatMemory {
  readonly difficulty: BotDifficulty;
  readonly skill: BotSkill;
  readonly rng: () => number;
  tracked: Map<PlayerId, Tracked>;
  targetId: PlayerId | null;
  lastThink: number;
  /** Nothing until then: `spawn_time`. */
  activeAt: number;
  /** `after_target`: firing on at where they were. */
  after: { id: PlayerId; pos: Vec3; until: number } | null;
  semiUntil: number;
  lastAmmo: number;
  lastShotAt: number;
  throwUntil: number;
  throwAim: Vec3 | null;
  strafeDir: number;
  strafeUntil: number;
  jumpAt: number;
  dropUntil: number;
  /** Where it is walking, and the route it was given there. */
  walking: (Goal & { kind: "moveTo" }) | null;
  followId: PlayerId | null;
  followUntil: number;
  followRollAt: number;
  heardAt: number;
  stanceAt: number;
  crouch: boolean;
  sprintUntil: number;
  sprintRollAt: number;
}

export const combatBrain = defineBrain<CombatMemory>({
  id: COMBAT_BRAIN,
  period: THINK_PERIOD,
  init: (_self, rng, params) => {
    const difficulty = difficultyOf(params.difficulty);
    return {
      difficulty,
      skill: BOT_SKILLS[difficulty],
      rng,
      tracked: new Map(),
      targetId: null,
      lastThink: -Infinity,
      activeAt: 0,
      after: null,
      semiUntil: 0,
      lastAmmo: -1,
      lastShotAt: -Infinity,
      throwUntil: -Infinity,
      throwAim: null,
      strafeDir: 0,
      strafeUntil: -Infinity,
      jumpAt: -Infinity,
      dropUntil: -Infinity,
      walking: null,
      followId: null,
      followUntil: -Infinity,
      followRollAt: 0,
      heardAt: 0,
      stanceAt: 0,
      crouch: false,
      sprintUntil: -Infinity,
      sprintRollAt: 0,
    };
  },
  think: (ctx, self, memory) => thinkCombat(ctx, self, memory),
});

export function thinkCombat(ctx: BrainContext, self: BotSelf, memory: CombatMemory): Goal {
  const now = ctx.now;
  if (now - memory.lastThink > RESPAWN_GAP) {
    respawned(memory, now);
  }
  memory.lastThink = now;

  const feet = self.movement.feet;
  const eye: Vec3 = { x: feet.x, y: feet.y + eyeHeight(self.movement), z: feet.z };
  const weapon = ctx.state(self.id)?.weapon;
  const ammo = weapon?.ammo ?? 0;
  if (memory.lastAmmo >= 0 && ammo < memory.lastAmmo) {
    memory.lastShotAt = now;
  }
  memory.lastAmmo = ammo;

  if (now < memory.activeAt) {
    return IDLE;
  }

  // A grenade on its way out: the aim is held until it leaves the hand.
  if (now < memory.throwUntil && memory.throwAim) {
    return { kind: "look", point: memory.throwAim, aimAt: memory.throwAim, aimTime: memory.skill.aimTime, fire: false };
  }

  const ads = weapon?.ads ?? 0;
  updateTargets(ctx, self, eye, memory, ads, weapon?.weaponClass);
  listen(ctx, self, eye, memory);
  rollStance(memory, now);

  const aim = aimLoop(ctx, self, eye, memory, ads);
  return walkLoop(ctx, self, memory, aim);
}

/** Everything it knew is gone with its last life, and it waits out `spawn_time`. */
function respawned(memory: CombatMemory, now: number): void {
  memory.tracked.clear();
  memory.targetId = null;
  memory.after = null;
  memory.walking = null;
  memory.followId = null;
  memory.throwUntil = -Infinity;
  memory.dropUntil = -Infinity;
  memory.lastAmmo = -1;
  memory.activeAt = now + memory.skill.spawnTime;
}

/** `target_loop`. */
function updateTargets(ctx: BrainContext, self: BotSelf, eye: Vec3, memory: CombatMemory, ads: number, weaponClass: string | undefined): void {
  const { skill, tracked } = memory;
  const now = ctx.now;
  const fov = skill.fov * (1 - ADS_FOV_MULTI * ads);
  const forward = viewOf(self);
  let bestAt = -Infinity;
  let candidates: PlayerId[] = [];

  for (const player of ctx.players) {
    if (player.id === self.id) {
      continue;
    }
    const state = ctx.state(player.id);
    if (isTeammate(self, player.team) || !state?.alive) {
      tracked.delete(player.id);
      continue;
    }
    let obj = tracked.get(player.id);
    const height = state.eyeHeight ?? STAND_EYE_HEIGHT;
    const head = { x: state.feet.x, y: state.feet.y + height * AIM_HEIGHT.head, z: state.feet.z };
    const ankle = { x: state.feet.x, y: state.feet.y + height * AIM_HEIGHT.ankle, z: state.feet.z };
    // The cone first: it costs no trace. One already in sight stays so wherever it stands.
    const inCone = (obj !== undefined && obj.traceTime > 0) || coneDot(forward, eye, state.feet) >= fov;
    if (inCone && (ctx.hasLineOfSight(eye, head) || ctx.hasLineOfSight(eye, ankle))) {
      obj ??= track(memory, player.id, now);
      traced(memory, obj, state.feet, distanceTo(self.movement.feet, state.feet) * UNITS_PER_M, weaponClass, now);
    } else {
      if (!obj) {
        continue;
      }
      obj.noTraceTime += THINK_MS;
      obj.traceTime = 0;
      obj.didLook = false;
      if (obj.noTraceTime > skill.remember) {
        tracked.delete(player.id);
        continue;
      }
    }
    if ((now - obj.created) * 1000 < skill.initReact) {
      continue;
    }
    if (obj.seenAt > bestAt) {
      bestAt = obj.seenAt;
      candidates = [];
    }
    if (obj.seenAt === bestAt) {
      candidates.push(player.id);
    }
  }

  if (memory.targetId !== null && candidates.includes(memory.targetId)) {
    return;
  }
  let closest = Infinity;
  let next: PlayerId | null = null;
  for (const id of candidates) {
    const dist = tracked.get(id)!.dist;
    if (dist <= closest) {
      closest = dist;
      next = id;
    }
  }
  memory.targetId = next;
}

function track(memory: CombatMemory, id: PlayerId, now: number): Tracked {
  const obj: Tracked = {
    created: now,
    traceTime: 0,
    noTraceTime: 0,
    seenAt: now,
    lastSeen: { x: 0, y: 0, z: 0 },
    dist: 0,
    rand: Math.floor(memory.rng() * 100),
    didLook: false,
    bone: "spine",
    boneAt: -Infinity,
    offset: null,
  };
  memory.tracked.set(id, obj);
  return obj;
}

/** `targetObjUpdateTraced`. */
function traced(memory: CombatMemory, obj: Tracked, feet: Vec3, distUnits: number, weaponClass: string | undefined, now: number): void {
  obj.noTraceTime = 0;
  obj.traceTime += Math.trunc(THINK_MS * sightRate(memory.skill, weaponClass, distUnits));
  obj.dist = distUnits;
  obj.lastSeen = { ...feet };
  obj.seenAt = now;
}

/** What `aim_loop` decides: where to look, and what to press. Null `point`: look where it walks. */
interface Aim {
  point: Vec3 | null;
  fire: boolean;
  ads: boolean;
  melee: boolean;
  lethal: boolean;
  /** It has a target in sight and in range, and a round: `walk_loop` stands or strafes for that. */
  engaged: boolean;
}

/** `aim_loop`. */
function aimLoop(ctx: BrainContext, self: BotSelf, eye: Vec3, memory: CombatMemory, ads: number): Aim {
  const { skill } = memory;
  const now = ctx.now;
  const weapon = ctx.state(self.id)?.weapon;
  const weaponClass = weapon?.weaponClass;
  const hasRound = (weapon?.ammo ?? 0) > 0 && !isReloading(weapon?.state);
  const forward = viewOf(self);
  const idle: Aim = { point: null, fire: false, ads: false, melee: false, lethal: false, engaged: false };

  const obj = memory.targetId !== null ? memory.tracked.get(memory.targetId) : undefined;
  if (memory.targetId !== null && obj && obj.noTraceTime <= skill.noTraceLook) {
    const onAfter = memory.after?.id === memory.targetId && now < memory.after.until;

    // Out of sight: aim at where they were for a while, then perhaps a grenade there.
    if (obj.noTraceTime > 0 && !onAfter) {
      const point = { x: obj.lastSeen.x, y: obj.lastSeen.y + eyeHeight(self.movement), z: obj.lastSeen.z };
      if (obj.noTraceTime > skill.noTraceAds) {
        const aimAt = grenadeAim(ctx, eye, obj, point, skill);
        if (aimAt) {
          memory.throwAim = aimAt;
          memory.throwUntil = now + THROW_TIMES.frag.holdFire + THINK_PERIOD * 2;
          return { ...idle, point: aimAt, lethal: true };
        }
        return { ...idle, point };
      }
      return { ...idle, point, ads: hasRound && inRange(weaponClass, obj.dist) && canAds(weaponClass, obj.dist) };
    }

    if (obj.traceTime > 0) {
      const target = ctx.state(memory.targetId)!;
      const point = aimPoint(memory, obj, target, now);
      const cone = coneDot(forward, eye, point);
      if (cone > KNIFE_CONE && obj.dist < Math.min(BOT_RANGE.knife, KNIFE_REACH * UNITS_PER_M) && obj.traceTime > skill.reaction) {
        return { ...idle, point, melee: true, engaged: true };
      }
      if (!hasRound || !inRange(weaponClass, obj.dist)) {
        return { ...idle, point };
      }
      const wantsAds = canAds(weaponClass, obj.dist) && cone > ADS_CONE;
      let fire = false;
      if (obj.traceTime > skill.reaction) {
        memory.after = { id: memory.targetId, pos: { ...obj.lastSeen }, until: now + skill.shootAfter };
        fire = (!wantsAds || ads >= 1) && (cone > FIRE_CONE || obj.dist < BOT_RANGE.knife) && pullTrigger(ctx, self, eye, memory, point);
      }
      return { ...idle, point, ads: wantsAds, fire, engaged: true };
    }
  }

  // `after_target`: on at the last place they stood, dead or gone, for `shoot_after_time`.
  if (memory.after && now < memory.after.until) {
    const pos = memory.after.pos;
    const point = { x: pos.x, y: pos.y + eyeHeight(self.movement), z: pos.z };
    const dist = distanceTo(self.movement.feet, pos) * UNITS_PER_M;
    if (hasRound && inRange(weaponClass, dist)) {
      const cone = coneDot(forward, eye, point);
      const wantsAds = canAds(weaponClass, dist) && cone > ADS_CONE;
      const fire = (!wantsAds || ads >= 1) && (cone > AFTER_CONE || dist < BOT_RANGE.knife) && pullTrigger(ctx, self, eye, memory, point);
      return { ...idle, point, ads: wantsAds, fire };
    }
    return { ...idle, point };
  }
  memory.after = null;
  return idle;
}

/** `botFire`: an automatic is held; anything else is tapped, `semi_time` apart. Never with a friend on the line. */
function pullTrigger(ctx: BrainContext, self: BotSelf, eye: Vec3, memory: CombatMemory, point: Vec3): boolean {
  if (friendInLine(ctx, self, eye, point)) {
    return false;
  }
  const fireType = ctx.state(self.id)?.weapon?.fireType;
  if (fireType === undefined || /full auto/i.test(fireType)) {
    return true;
  }
  if (ctx.now < memory.semiUntil) {
    return false;
  }
  memory.semiUntil = ctx.now + memory.skill.semiTime;
  return true;
}

/** `updateBones`, `updateAimOffset` and `bot_lookat`'s lead: the point on them this look goes for. */
function aimPoint(memory: CombatMemory, obj: Tracked, target: { feet: Vec3; eyeHeight?: number; velocity?: Vec3 }, now: number): Vec3 {
  const { skill, rng } = memory;
  if (now - obj.boneAt >= skill.boneInterval) {
    obj.bone = skill.bones[Math.min(skill.bones.length - 1, Math.floor(rng() * skill.bones.length))]!;
    obj.boneAt = now;
  }
  if (!obj.offset) {
    const roll = () => u((rng() * 2 - 1) * skill.aimOffset);
    obj.offset = skill.aimOffset > 0 ? { x: roll(), y: roll(), z: roll() } : { x: 0, y: 0, z: 0 };
  }
  const span = skill.aimOffsetTime * 1000;
  const left = span > 0 && obj.traceTime < span ? 1 - obj.traceTime / span : 0;
  const lead = Math.max(Math.trunc(skill.aimTime * 20) - 1, 0) * THINK_PERIOD;
  const velocity = target.velocity ?? { x: 0, y: 0, z: 0 };
  const height = (target.eyeHeight ?? STAND_EYE_HEIGHT) * AIM_HEIGHT[obj.bone];
  return {
    x: target.feet.x + obj.offset.x * left + velocity.x * lead,
    y: target.feet.y + height + obj.offset.y * left + velocity.y * lead,
    z: target.feet.z + obj.offset.z * left + velocity.z * lead,
  };
}

/** `aim_loop`, a grenade: their `rand` says yes, there is room overhead at both ends, and they are 256 to 1024 units off. */
function grenadeAim(ctx: BrainContext, eye: Vec3, obj: Tracked, point: Vec3, skill: BotSkill): Vec3 | null {
  if (obj.rand > skill.nade || obj.dist <= BOT_RANGE.minGrenade || obj.dist >= BOT_RANGE.maxGrenade) {
    return null;
  }
  const overEye = { x: eye.x, y: eye.y + u(NADE_HEADROOM.self), z: eye.z };
  const overThem = { x: obj.lastSeen.x, y: obj.lastSeen.y + u(NADE_HEADROOM.target), z: obj.lastSeen.z };
  if (!ctx.hasLineOfSight(eye, overEye) || !ctx.hasLineOfSight(obj.lastSeen, overThem)) {
    return null;
  }
  // `nadeAimOffset`: the mod's `dist` here is the square of the distance, over 3000, in units up.
  return { x: point.x, y: point.y + u((obj.dist * obj.dist) / 3000), z: point.z };
}

/** `walk_loop`: where its feet go, with what `aim_loop` decided on top. */
function walkLoop(ctx: BrainContext, self: BotSelf, memory: CombatMemory, aim: Aim): Goal {
  const { skill } = memory;
  const now = ctx.now;
  const weapon = ctx.state(self.id)?.weapon;
  const reload = wantsReload(memory, weapon, now);
  const prone = now < memory.dropUntil;
  const hands = { fire: aim.fire, ads: aim.ads, melee: aim.melee, lethal: aim.lethal, crouch: memory.crouch, prone, reload };
  const aimed = aim.point ? { aimAt: aim.point, aimTime: lookTime(skill, weapon?.ads ?? 0) } : {};

  if (aim.lethal) {
    return { kind: "look", point: aim.point!, ...aimed, ...hands };
  }

  const obj = memory.targetId !== null ? memory.tracked.get(memory.targetId) : undefined;
  if (aim.engaged && obj && aim.point) {
    const jump = lookedUp(ctx, self, memory, obj);
    const strafing = obj.rand <= skill.strafe;
    if (strafing && now >= memory.strafeUntil) {
      memory.strafeDir = strafeSide(ctx, self, aim.point);
      memory.strafeUntil = now + STRAFE_TIME;
    }
    return { kind: "look", point: aim.point, ...aimed, ...hands, prone: now < memory.dropUntil, jump, ...(strafing ? { strafe: memory.strafeDir } : {}) };
  }

  const walk = walkGoal(ctx, self, memory, obj);
  if (!walk) {
    return aim.point ? { kind: "look", point: aim.point, ...aimed, ...hands } : { kind: "idle", reload };
  }
  return { ...walk, run: rollSprint(memory, now, aim), ...aimed, ...hands };
}

/** Where to walk: the last place a target was seen, else a teammate it follows, else a random node, kept until it is reached or blocked. */
function walkGoal(ctx: BrainContext, self: BotSelf, memory: CombatMemory, obj: Tracked | undefined): (Goal & { kind: "moveTo" }) | null {
  const feet = self.movement.feet;
  const blocked = self.motor.status === "noPath" || self.motor.status === "stuck";
  if (obj) {
    memory.walking = null;
    return { kind: "moveTo", point: obj.lastSeen };
  }
  rollFollow(ctx, self, memory);
  if (memory.followId !== null) {
    const mate = ctx.state(memory.followId);
    if (mate?.alive && ctx.now < memory.followUntil && !blocked) {
      return { kind: "moveTo", point: mate.feet };
    }
    memory.followId = null;
  }
  const held = memory.walking;
  if (held && !blocked && self.motor.status !== "arrived") {
    return held;
  }
  for (let i = 0; i < GOAL_TRIES; i++) {
    const point = ctx.nav.nodeFeet(Math.floor(memory.rng() * ctx.nav.nodeCount));
    const route = ctx.nav.route(feet, point);
    if (route) {
      memory.walking = { kind: "moveTo", point, route };
      return memory.walking;
    }
  }
  memory.walking = null;
  return null;
}

/** `bot_think_follow`: now and then, in a team game, a teammate within `help_dist` is followed for a while. */
function rollFollow(ctx: BrainContext, self: BotSelf, memory: CombatMemory): void {
  const { rng, skill } = memory;
  if (ctx.now < memory.followRollAt || memory.followId !== null) {
    return;
  }
  memory.followRollAt = ctx.now + FOLLOW_ROLL[0] + (FOLLOW_ROLL[1] - FOLLOW_ROLL[0]) * rng();
  if (self.team === undefined || rng() * 100 > skill.follow) {
    return;
  }
  const near = ctx.players.filter((p) => {
    const state = p.id !== self.id && isTeammate(self, p.team) ? ctx.state(p.id) : undefined;
    return state?.alive === true && distanceTo(self.movement.feet, state.feet) * UNITS_PER_M <= skill.helpDist;
  });
  if (near.length > 0) {
    memory.followId = near[Math.min(near.length - 1, Math.floor(rng() * near.length))]!.id;
    memory.followUntil = ctx.now + FOLLOW_TIME[0] + (FOLLOW_TIME[1] - FOLLOW_TIME[0]) * rng();
  }
}

/** `bot_listen_to_steps`: anyone running within earshot, from level 3, is known at once, and looked for where they are. */
function listen(ctx: BrainContext, self: BotSelf, eye: Vec3, memory: CombatMemory): void {
  if (memory.skill.base < LISTEN_LEVEL || ctx.now < memory.heardAt) {
    return;
  }
  memory.heardAt = ctx.now + 1;
  for (const player of ctx.players) {
    const state = player.id !== self.id && !isTeammate(self, player.team) ? ctx.state(player.id) : undefined;
    if (!state?.alive || memory.tracked.has(player.id)) {
      continue;
    }
    const speed = state.velocity ? Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z) * UNITS_PER_M : 0;
    const dist = distanceTo(self.movement.feet, state.feet) * UNITS_PER_M;
    if (speed < LISTEN_SPEED || dist > LISTEN_DIST) {
      continue;
    }
    const obj = track(memory, player.id, ctx.now - memory.skill.initReact / 1000);
    obj.lastSeen = { ...state.feet };
    obj.dist = dist;
    obj.noTraceTime = ctx.hasLineOfSight(eye, { x: state.feet.x, y: state.feet.y + (state.eyeHeight ?? STAND_EYE_HEIGHT), z: state.feet.z }) ? 0 : THINK_MS;
    return;
  }
}

/** `watchToLook`: as it first looks at someone, a jump if it strafes them and a drop if it does not. */
function lookedUp(ctx: BrainContext, self: BotSelf, memory: CombatMemory, obj: Tracked): boolean {
  if (obj.didLook) {
    return false;
  }
  obj.didLook = true;
  const { skill, rng } = memory;
  const now = ctx.now;
  const weaponClass = ctx.state(self.id)?.weapon?.weaponClass;
  // `level.bots_maxshotgundistance * 2` is on squares: 500 * sqrt(2) units.
  if (obj.dist > BOT_RANGE.maxShotgun * Math.SQRT2 || obj.dist <= BOT_RANGE.knife || weaponClass === "sniper") {
    return false;
  }
  if (rng() * 100 > skill.jump || now - memory.jumpAt <= JUMP_COOLDOWN) {
    return false;
  }
  memory.jumpAt = now;
  if (obj.rand <= skill.strafe) {
    return true;
  }
  if (obj.dist > BOT_RANGE.noAds) {
    memory.dropUntil = now + DROP_TIME;
  }
  return false;
}

/** `strafe`: the side with more room, of 500 units each way. A trace answers yes or no here, so it is asked at three lengths. */
function strafeSide(ctx: BrainContext, self: BotSelf, aim: Vec3): number {
  const feet = self.movement.feet;
  const dx = aim.x - feet.x;
  const dz = aim.z - feet.z;
  const h = Math.hypot(dx, dz) || 1;
  // Right of a player facing -z is +x: square to the line to the target.
  const rightX = -dz / h;
  const rightZ = dx / h;
  const from = { x: feet.x, y: feet.y + u(16), z: feet.z };
  const room = (side: number): number => {
    let reach = 0;
    for (const share of [0.25, 0.5, 1]) {
      const d = u(STRAFE_REACH) * share * side;
      if (!ctx.hasLineOfSight(from, { x: from.x + rightX * d, y: from.y, z: from.z + rightZ * d })) {
        break;
      }
      reach = share;
    }
    return reach;
  };
  return room(1) > room(-1) ? 1 : -1;
}

/** `stance_loop`: a roll to crouch, made each second where the mod makes it at each waypoint. */
function rollStance(memory: CombatMemory, now: number): void {
  if (now < memory.stanceAt) {
    return;
  }
  memory.stanceAt = now + STANCE_PERIOD;
  memory.crouch = memory.rng() * 100 < memory.skill.crouch;
}

/** `stance_loop`: a roll to sprint, standing and with nothing it could be shooting. */
function rollSprint(memory: CombatMemory, now: number, aim: Aim): boolean {
  if (aim.fire || aim.ads || memory.crouch || now < memory.dropUntil) {
    return false;
  }
  if (now < memory.sprintUntil) {
    return true;
  }
  if (now - memory.sprintUntil < SPRINT_GAP || now < memory.sprintRollAt) {
    return false;
  }
  memory.sprintRollAt = now + STANCE_PERIOD;
  if (memory.rng() * 100 > memory.skill.sprint) {
    return false;
  }
  memory.sprintUntil = now + SPRINT_TIME;
  return true;
}

/** Empty, or `reload_thread`: quiet for 2.5 s with no target and under half a magazine. */
function wantsReload(memory: CombatMemory, weapon: { ammo: number; clipSize: number; state: string } | undefined, now: number): boolean {
  if (!weapon || isReloading(weapon.state)) {
    return false;
  }
  if (weapon.ammo === 0) {
    return true;
  }
  return memory.targetId === null && now - memory.lastShotAt >= RELOAD_WAIT && weapon.ammo / weapon.clipSize < RELOAD_BELOW;
}

function isReloading(state: string | undefined): boolean {
  return state === "reloading" || state === "reloadStart" || state === "reloadEnd";
}

/** `aim_time`, longer down the sights (`ads_aimspeed_multi`). */
function lookTime(skill: BotSkill, ads: number): number {
  return skill.aimTime * (1 + ADS_AIM_MULTI * ads);
}

/** Where it is looking, as a unit vector: a player faces (-sin yaw, -cos yaw), pitch up positive. */
function viewOf(self: BotSelf): Vec3 {
  const { yaw, pitch } = self.movement;
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** `getConeDot`. */
function coneDot(forward: Vec3, from: Vec3, to: Vec3): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  return len > 0 ? (forward.x * dx + forward.y * dy + forward.z * dz) / len : 1;
}

/** Whether a living teammate stands between the eye and the point, within `FRIEND_CLEARANCE` of the line. */
function friendInLine(ctx: BrainContext, self: BotSelf, eye: Vec3, point: Vec3): boolean {
  if (self.team === undefined) {
    return false;
  }
  const dx = point.x - eye.x;
  const dy = point.y - eye.y;
  const dz = point.z - eye.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  for (const player of ctx.players) {
    if (player.id === self.id || !isTeammate(self, player.team)) {
      continue;
    }
    const state = ctx.state(player.id);
    if (!state?.alive) {
      continue;
    }
    const px = state.feet.x - eye.x;
    const py = state.feet.y + (state.eyeHeight ?? STAND_EYE_HEIGHT) * AIM_HEIGHT.spine - eye.y;
    const pz = state.feet.z - eye.z;
    const t = (px * dx + py * dy + pz * dz) / lengthSq;
    if (t > 0 && t < 1 && Math.hypot(px - t * dx, py - t * dy, pz - t * dz) < FRIEND_CLEARANCE) {
      return true;
    }
  }
  return false;
}

function isTeammate(self: BotSelf, team: string | undefined): boolean {
  return self.team !== undefined && team === self.team;
}

function distanceTo(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
