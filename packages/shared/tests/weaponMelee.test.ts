// The knife, as a state of the weapon in hand: its clip, its `meleeTime`, and
// nothing else from the gun meanwhile. MW3's tactical knife is the same stab,
// quicker (0.529 s against 0.8 s), on a clip of its own.

import { describe, expect, it } from "vitest";
import { WeaponController } from "../src/sim/weapon.js";
import { weaponDef } from "../testing/weaponDef.js";

function knifeGun(meleeTime: number): WeaponController {
  const base = weaponDef();
  const weapon = new WeaponController({
    ...base,
    roles: { ...base.roles, melee: "knife" },
    clips: { ...base.clips, knife: { duration: 0.9, looped: false, notes: [] } },
    times: { ...base.times, melee: meleeTime },
  });
  weapon.ready();
  return weapon;
}

const step = (weapon: WeaponController, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) {
    weapon.update(1 / 60);
  }
};

describe("a stab", () => {
  it("plays the knife and holds the gun for its meleeTime", () => {
    const weapon = knifeGun(0.529);
    expect(weapon.melee()).toBe(true);
    expect(weapon.data.state).toBe("meleeing");
    expect(weapon.data.clip?.role).toBe("melee");
    weapon.setInput({ trigger: true });
    step(weapon, 0.5);
    expect(weapon.data.ammo).toBe(weapon.def.clipSize);
    expect(weapon.melee()).toBe(false);
    step(weapon, 0.05);
    expect(weapon.data.state).not.toBe("meleeing");
  });

  it("cuts a reload short before its rounds went in, as a weapon change does", () => {
    const weapon = knifeGun(0.8);
    weapon.setInput({ trigger: true });
    step(weapon, 0.3);
    weapon.setInput({ trigger: false });
    const left = weapon.data.ammo;
    weapon.reload();
    step(weapon, 0.2);
    expect(weapon.melee()).toBe(true);
    step(weapon, 1);
    expect(weapon.data.ammo).toBe(left);
  });
});
