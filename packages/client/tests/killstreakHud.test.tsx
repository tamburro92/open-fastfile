// @vitest-environment happy-dom
import type { StreakState } from "@3d/shared/game/streaks.js";
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

const assault: StreakState = {
  package: "assault",
  streaks: ["uav", "predator_missile", "sentry_gun"],
  ready: [false, false, false],
  progress: 0,
  hardline: false,
};

function setup() {
  const ui = createUiState();
  const hud = new Hud(ui, () => registry);
  hud.setWalking(true);
  hud.joined(joined(), "me");
  return { ui, hud };
}

describe("KillstreakHud", () => {
  afterEach(cleanup);

  const draw = (ui: ReturnType<typeof setup>["ui"]) =>
    render(
      <UiContext.Provider value={{ state: ui, commands: stubCommands }}>
        <KillstreakHud />
      </UiContext.Provider>,
    );

  it("draws the three slots the server says, with progress toward each", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 100, dead: false }), [], 0);
    hud.streaks({ ...assault, progress: 2 });
    const { getByTestId } = draw(ui);
    expect(getByTestId("hud-streak-slot-0").textContent).toContain("2/3");
    expect(getByTestId("hud-streak-slot-1").textContent).toContain("2/5");
  });

  it("follows the class: Support's costs, and Hardline's one off", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 100, dead: false }), [], 0);
    hud.streaks({ package: "support", streaks: ["uav", "sam_turret", "ac130"], ready: [false, false, false], progress: 1, hardline: true });
    const { getByTestId } = draw(ui);
    expect(getByTestId("hud-streak-slot-0").textContent).toContain("UAV");
    expect(getByTestId("hud-streak-slot-0").textContent).toContain("1/3");
    expect(getByTestId("hud-streak-slot-1").textContent).toContain("SAM Turret");
    expect(getByTestId("hud-streak-slot-2").textContent).toContain("1/14");
  });

  it("does not render when the player is dead, or before the server has said anything", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 100, dead: false }), [], 0);
    expect(draw(ui).queryByTestId("hud-killstreaks")).toBeNull();
    cleanup();
    hud.streaks(assault);
    hud.snapshot(state({ health: 0, dead: true }), [], 1);
    expect(draw(ui).queryByTestId("hud-killstreaks")).toBeNull();
  });

  it("shows [5] on the slot that is ready, whichever slot it is", () => {
    const { ui, hud } = setup();
    hud.snapshot(state({ health: 100, dead: false }), [], 0);
    hud.streaks({ ...assault, ready: [false, false, true], progress: 5 });
    const { getByTestId } = draw(ui);
    expect(getByTestId("hud-streak-slot-2").textContent).toContain("[5]");
    expect(getByTestId("hud-streak-slot-0").textContent).not.toContain("[5]");
  });

  it("names the earned streak from the slot the event gives, against this player's own package", () => {
    const { ui, hud } = setup();
    hud.streaks({ package: "support", streaks: ["uav", "sam_turret", "ac130"], ready: [false, true, false], progress: 8, hardline: false });
    hud.snapshot(state({ health: 100, dead: false }), [{ id: 1, kind: "announce", what: "killstreak_earned", player: "me", team: null, value: 1 }], 1000);
    expect(ui.hud.streakEarned.value).toEqual({ streak: "sam_turret" });
    const banner = draw(ui).getByTestId("hud-streak-earned-banner");
    expect(banner.textContent).toContain("KILLSTREAK EARNED");
    expect(banner.textContent).toContain("SAM Turret");
  });
});
