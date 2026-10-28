import { enumOf, struct, uint, type Codec } from "../codec/schema.js";
import { PROJECTILE_KINDS, type ProjectileKind, type ProjectileState } from "../../sim/projectile.js";
import { vec3 } from "./fields.js";

/** About fourteen bytes: an id, a kind and a position. No velocity, since a client interpolates and never predicts one. */
export const projectileStateSchema = struct({
  id: uint(12),
  kind: enumOf(PROJECTILE_KINDS) as Codec<ProjectileKind>,
  position: vec3,
}) satisfies Codec<ProjectileState>;

/** Four bits of count: fifteen grenades in the air at once is more than a lobby throws. */
export const PROJECTILE_COUNT_BITS = 4;
export const MAX_SNAPSHOT_PROJECTILES = 2 ** PROJECTILE_COUNT_BITS - 1;
