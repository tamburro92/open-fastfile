import { useUi } from "../context.js";
import styles from "./FfaHud.module.css";

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) {
    return `${n}th`;
  }
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function formatTimer(totalSec?: number): string {
  if (totalSec === undefined) {
    return "—";
  }
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function FfaHud() {
  const { state } = useUi();
  const lobby = state.lobby.value;

  // Only render for FFA matches or matches with ffa counters:
  const isFfa = lobby?.gametype === "ffa";
  const counters = state.hud.counters.value;
  const scoreLimitCounter = counters.find((c) => c.name === "scoreLimit");
  const timeLeftCounter = counters.find((c) => c.name === "timeLeft");

  if (!isFfa && !scoreLimitCounter) {
    return null;
  }

  const entries = state.hud.scoreboard.value;
  const selfEntry = entries.find((e) => e.isSelf);
  const leaderEntry = entries[0];

  const scoreLimit = scoreLimitCounter?.value ?? lobby?.scoreLimit ?? 30;
  const timeLeft = timeLeftCounter?.value;
  const myScore = state.hud.points.value ?? selfEntry?.score ?? 0;
  const myRank = selfEntry?.rank ?? 1;

  const timerText = timeLeft === 0 && lobby?.timeLimit === 0 ? "UNLIMITED" : formatTimer(timeLeft);

  return (
    <div class={styles.ffaHud} data-testid="ffa-hud">
      <div class={styles.topRow}>
        <span class={styles.rank}>{ordinal(myRank).toUpperCase()}</span>
        <span class={styles.score}>{myScore}</span>
        {scoreLimit > 0 && <span class={styles.limit}>/ {scoreLimit}</span>}
      </div>
      <div class={styles.bottomRow}>
        {leaderEntry && myRank > 1 && (
          <span class={styles.leader}>LEADER: {leaderEntry.score}</span>
        )}
        <span class={styles.timer}>TIME: {timerText}</span>
      </div>
    </div>
  );
}
