// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiState, type LobbyInfo, type UiCommands } from "../src/app/uiBridge.js";
import { Root } from "../src/ui/Root.js";
import { DEFAULT_FFA_SCORE_LIMIT, DEFAULT_FFA_TIME_LIMIT_SECONDS } from "@3d/shared/game/gametypes/ffa.js";

const makeLobby = (overrides: Partial<LobbyInfo> = {}): LobbyInfo => ({
  code: "TEST12",
  private: true,
  map: null,
  mode: "Free-for-All",
  gametype: "ffa",
  playing: false,
  startsAt: null,
  players: [{ id: "1", username: "Ghost", host: true }],
  host: true,
  invite: null,
  scoreLimit: DEFAULT_FFA_SCORE_LIMIT,
  timeLimit: DEFAULT_FFA_TIME_LIMIT_SECONDS,
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

describe("FFA Game Rules UI", () => {
  it("allows the host to configure score and time limits under Game Setup -> Game Rules", () => {
    const { state, commands } = setup();
    act(() => {
      state.screen.value = "lobby";
      state.lobby.value = makeLobby();
    });

    // Enter Game Setup
    fireEvent.click(screen.getByText("Game Setup"));
    const gameRulesButton = screen.getByRole("button", { name: "Game Rules" });
    expect(gameRulesButton).toBeTruthy();

    // Click Game Rules
    fireEvent.click(gameRulesButton);
    expect(screen.getByRole("button", { name: "Score Limit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Time Limit" })).toBeTruthy();

    // Click Score Limit sub-menu
    fireEvent.click(screen.getByRole("button", { name: "Score Limit" }));
    expect(screen.getByRole("button", { name: "15 Kills" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlimited" })).toBeTruthy();

    // Select 15 Kills
    fireEvent.click(screen.getByRole("button", { name: "15 Kills" }));
    expect(commands.setLobbyRules).toHaveBeenCalledWith({
      scoreLimit: 15,
      timeLimit: DEFAULT_FFA_TIME_LIMIT_SECONDS,
    });

    // Click Time Limit sub-menu
    fireEvent.click(screen.getByRole("button", { name: "Time Limit" }));
    expect(screen.getByRole("button", { name: "5 Minutes" })).toBeTruthy();

    // Select 5 Minutes (300s)
    fireEvent.click(screen.getByRole("button", { name: "5 Minutes" }));
    expect(commands.setLobbyRules).toHaveBeenCalledWith({
      scoreLimit: DEFAULT_FFA_SCORE_LIMIT,
      timeLimit: 300,
    });
  });

  it("handles Escape in GameRules subtab to return to GameRules menu rather than exiting", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "lobby";
      state.lobby.value = makeLobby();
    });

    fireEvent.click(screen.getByText("Game Setup"));
    fireEvent.click(screen.getByRole("button", { name: "Game Rules" }));
    fireEvent.click(screen.getByRole("button", { name: "Score Limit" }));

    // In Score Limit sub-menu:
    expect(screen.getByRole("button", { name: "30 Kills" })).toBeTruthy();

    // Press Escape: returns to Game Rules menu rather than exiting
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Score Limit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Time Limit" })).toBeTruthy();
  });

  it("automatically switches mode to FFA if Game Rules is clicked when another mode is selected", () => {
    const { state, commands } = setup();
    act(() => {
      state.screen.value = "lobby";
      state.lobby.value = makeLobby({
        gametype: "default",
        mode: "Free Roam",
      });
    });

    fireEvent.click(screen.getByText("Game Setup"));
    fireEvent.click(screen.getByRole("button", { name: "Game Rules" }));
    expect(commands.setLobbyMode).toHaveBeenCalledWith("ffa");
  });
});

describe("FFA In-Game HUD & Scoreboard", () => {
  it("renders FFA HUD showing rank, score, score limit, and timer", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "world";
      state.lobby.value = makeLobby({
        playing: true,
        scoreLimit: 30,
        timeLimit: 600,
      });
      state.hud.counters.value = [
        { name: "scoreLimit", value: 30 },
        { name: "timeLeft", value: 450 },
      ];
      state.hud.scoreboard.value = [
        { id: "1", rank: 1, name: "Soap", score: 12, deaths: 4, isSelf: true },
        { id: "2", rank: 2, name: "Price", score: 8, deaths: 6, isSelf: false },
      ];
    });

    const hudWidget = screen.getByTestId("ffa-hud");
    expect(hudWidget).toBeTruthy();
    expect(hudWidget.textContent).toContain("1ST");
    expect(hudWidget.textContent).toContain("12");
    expect(hudWidget.textContent).toContain("/ 30");
    expect(hudWidget.textContent).toContain("7:30");
    // Duplicate raw counters and floating zombie points are suppressed in FFA:
    expect(screen.queryByTestId("hud-counters")).toBeNull();
    expect(screen.queryByTestId("hud-points")).toBeNull();
  });

  it("renders leader score in FFA HUD when trailing behind 1st place", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "world";
      state.lobby.value = makeLobby({
        playing: true,
        scoreLimit: 30,
        timeLimit: 600,
      });
      state.hud.counters.value = [
        { name: "scoreLimit", value: 30 },
        { name: "timeLeft", value: 300 },
      ];
      state.hud.scoreboard.value = [
        { id: "2", rank: 1, name: "Price", score: 18, deaths: 2, isSelf: false },
        { id: "1", rank: 2, name: "Soap", score: 11, deaths: 5, isSelf: true },
      ];
    });

    const hudWidget = screen.getByTestId("ffa-hud");
    expect(hudWidget.textContent).toContain("2ND");
    expect(hudWidget.textContent).toContain("11");
    expect(hudWidget.textContent).toContain("LEADER: 18");
  });

  it("renders the tactical Scoreboard when opened", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "world";
      state.lobby.value = makeLobby({
        playing: true,
        scoreLimit: 30,
        timeLimit: 600,
      });
      state.hud.counters.value = [
        { name: "scoreLimit", value: 30 },
        { name: "timeLeft", value: 300 },
      ];
      state.hud.scoreboardOpen.value = false;
      state.hud.scoreboard.value = [
        { id: "2", rank: 1, name: "Price", score: 20, deaths: 2, isSelf: false },
        { id: "1", rank: 2, name: "Soap", score: 15, deaths: 5, isSelf: true },
      ];
    });

    // Hidden when scoreboardOpen is false
    expect(screen.queryByTestId("tactical-scoreboard")).toBeNull();

    // Opens when scoreboardOpen is true
    act(() => {
      state.hud.scoreboardOpen.value = true;
    });
    const scoreboard = screen.getByTestId("tactical-scoreboard");
    expect(scoreboard).toBeTruthy();
    expect(scoreboard.textContent).toContain("Price");
    expect(scoreboard.textContent).toContain("Soap");
    expect(scoreboard.textContent).toContain("5:00");
    expect(scoreboard.textContent).toContain("30");
  });

  it("renders MatchEnd banner with VICTORY when self ranks 1st", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "world";
      state.hud.scoreboard.value = [
        { id: "1", rank: 1, name: "Soap", score: 30, deaths: 2, isSelf: true },
        { id: "2", rank: 2, name: "Price", score: 24, deaths: 10, isSelf: false },
      ];
      state.hud.matchWinner.value = "Soap";
      state.hud.matchEndReason.value = "Soap reached the score limit!";
    });

    const banner = screen.getByTestId("match-end-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("VICTORY");
    expect(banner.textContent).toContain("Soap reached the score limit!");
  });

  it("renders MatchEnd banner with DEFEAT and names the winner when someone else wins", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "world";
      state.hud.scoreboard.value = [
        { id: "2", rank: 1, name: "Price", score: 30, deaths: 2, isSelf: false },
        { id: "1", rank: 2, name: "Soap", score: 15, deaths: 10, isSelf: true },
      ];
      state.hud.matchWinner.value = "Price";
      state.hud.matchEndReason.value = "Price reached the score limit!";
    });

    const banner = screen.getByTestId("match-end-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("DEFEAT");
    expect(banner.textContent).toContain("Winner: Price");
  });
});
