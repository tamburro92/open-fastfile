import { DEFAULT_TDM_SCORE_LIMIT } from "../../app/uiBridge.js";
import { useUi } from "../context.js";
import styles from "./TdmHud.module.css";

function formatTimer(totalSec?: number): string {
  if (totalSec === undefined) {
    return "—";
  }
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

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
  const selfEntry = entries.find((e) => e.isSelf);
  const myTeam = selfEntry?.team ?? state.currentTeam.value ?? "allies";

  const alliesScore = alliesScoreCounter?.value ?? entries.filter((e) => e.team === "allies").reduce((sum, e) => sum + e.score, 0);
  const axisScore = axisScoreCounter?.value ?? entries.filter((e) => e.team === "axis").reduce((sum, e) => sum + e.score, 0);

  const scoreLimit = scoreLimitCounter?.value ?? lobby?.scoreLimit ?? DEFAULT_TDM_SCORE_LIMIT;
  const timeLeft = timeLeftCounter?.value;
  const myKills = state.hud.points.value ?? selfEntry?.score ?? 0;

  const isAllies = myTeam === "allies";
  const names = state.teamNames.value;
  const friendlyName = isAllies ? names.allies : names.axis;
  const friendlyScore = isAllies ? alliesScore : axisScore;
  const enemyName = isAllies ? names.axis : names.allies;
  const enemyScore = isAllies ? axisScore : alliesScore;

  const timerText = timeLeft === 0 && lobby?.timeLimit === 0 ? "UNLIMITED" : formatTimer(timeLeft);

  return (
    <div class={styles.tdmHud} data-testid="tdm-hud">
      <div class={styles.teamsRow}>
        <div class={styles.teamBlock}>
          <span class={styles.friendlyName}>{friendlyName}</span>
          <span class={styles.friendlyScore}>{friendlyScore}</span>
        </div>
        <span class={styles.vsDivider}>VS</span>
        <div class={styles.teamBlock}>
          <span class={styles.enemyName}>{enemyName}</span>
          <span class={styles.enemyScore}>{enemyScore}</span>
        </div>
        {scoreLimit > 0 && <span class={styles.limit}>/ {scoreLimit}</span>}
      </div>
      <div class={styles.infoRow}>
        <span class={styles.personal}>
          Kills: <span class={styles.personalValue}>{myKills}</span>
        </span>
        <span class={styles.timer}>Time: {timerText}</span>
      </div>
    </div>
  );
}
