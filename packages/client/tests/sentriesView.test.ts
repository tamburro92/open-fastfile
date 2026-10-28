import { describe, expect, it } from "vitest";
import type { SentryState } from "@3d/shared/game/streaks.js";
import { SentriesView } from "../src/engine/sentriesView.js";

const sentry = (over: Partial<SentryState> = {}): SentryState => ({
  id: 1,
  owner: "abc12345",
  position: { x: 2, y: 0, z: -3 },
  yaw: 0,
  pitch: 0,
  firing: false,
  ...over,
});

describe("SentriesView", () => {
  it("stands where the snapshot says, and turns between the last two aims", () => {
    const view = new SentriesView();
    view.setTickRate(60);
    view.apply([sentry({ yaw: 0 })], 0);
    view.apply([sentry({ yaw: 1 })], 1000 / 60);
    view.update(0.016, 1000 / 60 + 1000 / 120);
    const base = view.root.children[0]!;
    expect(base.position.x).toBe(2);
    expect(base.children.find((c) => c.position.y > 0.5)!.rotation.y).toBeCloseTo(0.5, 5);
    // Its own matrices, as everything beside the frozen scene writes.
    expect(base.matrixWorld.elements[12]).toBe(2);
  });

  it("flashes while firing, and goes when the snapshot stops carrying it", () => {
    const view = new SentriesView();
    view.apply([sentry({ firing: true })], 0);
    view.update(0.016, 16);
    let lit = false;
    view.root.traverse((node) => (lit ||= node.visible && node.type === "Mesh" && node.position.z < -0.7));
    expect(lit).toBe(true);
    view.apply([], 32);
    expect(view.size).toBe(0);
    expect(view.root.children).toHaveLength(0);
  });
});
