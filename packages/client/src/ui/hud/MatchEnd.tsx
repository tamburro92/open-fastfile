import { useUi } from "../context.js";
import styles from "./MatchEnd.module.css";

export function MatchEnd() {
  const { state } = useUi();
  const reason = state.hud.matchEndReason.value;
  const winner = state.hud.matchWinner.value;

  if (!reason) {
    return null;
  }

  const entries = state.hud.scoreboard.value;
  const selfEntry = entries.find((e) => e.isSelf);
  // In Call of Duty FFA, 1st place (and top 3) counts as victory; 1st place is the undisputed winner:
  const isVictory = selfEntry && (selfEntry.rank === 1 || selfEntry.name === winner);
  const subtitle = winner && !isVictory ? `${reason} • Winner: ${winner}` : reason;

  return (
    <div class={styles.bannerContainer} data-testid="match-end-banner">
      <h1 class={isVictory ? styles.victory : styles.defeat}>
        {isVictory ? "VICTORY" : "DEFEAT"}
      </h1>
      <p class={styles.reason}>{subtitle}</p>
    </div>
  );
}
