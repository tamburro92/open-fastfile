import { useUi } from "../context.js";
import styles from "./Scoreboard.module.css";
import type { ScoreboardEntry } from "../../app/uiBridge.js";

export function Scoreboard() {
  const { state } = useUi();
  const open = state.hud.scoreboardOpen.value;
  const winner = state.hud.matchWinner.value;

  // Show if Tab is pressed/open or if the match has concluded
  if (!open && !winner) {
    return null;
  }

  const entries = state.hud.scoreboard.value;
  const lobby = state.lobby.value;
  const counters = state.hud.counters.value;

  const isTdm = lobby?.gametype === "tdm" || (lobby?.gametype !== "ffa" && entries.some((e) => e.team !== undefined));
  const defaultScoreLimit = isTdm ? 75 : 30;
  const scoreLimit = counters.find((c) => c.name === "scoreLimit")?.value ?? lobby?.scoreLimit ?? defaultScoreLimit;
  const timeLeftSec = counters.find((c) => c.name === "timeLeft")?.value;

  const alliesScore = counters.find((c) => c.name === "alliesScore")?.value ?? entries.filter((e) => e.team === "allies").reduce((sum, e) => sum + e.score, 0);
  const axisScore = counters.find((c) => c.name === "axisScore")?.value ?? entries.filter((e) => e.team === "axis").reduce((sum, e) => sum + e.score, 0);

  const formatTimer = (totalSec?: number) => {
    if (totalSec === undefined) {
      return "—";
    }
    if (totalSec === 0 && lobby?.timeLimit === 0) {
      return "UNLIMITED";
    }
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const limitText = scoreLimit === 0 ? "UNLIMITED" : String(scoreLimit);

  const renderTable = (teamEntries: ScoreboardEntry[], showRank = true) => (
    <table class={styles.table}>
      <thead>
        <tr>
          {showRank && <th class={styles.th}>POS</th>}
          <th class={styles.th}>PLAYER</th>
          <th class={`${styles.th} ${styles.thRight}`}>SCORE</th>
          <th class={`${styles.th} ${styles.thRight}`}>DEATHS</th>
        </tr>
      </thead>
      <tbody>
        {teamEntries.length === 0 ? (
          <tr class={styles.row}>
            <td class={styles.td} colspan={showRank ? 4 : 3} style={{ textAlign: "center", color: "#64748b" }}>
              Waiting for players...
            </td>
          </tr>
        ) : (
          teamEntries.map((entry) => (
            <tr key={entry.id} class={`${styles.row} ${entry.isSelf ? styles.selfRow : ""}`}>
              {showRank && <td class={`${styles.td} ${styles.rank}`}>#{entry.rank}</td>}
              <td class={`${styles.td} ${styles.name}`}>
                {entry.name}
                {entry.isSelf && <span class={styles.youBadge}>YOU</span>}
              </td>
              <td class={`${styles.td} ${styles.tdRight}`}>{entry.score}</td>
              <td class={`${styles.td} ${styles.tdRight}`}>{entry.deaths}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  return (
    <div class={styles.overlay} data-testid="tactical-scoreboard">
      <div class={styles.header}>
        <h2 class={styles.modeTitle}>{lobby?.mode ?? (isTdm ? "Team Deathmatch" : "Free-for-All")}</h2>
        <div class={styles.matchInfo}>
          <div class={styles.infoItem}>
            <span>TIME:</span>
            <span class={styles.infoVal}>{formatTimer(timeLeftSec)}</span>
          </div>
          <div class={styles.infoItem}>
            <span>LIMIT:</span>
            <span class={styles.infoVal}>{limitText}</span>
          </div>
        </div>
      </div>

      {isTdm ? (
        <div>
          <div class={styles.teamSection}>
            <div class={`${styles.teamHeader} ${styles.alliesHeader}`}>
              <span>ALLIES</span>
              <span class={styles.teamScore}>{alliesScore}</span>
            </div>
            {renderTable(entries.filter((e) => e.team === "allies"), false)}
          </div>
          <div class={styles.teamSection}>
            <div class={`${styles.teamHeader} ${styles.axisHeader}`}>
              <span>AXIS</span>
              <span class={styles.teamScore}>{axisScore}</span>
            </div>
            {renderTable(entries.filter((e) => e.team === "axis"), false)}
          </div>
        </div>
      ) : (
        renderTable(entries, true)
      )}

      <div class={styles.footer}>Call of Duty Tactical Scoreboard • Tab to Toggle</div>
    </div>
  );
}
