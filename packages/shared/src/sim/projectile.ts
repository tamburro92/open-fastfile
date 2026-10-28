// A thrown piece of equipment, as both ends see it.
//
// The server owns the flight (game-server/src/match/projectiles.ts) and says where
// each one is on every snapshot, as it says where an actor is: a grenade in the air
// is state, not something that happened, so a lost datagram is repaired by the
// next one rather than by a client re-simulating a throw it can only guess at.
// Only the detonation is an event (net/messages/events.ts), because nothing later
// in the stream mentions it.

import type { Vec3 } from "./capsule.js";

/** The order is the format: a kind travels as its index. */
export const PROJECTILE_KINDS = ["frag", "semtex", "flashbang"] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];

/** What can go off: every projectile, and a killstreak's missile, which is never drawn in flight. */
export const DETONATION_KINDS = [...PROJECTILE_KINDS, "missile"] as const;
export type DetonationKind = (typeof DETONATION_KINDS)[number];

/** Twelve bits on the wire: the server wraps its counter there. */
export const PROJECTILE_ID_MASK = 0xfff;

/** One projectile on one tick. Appearing is a throw and disappearing a detonation or a despawn. */
export interface ProjectileState {
  id: number;
  kind: ProjectileKind;
  position: Vec3;
}

/** Inside this, a live frag or semtex is shown to a player as a danger indicator. */
export const GRENADE_DANGER_RADIUS = 8.0;
