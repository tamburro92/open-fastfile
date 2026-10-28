import { describe, expect, it } from "vitest";
import type { SentryState } from "@3d/shared/game/streaks.js";
import { SentriesView } from "../src/engine/sentriesView.js";

const sentry = (over: Partial<SentryState> = {}): SentryState => ({
  id: 1,
  owner: "abc12345",
  position: { x: 2, y: 0, z: -3 },
  facing: 0,
  yaw: 0,
  pitch: 0,
  firing: false,
  ...over,
});

describe("SentriesView", () => {
  it("stands where the snapshot says, and turns its pivot between the last two aims, relative to its tripod", () => {
    const view = new SentriesView();
    view.setTickRate(60);
    view.apply([sentry({ facing: 0.25, yaw: 0.25 })], 0);
    view.apply([sentry({ facing: 0.25, yaw: 1.25 })], 1000 / 60);
    view.update(0.016, 1000 / 60 + 1000 / 120);
    const base = view.root.children[0]!;
    expect(base.position.x).toBe(2);
    expect(base.getObjectByName("tag_aim_pivot")!.rotation.z).toBeCloseTo(0.5, 5);
    // Its own matrices, as everything beside the frozen scene writes.
    expect(base.matrixWorld.elements[12]).toBe(2);
  });

  it("flashes while firing, and goes when the snapshot stops carrying it", () => {
    const view = new SentriesView();
    view.apply([sentry({ firing: true })], 0);
    view.update(0.01, 16);
    const flash = view.root.getObjectByName("tag_flash")!.children[0]!;
    expect(flash.visible).toBe(true);
    view.apply([], 32);
    expect(view.size).toBe(0);
    expect(view.root.children).toHaveLength(0);
  });
});
