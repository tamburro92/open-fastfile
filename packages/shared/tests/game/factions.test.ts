// The two sides' names on an MW3 map: its factions, from the bodies its zone carries.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FACTION_NAMES, MAP_FACTIONS, teamName, type FactionId } from "../../src/game/factions.js";

const WORLDS = path.resolve(import.meta.dirname, "../../../../worlds");

/** A body's or a head's file name, as the faction that wears it. */
const WORN: readonly [RegExp, FactionId][] = [
  [/delta/, "delta"],
  [/sas_/, "sas"],
  [/gign/, "gign"],
  [/russian_military/, "spetsnaz"],
  [/henchmen/, "innercircle"],
  [/africa_militia/, "africa_militia"],
  [/pmc_/, "pmc"],
];

function wornBy(file: string): FactionId | undefined {
  return WORN.find(([pattern]) => pattern.test(file))?.[1];
}

describe("team names", () => {
  it("are the map's MW3 factions, by MW3's own strings", () => {
    expect(teamName("dome-mw3", "allies")).toBe("Delta Force");
    expect(teamName("dome-mw3", "axis")).toBe("Spetsnaz");
    expect(teamName("seatown-mw3", "allies")).toBe("S.A.S");
    expect(teamName("seatown-mw3", "axis")).toBe("Inner Circle");
    expect(teamName("paris-mw3", "allies")).toBe("GIGN");
    expect(teamName("bootleg-mw3", "axis")).toBe("P.M.C.");
    expect(teamName("village-mw3", "axis")).toBe("Africa Militia");
  });

  it("fall back to the side's own id on a map with no factions", () => {
    expect(teamName("theater-bo1", "allies")).toBe("Allies");
    expect(teamName(undefined, "axis")).toBe("Axis");
    expect(teamName("dome-mw3", "horde")).toBe("Horde");
  });

  it("name a faction for every faction id", () => {
    for (const factions of Object.values(MAP_FACTIONS)) {
      expect(FACTION_NAMES[factions.allies]).toBeTruthy();
      expect(FACTION_NAMES[factions.axis]).toBeTruthy();
    }
  });

  // Each world's cast names the bodies its zone carries: the table must agree with them.
  const worlds = fs.existsSync(WORLDS) ? fs.readdirSync(WORLDS).filter((w) => w.endsWith("-mw3")) : [];
  for (const world of worlds) {
    const cast = path.join(WORLDS, world, "assets", "characters", "cast.json");
    const sides = fs.existsSync(cast) ? (JSON.parse(fs.readFileSync(cast, "utf8")) as { characters: { side: string; body: string; head: string }[] }).characters : [];
    const both = sides.some((c) => c.side === "allies") && sides.some((c) => c.side === "axis");
    it.runIf(both)(`${world}: the table agrees with the bodies its zone carries`, () => {
      for (const c of sides) {
        const faction = wornBy(path.basename(c.body)) ?? wornBy(path.basename(c.head));
        expect(MAP_FACTIONS[world]?.[c.side as "allies" | "axis"]).toBe(faction);
      }
    });
  }
});
