import { useUi } from "../context.js";
import { ENEMY_TEAM_COLOR, FREE_COLOR, ScoreBars } from "./ScoreBars.js";

export function FfaHud() {
  const { state } = useUi();
  const lobby = state.lobby.value;

  // Never render in TDM or when team score counters are present
  if (lobby && lobby.gametype !== "ffa") {
    return null;
  }
  const counters = state.hud.counters.value;
  if (counters.some((c) => c.name === "alliesScore" || c.name === "axisScore")) {
    return null;
  }

  // Only render for FFA matches or matches with scoreLimit counter
  const isFfa = lobby?.gametype === "ffa";
  const scoreLimitCounter = counters.find((c) => c.name === "scoreLimit");
  const timeLeftCounter = counters.find((c) => c.name === "timeLeft");

  if (!isFfa && !scoreLimitCounter) {
    return null;
  }

  const entries = state.hud.scoreboard.value;
  const self = entries.find((e) => e.isSelf);
  const myScore = state.hud.points.value ?? self?.score ?? 0;
  // The one to beat: the leader, or whoever is behind a player who leads.
  const rival = entries.find((e) => !e.isSelf)?.score ?? 0;
  const timeLeft = timeLeftCounter?.value;

  return (
    <div data-testid="ffa-hud">
      <ScoreBars
        top={myScore}
        bottom={rival}
        limit={scoreLimitCounter?.value ?? lobby?.scoreLimit ?? 30}
        topColor={FREE_COLOR}
        bottomColor={ENEMY_TEAM_COLOR}
        timeLeft={timeLeft}
        unlimited={timeLeft === 0 && lobby?.timeLimit === 0}
      />
    </div>
  );
}
