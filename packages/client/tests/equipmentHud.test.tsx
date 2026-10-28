// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/preact";
import type { JoinedMessage } from "@3d/shared/net/messages/session.js";
import type { PlayerState } from "@3d/shared/sim/player.js";
import { DEFAULT_COMBAT_RULES } from "@3d/shared/game/rules.js";
import { WeaponRegistry, type WeaponEntry } from "@3d/shared/sim/weaponRegistry.js";
import { weaponDef } from "@3d/shared/testing/weaponDef.js";
import { Hud } from "../src/app/hud.js";
import { createUiState, type UiCommands } from "../src/app/uiBridge.js";
import { UiContext } from "../src/ui/context.js";
import { EquipmentHud } from "../src/ui/hud/EquipmentHud.js";
import { GrenadeIndicator } from "../src/ui/hud/GrenadeIndicator.js";
import { FlashOverlay } from "../src/ui/hud/FlashOverlay.js";

const stubCommands = {} as unknown as UiCommands;

const registry = new WeaponRegistry([
  { id: "test_mp", game: "iw5", display: "M4A1", slot: "primary", def: weaponDef({ clipSize: 30 }), attachments: [] } satisfies WeaponEntry,
]);

function state(over: Partial<PlayerState> = {}): PlayerState {
  return {
    movement: {} as PlayerState["movement"],
    weaponIndex: 0,
    attachments: [],
    weapon: { state: "idle", ammo: 30 } as PlayerState["weapon"],
    slot: 0,
    spareIndex: null,
    spareAttachments: [],
    armed: 0,
    swapping: false,
    stowed: false,
    team: null,
    health: 100,
    dead: false,
    respawnIn: 0,
    points: 0,
    ...over,
  };
}

function joined(): JoinedMessage {
  return {
    tickRate: 60,
    gametype: "default",
    rules: { maxHealth: DEFAULT_COMBAT_RULES.maxHealth, timedRespawn: true },
    eventId: 0,
    spawned: true,
    classes: true,
  };
}

function setup() {
  const ui = createUiState();
  const hud = new Hud(ui, () => registry);
  hud.setWalking(true);
  hud.joined(joined(), "me");
  return { ui, hud };
}

describe("Equipment HUD & Vitals", () => {
  it("renders lethal and tactical counts", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 100 }), [], 0);

    const { getByTestId } = render(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <EquipmentHud />
      </UiContext.Provider>,
    );

    expect(getByTestId("hud-equipment")).toBeDefined();
    expect(getByTestId("hud-lethal").textContent).toContain("Frag");
    expect(getByTestId("hud-lethal").textContent).toContain("x1");
    expect(getByTestId("hud-tactical").textContent).toContain("Flash");
    expect(getByTestId("hud-tactical").textContent).toContain("x2");

    // Use lethal
    hud.useLethal();
    expect(ui.hud.equipment.value.lethal?.count).toBe(0);

    // Use tactical twice
    hud.useTactical();
    expect(ui.hud.equipment.value.tactical?.count).toBe(1);
    hud.useTactical();
    expect(ui.hud.equipment.value.tactical?.count).toBe(0);

    // Replenish on respawn
    hud.resetEquipment();
    expect(ui.hud.equipment.value.lethal?.count).toBe(1);
    expect(ui.hud.equipment.value.tactical?.count).toBe(2);
  });

  it("renders Grenade Danger Indicator when live grenade is near", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 100 }), [], 0);

    // No danger initially
    const { queryByTestId, rerender } = render(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <GrenadeIndicator />
      </UiContext.Provider>,
    );
    expect(queryByTestId("hud-grenade-indicator")).toBeNull();

    // Server announces grenade_danger to "me" with relative angle 45 deg
    hud.snapshot(
      state({ health: 100 }),
      [
        {
          kind: "announce",
          id: 1,
          what: "grenade_danger",
          player: "me",
          team: null,
          value: 45,
        },
      ],
      1000,
    );

    expect(ui.hud.grenadeDanger.value).toEqual({ angle: 45 });

    rerender(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <GrenadeIndicator />
      </UiContext.Provider>,
    );

    const el = queryByTestId("hud-grenade-indicator");
    expect(el).not.toBeNull();
  });

  it("triggers Flash Overlay upon flashbang detonation and decays over duration", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 100 }), [], 0);

    const { queryByTestId, rerender } = render(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <FlashOverlay />
      </UiContext.Provider>,
    );
    expect(queryByTestId("hud-flash-overlay")).toBeNull();

    // Flashbang announces to "me" with duration 3.0 seconds (value = 30 tenths)
    hud.snapshot(
      state({ health: 100 }),
      [
        {
          kind: "announce",
          id: 2,
          what: "flashbang",
          player: "me",
          team: null,
          value: 30,
        },
      ],
      1000,
    );

    expect(ui.hud.flashed.value).toBe(1.0);

    rerender(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <FlashOverlay />
      </UiContext.Provider>,
    );
    expect(queryByTestId("hud-flash-overlay")).not.toBeNull();

    // Advance 1.5s (halfway through 3.0s flash)
    hud.snapshot(state({ health: 100 }), [], 2500);
    expect(ui.hud.flashed.value).toBeCloseTo(0.5, 0.1);

    // Advance past 3.0s (fully recovered)
    hud.snapshot(state({ health: 100 }), [], 4500);
    expect(ui.hud.flashed.value).toBe(0);

    rerender(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <FlashOverlay />
      </UiContext.Provider>,
    );
    expect(queryByTestId("hud-flash-overlay")).toBeNull();
  });
});
