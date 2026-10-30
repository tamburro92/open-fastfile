import { DEFAULT_TDM_SCORE_LIMIT } from "../../app/uiBridge.js";
import { useUi } from "../context.js";
import { ENEMY_TEAM_COLOR, MY_TEAM_COLOR, ScoreBars } from "./ScoreBars.js";

export function TdmHud() {
  const { state } = useUi();
  const lobby = state.lobby.value;

  if (lobby && lobby.gametype === "ffa") {
    return null;
  }

  const isTdm = lobby?.gametype === "tdm";
  const counters = state.hud.counters.value;
  const alliesScoreCounter = counters.find((c) => c.name === "alliesScore");
  const axisScoreCounter = counters.find((c) => c.name === "axisScore");
  const scoreLimitCounter = counters.find((c) => c.name === "scoreLimit");
  const timeLeftCounter = counters.find((c) => c.name === "timeLeft");

  // Only render for TDM matches or matches with tdm team counters:
  if (!isTdm && (!alliesScoreCounter || !axisScoreCounter)) {
    return null;
  }

  const entries = state.hud.scoreboard.value;
  const myTeam = entries.find((e) => e.isSelf)?.team ?? state.currentTeam.value ?? "allies";
  const alliesScore = alliesScoreCounter?.value ?? entries.filter((e) => e.team === "allies").reduce((sum, e) => sum + e.score, 0);
  const axisScore = axisScoreCounter?.value ?? entries.filter((e) => e.team === "axis").reduce((sum, e) => sum + e.score, 0);
  const timeLeft = timeLeftCounter?.value;

  return (
    <div data-testid="tdm-hud">
      <ScoreBars
        top={myTeam === "allies" ? alliesScore : axisScore}
        bottom={myTeam === "allies" ? axisScore : alliesScore}
        limit={scoreLimitCounter?.value ?? lobby?.scoreLimit ?? DEFAULT_TDM_SCORE_LIMIT}
        topColor={MY_TEAM_COLOR}
        bottomColor={ENEMY_TEAM_COLOR}
        timeLeft={timeLeft}
        unlimited={timeLeft === 0 && lobby?.timeLimit === 0}
      />
    </div>
  );
}
