import { bool, enumOf, struct, uint, type Codec } from "../codec/schema.js";
import { KILLSTREAK_IDS, STRIKE_PACKAGE_IDS, type SentryState, type StreakState } from "../../game/streaks.js";
import { pitch, playerId, vec3, yaw } from "./fields.js";
import type { KillstreakId, StrikePackageId } from "../../sim/loadout.js";

/** Three of one thing, in order: a package always holds exactly three slots. */
function three<T>(inner: Codec<T>): Codec<[T, T, T]> {
  return {
    write(w, value) {
      inner.write(w, value[0]);
      inner.write(w, value[1]);
      inner.write(w, value[2]);
    },
    read(r) {
      return [inner.read(r), inner.read(r), inner.read(r)];
    },
  };
}

const streakId = enumOf(KILLSTREAK_IDS) as Codec<KillstreakId>;

/** About three bytes. Six bits of progress: the dearest streak is fifteen kills, and the count is clamped there. */
export const streakStateSchema = struct({
  package: enumOf(STRIKE_PACKAGE_IDS) as Codec<StrikePackageId>,
  streaks: three(streakId),
  ready: three(bool),
  progress: uint(6),
  hardline: bool,
}) satisfies Codec<StreakState>;

export const MAX_STREAK_PROGRESS = 2 ** 6 - 1;

/** About twenty-five bytes: who owns it is what tells a client whose side it is on. */
export const sentryStateSchema = struct({
  id: uint(8),
  owner: playerId,
  position: vec3,
  facing: yaw,
  yaw,
  pitch,
  firing: bool,
}) satisfies Codec<SentryState>;

/** Three bits of count: seven sentries at once is a lobby of nothing else. */
export const SENTRY_COUNT_BITS = 3;
export const MAX_SNAPSHOT_SENTRIES = 2 ** SENTRY_COUNT_BITS - 1;
