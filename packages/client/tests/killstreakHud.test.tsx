// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/preact";
import type { JoinedMessage } from "@3d/shared/net/messages/session.js";
import type { PlayerState } from "@3d/shared/sim/player.js";
import { DEFAULT_COMBAT_RULES } from "@3d/shared/game/rules.js";
import { WeaponRegistry, type WeaponEntry } from "@3d/shared/sim/weaponRegistry.js";
import { weaponDef } from "@3d/shared/testing/weaponDef.js";
import { Hud } from "../src/app/hud.js";
import { createUiState, type UiCommands } from "../src/app/uiBridge.js";
import { UiContext } from "../src/ui/context.js";
import { KillstreakHud } from "../src/ui/hud/KillstreakHud.js";

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

describe("KillstreakHud", () => {
  afterEach(cleanup);
  it("renders 3 killstreak slots with progress when alive", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 100, dead: false }), [], 0);

    const { getByTestId } = render(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <KillstreakHud />
      </UiContext.Provider>,
    );

    expect(getByTestId("hud-killstreaks")).toBeTruthy();
    expect(getByTestId("hud-streak-slot-0")).toBeTruthy();
    expect(getByTestId("hud-streak-slot-1")).toBeTruthy();
    expect(getByTestId("hud-streak-slot-2")).toBeTruthy();
  });

  it("does not render when player is dead", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 0, dead: true }), [], 0);

    const { queryByTestId } = render(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <KillstreakHud />
      </UiContext.Provider>,
    );

    expect(queryByTestId("hud-killstreaks")).toBeNull();
  });

  it("displays [5] activation prompt when a streak is ready", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 100, dead: false }), [], 0);

    // Set slot 0 (UAV) as ready
    ui.hud.streaks.value = {
      package: "assault",
      streaks: ["uav", "predator_missile", "sentry_gun"],
      ready: [true, false, false],
      killsThisLife: 3,
      totalPoints: 3,
    };

    const { getByTestId } = render(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <KillstreakHud />
      </UiContext.Provider>,
    );

    const slot0 = getByTestId("hud-streak-slot-0");
    expect(slot0.textContent).toContain("[5]");
  });

  it("displays KILLSTREAK EARNED banner when streakEarned is active", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 100, dead: false }), [], 0);

    ui.hud.streakEarned.value = {
      name: "UAV",
      icon: "/assets/hud/specialty_uav.png",
    };

    const { getByTestId } = render(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <KillstreakHud />
      </UiContext.Provider>,
    );

    const banner = getByTestId("hud-streak-earned-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("KILLSTREAK EARNED");
    expect(banner.textContent).toContain("UAV");
  });

  it("handles killstreak_earned event in Hud", () => {
    const { ui, hud } = setup();
    hud.snapshot(
      state({ health: 100, dead: false }),
      [
        {
          id: 1,
          kind: "announce",
          what: "killstreak_earned",
          player: "me",
          team: null,
          value: 0, // slot 0 earned
        },
      ],
      1000,
    );

    expect(ui.hud.streaks.value.ready[0]).toBe(true);
    expect(ui.hud.streakEarned.value).toBeTruthy();
    expect(ui.hud.streakEarned.value?.name).toBe("UAV");
  });
});
