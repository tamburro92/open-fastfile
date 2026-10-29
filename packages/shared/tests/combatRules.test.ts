// What a round costs, as MW3's server works it out (iw5mp_server.exe): the
// weapon's falloff truncated to a whole number, then what penetration left of
// it truncated, then the location truncated, never under 1 on a body — and then
// this engine's own gametype scale.
//
// Every fixture is away from 1 where it can be, so a reader that dropped a factor
// gets a different number rather than the same one.

import { describe, expect, it } from "vitest";
import { DEFAULT_COMBAT_RULES, rangeDamage, shotDamage, UNSPECIFIED_DAMAGE, type CombatRules } from "../src/game/rules.js";
import { UNIT } from "../src/sim/units.js";
import type { WeaponDef } from "../src/sim/weaponDef.js";
import { weaponDef } from "../testing/weaponDef.js";

/** Full damage to 10 m, minimum past 30 m, written in the CoD units a weapon file spells them in. */
const NEAR = 10;
const FAR = 30;

const armed = (over: Partial<WeaponDef> = {}): WeaponDef =>
  weaponDef({
    damage: { max: 40, min: 20, maxRange: NEAR / UNIT, minRange: FAR / UNIT },
    locationDamage: { head: 1.5, torsoUpper: 0.8, gun: 0 },
    ...over,
  });

const rules: CombatRules = DEFAULT_COMBAT_RULES;

describe("what a round's range leaves it", () => {
  it("is the maximum inside maxRange, the minimum from minRange on, and a truncated line between", () => {
    const def = armed();
    expect(rangeDamage(def, 0)).toBe(40);
    expect(rangeDamage(def, NEAR - 0.01)).toBe(40);
    expect(rangeDamage(def, FAR)).toBe(20);
    expect(rangeDamage(def, 200)).toBe(20);
    // A quarter of the way: 35 exactly, and a hair further is 34 — truncated, never rounded.
    expect(rangeDamage(def, NEAR + (FAR - NEAR) / 4)).toBe(35);
    expect(rangeDamage(def, NEAR + (FAR - NEAR) / 4 + 0.01)).toBe(34);
  });

  it("reads the ranges as CoD units: read as metres, 30 m would sit inside the window", () => {
    expect(rangeDamage(armed(), 30)).toBe(20);
  });

  it("has no falloff where max and min agree, and is the minimum past an inverted window's far end", () => {
    expect(rangeDamage(weaponDef({ damage: { max: 55 } }), 500)).toBe(55);
    // The game's own order of tests: inside maxRange is max, at or past minRange is min.
    const inverted = weaponDef({ damage: { max: 40, min: 20, maxRange: 1000, minRange: 400 } });
    expect(rangeDamage(inverted, 30 * UNIT)).toBe(40);
    expect(rangeDamage(inverted, 50)).toBe(20);
  });
});

describe("what a round costs", () => {
  it("truncates the location's product, as the game's float multiplier lands it", () => {
    // trunc(0.8f × 40) = 32; trunc(1.5f × 40) = 60.
    expect(shotDamage(armed(), "torsoUpper", 5, rules)).toBe(32);
    expect(shotDamage(armed(), "head", 5, rules)).toBe(60);
    // A location the weapon file did not mention is 1.
    expect(shotDamage(armed(), "neck", 5, rules)).toBe(40);
  });

  it("makes an ACR's head 62 and not 63, because 1.4 is a float in the game", () => {
    const acr = weaponDef({ damage: { max: 45, min: 30, maxRange: 1000, minRange: 1500 }, locationDamage: { head: 1.4 } });
    expect(shotDamage(acr, "head", 5, rules)).toBe(62);
  });

  it("costs at least 1 on a body, even where the weapon scores the location at 0", () => {
    // The player damage path clamps whatever reached a body to 1.
    expect(shotDamage(armed(), "gun", 5, rules)).toBe(1);
  });

  it("truncates what penetration left of it before the location, and costs nothing once that is 0", () => {
    // trunc(0.5f × 40) = 20, then trunc(0.8f × 20) = 16.
    expect(shotDamage(armed(), "torsoUpper", 5, rules, 0.5)).toBe(16);
    // trunc(0.02 × 40) = 0: nothing reached them, so not even the 1.
    expect(shotDamage(armed(), "torsoUpper", 5, rules, 0.02)).toBe(0);
  });

  it("gives a weapon that declared no ballistics an ordinary rifle's damage rather than none", () => {
    const silent = weaponDef();
    expect(silent.damage).toBeUndefined();
    expect(shotDamage(silent, "torsoUpper", 5, rules)).toBe(UNSPECIFIED_DAMAGE);
    expect(shotDamage(undefined, "torsoUpper", 500, rules)).toBe(UNSPECIFIED_DAMAGE);
  });

  it("applies the gametype's scale last", () => {
    expect(shotDamage(armed(), "torsoUpper", 5, { ...rules, damageScale: 0.5 })).toBe(16);
  });
});
