// What a script or a brain is handed: the match as it stands, read live.
//
// Built once per match rather than per call. Every field that changes — the
// clock, the roster, a player's points — is a getter or a function over the
// match itself, so a context kept from one hook to the next reads today's state,
// and asking a hook costs nothing to set up. Composed with `extend` rather than
// spread, because a spread reads a getter once and keeps the value.

import type { ResolvedWorld } from "@3d/shared/dsl/resolved.js";
import type { BrainContext } from "@3d/shared/game/bots/brain.js";
import type { NavPlanner } from "@3d/shared/game/bots/planner.js";
import type { CatalogueView } from "@3d/shared/game/catalogueView.js";
import type { GameView, ServerContext } from "@3d/shared/game/context.js";
import type { GametypeDecl } from "@3d/shared/game/gametypes/declaration.js";
import { hashString } from "@3d/shared/game/random.js";
import { presentNamed, type Presence } from "@3d/shared/worlds/presence.js";
import type { WorldIndex } from "@3d/shared/worlds/worldIndex.js";
import type { MatchClock } from "./clock.js";
import type { Roster } from "./roster.js";
import type { Scores } from "./scores.js";

import type { CapsuleWorld, Vec3 } from "@3d/shared/sim/capsule.js";

/** Everything a server context says beyond the view: the verbs, the world a script may change, and the nav. */
export type ServerVerbs = Omit<ServerContext, Exclude<keyof GameView, "world"> | "memory">;

/** What a view reads. */
export interface ViewSource {
  readonly world: ResolvedWorld;
  readonly index: WorldIndex;
  readonly map: string;
  readonly gametype: GametypeDecl;
  readonly catalogue: CatalogueView;
  readonly clock: MatchClock;
  readonly roster: Roster;
  /** The applied presence, which is what the snapshot carries. */
  readonly presence: Presence;
  readonly scores: Scores;
}

/** What every script sees, on either end: the one object a match hands the hooks both ends run. */
export function gameView(src: ViewSource): GameView {
  const { clock, roster } = src;
  return {
    world: src.index,
    game: src.world.game,
    map: src.map,
    gametype: src.gametype,
    catalogue: src.catalogue,
    get now() {
      return clock.now;
    },
    seed: hashString(src.map),
    get players() {
      return roster.views();
    },
    player: (id) => {
      const member = roster.get(id);
      return member === undefined ? undefined : roster.view(member);
    },
    // The applied presence, which is what the snapshot carries: a hook both ends
    // run reads the same bits here as a browser does.
    isPresent: (tagOrName) => presentNamed(src.index, src.presence, tagOrName),
    counter: (name) => src.scores.counter(name),
  };
}

export interface BotContextOptions {
  readonly botsEnabled?: boolean;
  readonly botCount?: number;
  readonly botDifficulty?: "recruit" | "regular" | "hardened" | "veteran";
  readonly friendlyBots?: number;
  readonly enemyBots?: number;
}

/** A server hook's context: the view, the verbs, and the calling script's own state. */
export function serverContext(
  view: GameView,
  verbs: ServerVerbs,
  memory: unknown,
  scoreLimit?: number,
  timeLimitSeconds?: number,
  botOptions?: BotContextOptions,
): ServerContext {
  return extend(extend(view, verbs), {
    memory,
    scoreLimit,
    timeLimitSeconds,
    botsEnabled: botOptions?.botsEnabled,
    botCount: botOptions?.botCount,
    botDifficulty: botOptions?.botDifficulty,
    friendlyBots: botOptions?.friendlyBots,
    enemyBots: botOptions?.enemyBots,
  });
}

/**
 * What a brain sees: the view, where everyone is, and the graph it plans on.
 * Reads only. One per planner for the life of the match: the bots plan on one
 * graph and the actors on the other.
 */
export class BrainContexts {
  private readonly made = new Map<NavPlanner, BrainContext>();

  constructor(
    private readonly view: GameView,
    private readonly roster: Roster,
    private readonly collision?: CapsuleWorld,
  ) {}

  on(nav: NavPlanner): BrainContext {
    let context = this.made.get(nav);
    if (!context) {
      context = extend(this.view, {
        state: (id: string) => this.roster.stateOf(id),
        nav,
        hasLineOfSight: (from: Vec3, to: Vec3): boolean => {
          if (!this.collision) {
            return true;
          }
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const dz = to.z - from.z;
          const dist = Math.hypot(dx, dy, dz);
          if (dist <= 0.05) {
            return true;
          }
          const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
          const hit = this.collision.traceRay(from, dir, dist, "shots");
          if (!hit) {
            return true;
          }
          return hit.distance >= dist - 0.1;
        },
      });
      this.made.set(nav, context);
    }
    return context;
  }
}

/** `base` with `more`'s properties over it, getters kept as getters. */
function extend<A extends object, B extends object>(base: A, more: B): Omit<A, keyof B> & B {
  const out = Object.defineProperties({}, Object.getOwnPropertyDescriptors(base));
  return Object.defineProperties(out, Object.getOwnPropertyDescriptors(more)) as Omit<A, keyof B> & B;
}
