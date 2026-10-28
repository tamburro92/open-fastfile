// Gunfire radar sound pings on the minimap, matching Call of Duty: Modern Warfare 3.
//
// In MW3:
// - Firing a weapon without a silencer / suppressor creates a red sound ping on the radar.
// - The ping appears at the shooter's world coordinates on the minimap.
// - Duration is governed by `compassSoundPingFadeTime` (2.0 seconds).
// - Successive shots refresh the ping's position and timer.
// - Firing with a silencer fitted produces no sound ping (stealth).

import type { ResolvedMinimap } from "@3d/shared/dsl/resolved.js";
import { minimapPoint } from "./minimap.js";
import type { MinimapPing, UiState } from "./uiBridge.js";

/** Call of Duty `compassSoundPingFadeTime`: 2.0 seconds. */
export const PING_DURATION_MS = 2000;
/** How long the ping stays fully opaque before fading out: 1.2 seconds. */
export const PING_SOLID_MS = 1200;
/** A UAV sweeps on this period, and what it saw fades between sweeps as a ping does. */
export const UAV_SWEEP_MS = 2000;

interface ActivePing {
  id: string;
  u: number;
  v: number;
  createdAt: number;
  isEnemy: boolean;
  isSelf: boolean;
}

export class Radar {
  private readonly active = new Map<string, ActivePing>();
  private lastSweep = -Infinity;

  constructor(private readonly ui: UiState) {}

  /**
   * Record a shot fired without a silencer.
   * If the shooter already had an active ping, their position and duration are refreshed.
   */
  record(id: string, worldPos: { x: number; z: number }, isEnemy: boolean, isSelf: boolean, map: ResolvedMinimap, now: number = performance.now()): void {
    const { u, v } = minimapPoint(map, worldPos.x, worldPos.z);
    this.active.set(id, {
      id,
      u,
      v,
      createdAt: now,
      isEnemy,
      isSelf,
    });
    this.publish(now);
  }

  /**
   * The enemies a UAV shows, marked once a sweep: between sweeps they fade where
   * they were, as MW3's radar does, rather than tracking every step.
   */
  sweep(targets: readonly { id: string; feet: { x: number; z: number } }[], map: ResolvedMinimap, now: number = performance.now()): void {
    if (targets.length === 0) {
      this.lastSweep = -Infinity;
      return;
    }
    if (now - this.lastSweep < UAV_SWEEP_MS) {
      return;
    }
    this.lastSweep = now;
    for (const target of targets) {
      this.record(`uav:${target.id}`, target.feet, true, false, map, now);
    }
  }

  /**
   * Advance the fade clock and clean expired pings.
   * Called every frame from presenters.
   */
  update(now: number = performance.now()): void {
    if (this.active.size === 0) {
      if (this.ui.minimap.pings.value.length > 0) {
        this.ui.minimap.pings.value = [];
      }
      return;
    }
    let expired = false;
    for (const [id, ping] of this.active) {
      if (now - ping.createdAt >= PING_DURATION_MS) {
        this.active.delete(id);
        expired = true;
      }
    }
    if (expired && this.active.size === 0) {
      this.ui.minimap.pings.value = [];
      return;
    }
    this.publish(now);
  }

  /** Clear all active pings (world unload, match end). */
  clear(): void {
    if (this.active.size > 0 || this.ui.minimap.pings.value.length > 0) {
      this.active.clear();
      this.ui.minimap.pings.value = [];
    }
  }

  private publish(now: number): void {
    const pings: MinimapPing[] = [];
    const fadeSpan = PING_DURATION_MS - PING_SOLID_MS;
    for (const ping of this.active.values()) {
      const elapsed = now - ping.createdAt;
      const alpha = elapsed < PING_SOLID_MS ? 1 : Math.max(0, 1 - (elapsed - PING_SOLID_MS) / fadeSpan);
      pings.push({
        id: ping.id,
        u: ping.u,
        v: ping.v,
        alpha,
        isEnemy: ping.isEnemy,
        isSelf: ping.isSelf,
      });
    }
    this.ui.minimap.pings.value = pings;
  }
}
