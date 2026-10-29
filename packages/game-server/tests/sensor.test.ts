import { describe, expect, it } from "vitest";
import { HEARTBEAT } from "@3d/shared/game/equipment.js";
import { sensedBy } from "../src/match/sensor.js";
import type { Roster } from "../src/match/roster.js";

/** Just enough of a member for the sensor: where they stand, their side, their perks, and what they hold. */
function member(id: string, x: number, side: number, options: { heartbeat?: boolean; assassin?: boolean; dead?: boolean } = {}) {
  return {
    id,
    player: {
      dead: options.dead ?? false,
      side,
      movement: { feet: { x, y: 0, z: 0 } },
      weapon: { def: { heartbeat: options.heartbeat ?? false } },
    },
    perks: { perk2: options.assassin ? "assassin" : "quickdraw", bonusPerks: new Set<string>() },
  };
}

function roster(...members: ReturnType<typeof member>[]): Roster {
  const byId = new Map(members.map((one) => [one.id, one]));
  return { get: (id: string) => byId.get(id) } as unknown as Roster;
}

describe("a heartbeat sensor", () => {
  const near = HEARTBEAT.range / 2;
  it("shows the living enemies in range who are not wearing Assassin, and nobody else", () => {
    const all = roster(
      member("me", 0, 0, { heartbeat: true }),
      member("friend", near, 0),
      member("enemy", near, 1),
      member("far", HEARTBEAT.range * 2, 1),
      member("hidden", near, 1, { assassin: true }),
      member("dead", near, 1, { dead: true }),
    );
    const players = ["me", "friend", "enemy", "far", "hidden", "dead"].map((id) => ({ id }));
    expect(sensedBy(all, "me", players)).toEqual([false, false, true, false, false, false]);
  });

  it("shows nothing to a player whose gun carries none", () => {
    const all = roster(member("me", 0, 0), member("enemy", near, 1));
    expect(sensedBy(all, "me", [{ id: "me" }, { id: "enemy" }])).toEqual([]);
  });
});
