// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiState, type LobbyInfo, type UiCommands } from "../src/app/uiBridge.js";
import { Root } from "../src/ui/Root.js";
import { DEFAULT_TDM_SCORE_LIMIT, DEFAULT_TDM_TIME_LIMIT_SECONDS, TDM_GAMETYPE } from "@3d/shared/game/gametypes/tdm.js";

const makeLobby = (overrides: Partial<LobbyInfo> = {}): LobbyInfo => ({
  code: "TDM123",
  private: true,
  map: null,
  mode: "Team Deathmatch",
  gametype: TDM_GAMETYPE,
  playing: false,
  startsAt: null,
  players: [{ id: "1", username: "Ghost", host: true }],
  host: true,
  invite: null,
  scoreLimit: DEFAULT_TDM_SCORE_LIMIT,
  timeLimit: DEFAULT_TDM_TIME_LIMIT_SECONDS,
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

describe("TDM Game Rules UI", () => {
  it("allows the host to configure TDM score and time limits", () => {
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
    expect(screen.getByRole("button", { name: "75 Kills" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "50 Kills" })).toBeTruthy();

    // Select 50 Kills
    fireEvent.click(screen.getByRole("button", { name: "50 Kills" }));
    expect(commands.setLobbyRules).toHaveBeenCalledWith({
      scoreLimit: 50,
      timeLimit: DEFAULT_TDM_TIME_LIMIT_SECONDS,
    });

    // Click Time Limit sub-menu
    fireEvent.click(screen.getByRole("button", { name: "Time Limit" }));
    expect(screen.getByRole("button", { name: "8 Minutes" })).toBeTruthy();

    // Select 8 Minutes (480s)
    fireEvent.click(screen.getByRole("button", { name: "8 Minutes" }));
    expect(commands.setLobbyRules).toHaveBeenCalledWith({
      scoreLimit: DEFAULT_TDM_SCORE_LIMIT,
      timeLimit: 480,
    });
  });
});

describe("TDM In-Game HUD & Scoreboard", () => {
  it("renders TDM HUD showing friendly team, enemy team, score limit, and timer", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "world";
      state.lobby.value = makeLobby({
        playing: true,
        scoreLimit: 75,
        timeLimit: 600,
      });
      state.hud.counters.value = [
        { name: "alliesScore", value: 42 },
        { name: "axisScore", value: 38 },
        { name: "scoreLimit", value: 75 },
        { name: "timeLeft", value: 514 },
      ];
      state.hud.scoreboard.value = [
        { id: "1", rank: 1, name: "Soap", score: 15, deaths: 4, isSelf: true, team: "allies" },
        { id: "2", rank: 2, name: "Makarov", score: 18, deaths: 6, isSelf: false, team: "axis" },
      ];
    });

    const tdmHud = screen.getByTestId("tdm-hud");
    expect(tdmHud).toBeTruthy();
    expect(tdmHud.textContent).toContain("Allies");
    expect(tdmHud.textContent).toContain("42");
    expect(tdmHud.textContent).toContain("Axis");
    expect(tdmHud.textContent).toContain("38");
    expect(tdmHud.textContent).toContain("/ 75");
    expect(tdmHud.textContent).toContain("8:34");
    // Duplicate counters and floating points suppressed in TDM:
    expect(screen.queryByTestId("hud-counters")).toBeNull();
    expect(screen.queryByTestId("hud-points")).toBeNull();
    // FFA HUD must NOT be rendered in TDM:
    expect(screen.queryByTestId("ffa-hud")).toBeNull();
  });

  it("renders two-team Tactical Scoreboard when opened", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "world";
      state.lobby.value = makeLobby({
        playing: true,
        scoreLimit: 75,
        timeLimit: 600,
      });
      state.hud.counters.value = [
        { name: "alliesScore", value: 45 },
        { name: "axisScore", value: 40 },
        { name: "scoreLimit", value: 75 },
        { name: "timeLeft", value: 300 },
      ];
      state.hud.scoreboardOpen.value = true;
      state.hud.scoreboard.value = [
        { id: "1", rank: 1, name: "Soap", score: 25, deaths: 5, isSelf: true, team: "allies" },
        { id: "2", rank: 2, name: "Price", score: 20, deaths: 6, isSelf: false, team: "allies" },
        { id: "3", rank: 3, name: "Makarov", score: 28, deaths: 4, isSelf: false, team: "axis" },
        { id: "4", rank: 4, name: "Yuri", score: 12, deaths: 8, isSelf: false, team: "axis" },
      ];
    });

    const scoreboard = screen.getByTestId("tactical-scoreboard");
    expect(scoreboard).toBeTruthy();
    expect(scoreboard.textContent).toContain("ALLIES");
    expect(scoreboard.textContent).toContain("AXIS");
    expect(scoreboard.textContent).toContain("Soap");
    expect(scoreboard.textContent).toContain("Price");
    expect(scoreboard.textContent).toContain("Makarov");
    expect(scoreboard.textContent).toContain("Yuri");
    expect(scoreboard.textContent).toContain("5:00");
  });

  it("renders MatchEnd banner with VICTORY when player's team wins", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "world";
      state.hud.scoreboard.value = [
        { id: "1", rank: 1, name: "Soap", score: 25, deaths: 5, isSelf: true, team: "allies" },
      ];
      state.hud.matchWinner.value = "allies";
      state.hud.matchEndReason.value = "Score Limit Reached";
    });

    const banner = screen.getByTestId("match-end-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("VICTORY");
    expect(banner.textContent).toContain("Team Victory");
  });

  it("renders MatchEnd banner with DEFEAT when opposing team wins", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "world";
      state.hud.scoreboard.value = [
        { id: "1", rank: 1, name: "Soap", score: 25, deaths: 5, isSelf: true, team: "allies" },
      ];
      state.hud.matchWinner.value = "axis";
      state.hud.matchEndReason.value = "Score Limit Reached";
    });

    const banner = screen.getByTestId("match-end-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("DEFEAT");
    expect(banner.textContent).toContain("AXIS Victory");
  });

  it("renders MatchEnd banner with DRAW when match ends tied", () => {
    const { state } = setup();
    act(() => {
      state.screen.value = "world";
      state.hud.scoreboard.value = [
        { id: "1", rank: 1, name: "Soap", score: 25, deaths: 5, isSelf: true, team: "allies" },
      ];
      state.hud.matchWinner.value = "draw";
      state.hud.matchEndReason.value = "Time Limit Reached";
    });

    const banner = screen.getByTestId("match-end-banner");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("DRAW");
    expect(banner.textContent).toContain("Stalemate");
  });
});
