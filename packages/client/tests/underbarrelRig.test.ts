// @vitest-environment happy-dom
// Every underbarrel half of every MW3 weapon, built as the game builds it, from
// the real catalogue. A rig that refuses to build takes the player's hands and
// gun with it, and only says so in the console. Skips without a catalogue.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { resolveAlt, resolveWeapon, type WeaponEntry } from "@3d/shared/sim/weaponRegistry.js";
import type { GltfAsset } from "../src/scene/assets.js";
import { buildViewmodelRig } from "../src/scene/viewmodel.js";

const CATALOG = path.resolve(import.meta.dirname, "../../../worlds/catalog");
const WEAPONS = path.join(CATALOG, "weapons/iw5");
const HANDS = path.join(CATALOG, "viewhands/iw5/viewhands_delta/viewhands_delta.glb");
const built = fs.existsSync(WEAPONS) && fs.existsSync(HANDS);

async function load(file: string): Promise<GltfAsset> {
  const bytes = fs.readFileSync(file);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return { scene: gltf.scene, clips: gltf.animations };
}

describe.skipIf(!built)("the rig of a weapon's underbarrel half", () => {
  it("builds for every attachment of every weapon, and for what MW3 authors as still clips", async () => {
    const hands = await load(HANDS);
    const failed: string[] = [];
    let halves = 0;
    for (const id of fs.readdirSync(WEAPONS)) {
      const entry = JSON.parse(fs.readFileSync(path.join(WEAPONS, id, `${id}.json`), "utf8")) as WeaponEntry;
      const gun = await load(path.join(WEAPONS, id, `${id}.glb`));
      const defs = [resolveWeapon(entry, [])];
      entry.attachments.forEach((attachment, slot) => {
        const alt = attachment.alt ? resolveAlt(entry, [slot]) : null;
        if (alt) {
          defs.push(alt.def);
          halves++;
        }
      });
      for (const def of defs) {
        try {
          buildViewmodelRig(gun, hands, { def });
        } catch (e) {
          failed.push(`${id}: ${(e as Error).message}`);
        }
      }
    }
    expect(failed).toEqual([]);
    expect(halves).toBeGreaterThan(0);
  }, 300000);

  it("still refuses a clip of any length that the file should hold and does not", async () => {
    const gun = await load(path.join(WEAPONS, "iw5_m4_mp/iw5_m4_mp.glb"));
    const hands = await load(HANDS);
    const entry = JSON.parse(fs.readFileSync(path.join(WEAPONS, "iw5_m4_mp/iw5_m4_mp.json"), "utf8")) as WeaponEntry;
    const def = resolveWeapon(entry, []);
    const broken = {
      ...def,
      roles: { ...def.roles, fire: "nothing_like_it" },
      clips: { ...def.clips, nothing_like_it: { duration: 0.5, looped: false, notes: [] } },
    };
    expect(() => buildViewmodelRig(gun, hands, { def: broken })).toThrow(/not in the file/);
  });
});
