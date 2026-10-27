// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiState, type LobbyInfo, type UiCommands } from "../src/app/uiBridge.js";
import { Root } from "../src/ui/Root.js";
import { DEFAULT_FFA_SCORE_LIMIT, DEFAULT_FFA_TIME_LIMIT_SECONDS } from "@3d/shared/game/gametypes/ffa.js";

const makeLobby = (overrides: Partial<LobbyInfo> = {}): LobbyInfo => ({
  code: "TESTBOT",
  private: true,
  map: null,
  mode: "Deathmatch",
  gametype: "ffa",
  playing: false,
  startsAt: null,
  players: [{ id: "1", username: "Ghost", host: true }],
  host: true,
  invite: null,
  scoreLimit: DEFAULT_FFA_SCORE_LIMIT,
  timeLimit: DEFAULT_FFA_TIME_LIMIT_SECONDS,
  bots: true,
  botDifficulty: "regular",
  botCount: 5,
  friendlyBots: 3,
  enemyBots: 3,
  ...overrides,
});

function setup() {
  const state = createUiState();
  const commands: UiCommands = {
    enterWorld: vi.fn(),
    returnToMenu: vi.fn(),
    resume: vi.fn(),
    setQuality: vi.fn(),
    setSensitivity: vi.fn(),
    setAudioVolume: vi.fn(),
    setAudioMuted: vi.fn(),
    previewWeapon: vi.fn(),
    saveLoadout: vi.fn(),
    openClasses: vi.fn(),
    closeClasses: vi.fn(),
    chooseClass: vi.fn(),
    openClassChoice: vi.fn(),
    closeClassChoice: vi.fn(),
    chooseTeam: vi.fn(),
    openTeamChoice: vi.fn(),
    closeTeamChoice: vi.fn(),
    signIn: vi.fn(),
    register: vi.fn(),
    signOut: vi.fn(),
    findGame: vi.fn(),
    createPrivateLobby: vi.fn(),
    setLobbyMap: vi.fn(),
    setLobbyMode: vi.fn(),
    setLobbyRules: vi.fn(),
    setScoreboardOpen: vi.fn(),
    toggleScoreboard: vi.fn(),
    joinLobby: vi.fn(),
    startLobby: vi.fn(),
    endLobby: vi.fn(),
    playHere: vi.fn(),
    leaveLobby: vi.fn(),
  };
  render(<Root state={state} commands={commands} />);
  return { state, commands };
}

afterEach(cleanup);

describe("Bot Setup UI", () => {
  it("navigates to Bot Setup from Game Setup menu and renders bot summary", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "lobby";
      state.lobby.value = makeLobby({ bots: true, botDifficulty: "hardened", botCount: 8 });
    });

    // Enter Game Setup:
    fireEvent.click(screen.getByText("Game Setup"));

    // Find Bot Setup button and click it:
    const botSetupBtn = screen.getByRole("button", { name: "Bot Setup" });
    expect(botSetupBtn).toBeTruthy();
    fireEvent.click(botSetupBtn);

    // Should now be inside Bot Setup screen:
    expect(screen.getByRole("button", { name: "Bots" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bot Difficulty" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Number of Bots" })).toBeTruthy();
  });

  it("toggles Bots enabled/disabled via commands.setLobbyRules", () => {
    const { state, commands } = setup();
    act(() => {
      state.screen.value = "lobby";
      state.lobby.value = makeLobby({ bots: true });
    });

    fireEvent.click(screen.getByText("Game Setup"));
    fireEvent.click(screen.getByRole("button", { name: "Bot Setup" }));

    // Click "Bots" sub-menu:
    fireEvent.click(screen.getByRole("button", { name: "Bots" }));
    expect(screen.getByRole("button", { name: "Enabled" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disabled" })).toBeTruthy();

    // Select "Disabled":
    fireEvent.click(screen.getByRole("button", { name: "Disabled" }));
    expect(commands.setLobbyRules).toHaveBeenCalledWith(
      expect.objectContaining({
        bots: false,
      }),
    );
  });

  it("changes Bot Difficulty to Veteran", () => {
    const { state, commands } = setup();
    act(() => {
      state.screen.value = "lobby";
      state.lobby.value = makeLobby({ botDifficulty: "regular" });
    });

    fireEvent.click(screen.getByText("Game Setup"));
    fireEvent.click(screen.getByRole("button", { name: "Bot Setup" }));

    // Click "Bot Difficulty":
    fireEvent.click(screen.getByRole("button", { name: "Bot Difficulty" }));
    expect(screen.getByRole("button", { name: "Recruit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Regular" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hardened" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Veteran" })).toBeTruthy();

    // Select "Veteran":
    fireEvent.click(screen.getByRole("button", { name: "Veteran" }));
    expect(commands.setLobbyRules).toHaveBeenCalledWith(
      expect.objectContaining({
        botDifficulty: "veteran",
      }),
    );
  });

  it("configures Bot Count in FFA", () => {
    const { state, commands } = setup();
    act(() => {
      state.screen.value = "lobby";
      state.lobby.value = makeLobby({ gametype: "ffa", botCount: 5 });
    });

    fireEvent.click(screen.getByText("Game Setup"));
    fireEvent.click(screen.getByRole("button", { name: "Bot Setup" }));

    // Click "Number of Bots":
    fireEvent.click(screen.getByRole("button", { name: "Number of Bots" }));
    expect(screen.getByRole("button", { name: "8 Bots" })).toBeTruthy();

    // Select "8 Bots":
    fireEvent.click(screen.getByRole("button", { name: "8 Bots" }));
    expect(commands.setLobbyRules).toHaveBeenCalledWith(
      expect.objectContaining({
        botCount: 8,
      }),
    );
  });

  it("configures Friendly and Enemy Bots in TDM", () => {
    const { state, commands } = setup();
    act(() => {
      state.screen.value = "lobby";
      state.lobby.value = makeLobby({ gametype: "tdm", friendlyBots: 3, enemyBots: 3 });
    });

    fireEvent.click(screen.getByText("Game Setup"));
    fireEvent.click(screen.getByRole("button", { name: "Bot Setup" }));

    // Should display team bot options:
    expect(screen.getByRole("button", { name: "Friendly Bots" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enemy Bots" })).toBeTruthy();

    // Configure Friendly Bots:
    fireEvent.click(screen.getByRole("button", { name: "Friendly Bots" }));
    fireEvent.click(screen.getByRole("button", { name: "5 Bots" }));
    expect(commands.setLobbyRules).toHaveBeenCalledWith(
      expect.objectContaining({
        friendlyBots: 5,
      }),
    );
  });

  it("returns to Bot Setup menu on Escape when inside a subtab", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "lobby";
      state.lobby.value = makeLobby();
    });

    fireEvent.click(screen.getByText("Game Setup"));
    fireEvent.click(screen.getByRole("button", { name: "Bot Setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Bot Difficulty" }));

    expect(screen.getByRole("button", { name: "Veteran" })).toBeTruthy();

    // Press Escape:
    fireEvent.keyDown(window, { key: "Escape" });

    // Returns to Bot Setup menu:
    expect(screen.getByRole("button", { name: "Bot Difficulty" })).toBeTruthy();
  });
});
