// The HUD map: a world's `minimap` image, and where the player stands on it,
// as the plain numbers the UI lays out (ui/hud/Minimap.tsx).

import type { ResolvedMinimap } from "@3d/shared/dsl/resolved.js";
import type { MinimapAlly, MinimapInfo, MinimapPose } from "./uiBridge.js";

/** The image, and its size as a fraction of the HUD map, which spans twice `range`. */
export function minimapInfo(map: ResolvedMinimap, baseUrl: string): MinimapInfo {
  return { image: baseUrl + map.source, width: map.width / (2 * map.range), height: map.depth / (2 * map.range) };
}

/**
 * The player at ground point (x, z), looking along `yaw`, on `map`'s image.
 * The image's right and top are rotateY of east (1, 0) and north (0, -1) by
 * its rotation; turning the image by yaw minus that rotation puts the
 * player's heading at the top.
 */
export function minimapPose(map: ResolvedMinimap, x: number, z: number, yaw: number): MinimapPose {
  const dx = x - map.center.x;
  const dz = z - map.center.z;
  const s = Math.sin(map.rotation);
  const c = Math.cos(map.rotation);
  const right = dx * c - dz * s;
  const up = -dx * s - dz * c;
  return { u: 0.5 + right / map.width, v: 0.5 - up / map.depth, rotation: yaw - map.rotation };
}

/**
 * Normalized (u, v) coordinates [0..1] on `map`'s image for any ground point (x, z).
 * Used for placing radar blips / gunfire pings on the minimap.
 */
export function minimapPoint(map: ResolvedMinimap, x: number, z: number): { u: number; v: number } {
  const dx = x - map.center.x;
  const dz = z - map.center.z;
  const s = Math.sin(map.rotation);
  const c = Math.cos(map.rotation);
  const right = dx * c - dz * s;
  const up = -dx * s - dz * c;
  return { u: 0.5 + right / map.width, v: 0.5 - up / map.depth };
}

/**
 * A teammate's arrow, drawn on the image. The image is turned by the local
 * player's pose so they face up, and turns the arrow with it: turned back by its
 * own pose, an ally facing the way the player faces points up too.
 */
export function minimapAlly(map: ResolvedMinimap, id: string, x: number, z: number, yaw: number): MinimapAlly {
  const { u, v, rotation } = minimapPose(map, x, z, yaw);
  return { id, u, v, rotation: -rotation };
}
