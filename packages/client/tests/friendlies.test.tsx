// @vitest-environment happy-dom
// Teammates as MW3 shows them: green arrows on the minimap and green names over their heads.

import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiState, type UiCommands } from "../src/app/uiBridge.js";
import { Root } from "../src/ui/Root.js";

function walking() {
  const state = createUiState();
  const commands = new Proxy({}, { get: () => vi.fn() }) as UiCommands;
  render(<Root state={state} commands={commands} />);
  act(() => {
    state.screen.value = "world";
    state.minimap.map.value = { image: "/minimap.png", width: 1.25, height: 1.25 };
    state.minimap.pose.value = { u: 0.5, v: 0.5, rotation: 0 };
  });
  return state;
}

afterEach(cleanup);

describe("teammates", () => {
  it("are a green arrow each on the minimap, at their place and turned their way", () => {
    const state = walking();
    expect(screen.queryAllByTestId("minimap-ally")).toHaveLength(0);
    act(() => {
      state.minimap.allies.value = [
        { id: "#b2", u: 0.25, v: 0.75, rotation: 1 },
        { id: "#b3", u: 0.6, v: 0.4, rotation: 0 },
      ];
    });
    const arrows = screen.getAllByTestId("minimap-ally");
    expect(arrows).toHaveLength(2);
    expect(arrows[0]!.style.left).toBe("25%");
    expect(arrows[0]!.style.top).toBe("75%");
    expect(arrows[0]!.style.transform).toContain("rotate(1rad)");
  });

  it("carry their name over their head, where the app placed it", () => {
    const state = walking();
    act(() => {
      state.hud.nameTags.value = [{ id: "#b2", name: "Soap [BOT]", x: 0.4, y: 0.3 }];
    });
    const tag = screen.getByTestId("name-tag");
    expect(tag.textContent).toBe("Soap [BOT]");
    expect(tag.style.left).toBe("40%");
    expect(tag.style.top).toBe("30%");
    act(() => {
      state.hud.nameTags.value = [];
    });
    expect(screen.queryAllByTestId("name-tag")).toHaveLength(0);
  });
});
