import { describe, expect, it } from "vitest";
import { createUiState } from "../src/app/uiBridge.js";
import { Radar, PING_DURATION_MS, PING_SOLID_MS, UAV_SWEEP_MS } from "../src/app/radar.js";
import type { ResolvedMinimap } from "@3d/shared/dsl/resolved.js";

const DOME: ResolvedMinimap = {
  source: "assets/minimap.png",
  center: { x: 5.08, z: -24.587 },
  width: 103.632,
  depth: 103.632,
  rotation: -Math.PI / 2,
  range: 40,
};

describe("radar gunfire pings", () => {
  it("records an enemy gunfire ping at the shooter's position on the minimap", () => {
    const ui = createUiState();
    const radar = new Radar(ui);

    radar.record("enemy1", { x: 5.08, z: -24.587 }, true, false, DOME, 1000);

    expect(ui.minimap.pings.value).toHaveLength(1);
    const ping = ui.minimap.pings.value[0]!;
    expect(ping.id).toBe("enemy1");
    expect(ping.isEnemy).toBe(true);
    expect(ping.isSelf).toBe(false);
    expect(ping.u).toBeCloseTo(0.5, 4);
    expect(ping.v).toBeCloseTo(0.5, 4);
    expect(ping.alpha).toBe(1);
  });

  it("keeps ping solid for the first 1200ms and fades out until 2000ms", () => {
    const ui = createUiState();
    const radar = new Radar(ui);

    radar.record("enemy1", { x: 5.08, z: -24.587 }, true, false, DOME, 1000);

    // At 1500ms (500ms after shot, within PING_SOLID_MS): alpha remains 1
    radar.update(1500);
    expect(ui.minimap.pings.value[0]!.alpha).toBe(1);

    // At 2200ms (1200ms after shot, exactly end of solid): alpha remains 1
    radar.update(1000 + PING_SOLID_MS);
    expect(ui.minimap.pings.value[0]!.alpha).toBe(1);

    // At 2600ms (1600ms after shot, halfway through fade): alpha is 0.5
    radar.update(2600);
    expect(ui.minimap.pings.value[0]!.alpha).toBeCloseTo(0.5, 2);

    // At 3000ms (2000ms after shot, end of duration): ping has expired and removed
    radar.update(1000 + PING_DURATION_MS);
    expect(ui.minimap.pings.value).toHaveLength(0);
  });

  it("refreshes position and timer on successive shots from the same shooter", () => {
    const ui = createUiState();
    const radar = new Radar(ui);

    radar.record("enemy1", { x: 5.08, z: -24.587 }, true, false, DOME, 1000);
    radar.update(2500); // 1500ms in, alpha fading
    expect(ui.minimap.pings.value[0]!.alpha).toBeLessThan(1);

    // Second shot at 2800ms at different coordinates
    radar.record("enemy1", { x: 56.896, z: -76.403 }, true, false, DOME, 2800);
    expect(ui.minimap.pings.value).toHaveLength(1);
    const ping = ui.minimap.pings.value[0]!;
    expect(ping.u).toBeCloseTo(0, 4);
    expect(ping.v).toBeCloseTo(0, 4);
    expect(ping.alpha).toBe(1);

    // At 4000ms (1200ms after second shot): still solid!
    radar.update(4000);
    expect(ui.minimap.pings.value[0]!.alpha).toBe(1);
  });

  it("clears all active pings on demand", () => {
    const ui = createUiState();
    const radar = new Radar(ui);

    radar.record("p1", { x: 5.08, z: -24.587 }, true, false, DOME, 1000);
    radar.record("p2", { x: 10, z: -20 }, false, true, DOME, 1000);
    expect(ui.minimap.pings.value).toHaveLength(2);

    radar.clear();
    expect(ui.minimap.pings.value).toHaveLength(0);
  });
});

describe("a UAV on the radar", () => {
  it("marks the enemies it shows once a sweep, and not on every snapshot between", () => {
    const ui = createUiState();
    const radar = new Radar(ui);
    radar.sweep([{ id: "a", feet: { x: 5.08, z: -24.587 } }], DOME, 0);
    expect(ui.minimap.pings.value.map((p) => [p.id, p.isEnemy])).toEqual([["uav:a", true]]);

    // They moved, but the next sweep has not come round: the mark stays where they were.
    radar.sweep([{ id: "a", feet: { x: 30, z: -24.587 } }], DOME, UAV_SWEEP_MS / 2);
    const where = () => [ui.minimap.pings.value[0]!.u, ui.minimap.pings.value[0]!.v].map((n) => n.toFixed(3));
    expect(where()).toEqual(["0.500", "0.500"]);
    radar.sweep([{ id: "a", feet: { x: 30, z: -24.587 } }], DOME, UAV_SWEEP_MS);
    expect(where()).not.toEqual(["0.500", "0.500"]);
  });
});
