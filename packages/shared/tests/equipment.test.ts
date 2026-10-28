// The grenade table is MW3's numbers, and this is what keeps it so: wherever the
// catalogue's equipment has been exported (`catalog --equipment-only`), every
// number in game/equipment.ts is held to the weapon file it was copied from
// (worlds/catalog/equipment/iw5/). A checkout with no catalogue built skips, as
// the other catalogue tests do.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLASHBANG_FULL_RADIUS,
  FLASHBANG_RADIUS,
  FUSE,
  GRENADE_BLAST,
  GRENADE_BOUNCE,
  GRENADE_THROW_LOFT,
  GRENADE_THROW_SPEED,
  grenadeBounce,
  THROW_TIMES,
} from "../src/game/equipment.js";
import type { SurfaceType } from "../src/sim/surfaces.js";
import { UNIT } from "../src/sim/units.js";

const ROOT = path.resolve(import.meta.dirname, "../../../worlds/catalog/equipment/iw5");
const FILES = { frag: "frag_grenade_mp", semtex: "semtex_mp", flashbang: "flash_grenade_mp" } as const;

interface Exported {
  [key: string]: unknown;
  bounce: { parallel: Record<string, number>; perpendicular: Record<string, number> };
}

function exported(id: string): Exported | null {
  const file = path.join(ROOT, id, `${id}.json`);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as { equipment: Exported }).equipment : null;
}

const units = (metres: number): number => Math.round(metres / UNIT);

describe("the grenade table", () => {
  for (const [kind, id] of Object.entries(FILES) as [keyof typeof FILES, string][]) {
    const file = exported(id);
    it.skipIf(file === null)(`${kind} is thrown, flies, bounces and goes off by ${id}`, () => {
      const n = (key: string) => Number(file![key]);
      expect(FUSE[kind]).toBe(n("fuseTime"));
      expect(THROW_TIMES[kind]).toEqual({ holdFire: n("holdFireTime"), fire: n("fireTime") });
      expect(units(GRENADE_THROW_SPEED)).toBe(n("projectileSpeed"));
      expect(units(GRENADE_THROW_LOFT)).toBe(n("projectileSpeedUp"));
      if (kind === "flashbang") {
        expect(units(FLASHBANG_RADIUS)).toBe(n("explosionRadius"));
        expect(units(FLASHBANG_FULL_RADIUS)).toBe(n("explosionRadiusMin"));
      } else {
        expect([units(GRENADE_BLAST.radius), GRENADE_BLAST.inner, GRENADE_BLAST.outer]).toEqual([
          n("explosionRadius"),
          n("explosionInnerDamage"),
          n("explosionOuterDamage"),
        ]);
      }
      for (const [surface, parallel] of Object.entries(file!.bounce.parallel)) {
        expect(grenadeBounce(surface as SurfaceType), surface).toEqual({ parallel, perpendicular: file!.bounce.perpendicular[surface] });
      }
    });
  }

  it("falls back to the default for a surface the files do not name", () => {
    expect(grenadeBounce("tallgrass")).toEqual(GRENADE_BOUNCE.default);
  });
});
