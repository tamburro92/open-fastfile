// Who the two sides of a team game are on an MW3 map: its factions, by the names
// MW3 shows. "allies" and "axis" are MW3's own team ids (`game["allies"]`); the
// player never reads them, and sees the map's factions instead.
//
// The names are MW3's localized strings, in `localized_code_post_gfx_mp.ff`.
// Which faction a map fields is set by its own script, in its zone, and shows in
// the bodies that zone carries: each world's `assets/characters/cast.json` names
// them (`mp_body_delta_elite_*` is Delta Force, `mp_body_russian_military_*`
// Spetsnaz). A map whose allied side the zone dresses only as a ghillie sniper
// is told by the head, `head_ally_delta_sniper`.

import type { TeamId } from "./gametypes/declaration.js";

export type FactionId = "delta" | "sas" | "gign" | "spetsnaz" | "innercircle" | "africa_militia" | "pmc";

/** `MP_<FACTION>_NAME`, and `MP_GIGN` where MW3 has no `_NAME` for it. */
export const FACTION_NAMES: Readonly<Record<FactionId, string>> = {
  delta: "Delta Force", // MP_DELTA_NAME
  sas: "S.A.S", // MP_SAS_NAME
  gign: "GIGN", // MP_GIGN
  spetsnaz: "Spetsnaz", // MP_SPETSNAZ_NAME
  innercircle: "Inner Circle", // MP_INNERCIRCLE_NAME, worn as `opforce_henchmen`
  africa_militia: "Africa Militia", // MP_AFRICA_MILITIA_NAME
  pmc: "P.M.C.", // MP_PMC_NAME
};

/** Each MW3 world's two factions, from the bodies its zone carries. */
export const MAP_FACTIONS: Readonly<Record<string, { readonly allies: FactionId; readonly axis: FactionId }>> = {
  "alpha-mw3": { allies: "delta", axis: "spetsnaz" },
  "bootleg-mw3": { allies: "delta", axis: "pmc" },
  "bravo-mw3": { allies: "delta", axis: "africa_militia" },
  "carbon-mw3": { allies: "sas", axis: "africa_militia" },
  "dome-mw3": { allies: "delta", axis: "spetsnaz" },
  "exchange-mw3": { allies: "delta", axis: "spetsnaz" },
  "hardhat-mw3": { allies: "delta", axis: "spetsnaz" },
  "interchange-mw3": { allies: "delta", axis: "spetsnaz" },
  "lambeth-mw3": { allies: "delta", axis: "spetsnaz" },
  "mogadishu-mw3": { allies: "delta", axis: "africa_militia" },
  "paris-mw3": { allies: "gign", axis: "spetsnaz" },
  "plaza2-mw3": { allies: "sas", axis: "spetsnaz" },
  "radar-mw3": { allies: "delta", axis: "spetsnaz" },
  "seatown-mw3": { allies: "sas", axis: "innercircle" },
  "underground-mw3": { allies: "sas", axis: "spetsnaz" },
  "village-mw3": { allies: "delta", axis: "africa_militia" },
};

/** The name a side goes by on this map: its faction's on an MW3 map, else the side's own id, capitalised. */
export function teamName(map: string | undefined, team: TeamId): string {
  const factions = map === undefined ? undefined : MAP_FACTIONS[map];
  const faction = factions && (team === "allies" || team === "axis") ? factions[team] : undefined;
  return faction ? FACTION_NAMES[faction] : team.charAt(0).toUpperCase() + team.slice(1);
}
