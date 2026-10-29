// A heartbeat sensor's screen, decided here and drawn by the client.
//
// Who it shows is the server's to say rather than the client's to work out,
// although every position is in the snapshot already: Assassin hides a player
// from it, and a perk is not something the wire tells anybody about.

import type { PlayerId } from "@3d/shared/net/messages/fields.js";
import { HEARTBEAT } from "@3d/shared/game/equipment.js";
import type { Roster } from "./roster.js";

/**
 * Which of `players` `viewer`'s sensor shows them, in that order; empty unless the
 * gun in their hands carries one. Enemies only, living, inside its range, and not
 * wearing Assassin.
 */
export function sensedBy(roster: Roster, viewer: PlayerId, players: readonly { id: PlayerId }[]): boolean[] {
  const member = roster.get(viewer);
  if (!member || member.player.dead || member.player.weapon?.def.heartbeat !== true) {
    return [];
  }
  const side = member.player.side;
  const at = member.player.movement.feet;
  return players.map(({ id }) => {
    const other = roster.get(id);
    if (!other || other.id === viewer || other.player.dead || (side !== null && other.player.side === side)) {
      return false;
    }
    if (other.perks.perk2 === "assassin" || other.perks.bonusPerks.has("assassin")) {
      return false;
    }
    const feet = other.player.movement.feet;
    return Math.hypot(feet.x - at.x, feet.y - at.y, feet.z - at.z) <= HEARTBEAT.range;
  });
}
