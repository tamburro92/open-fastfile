import { useUi } from "../context.js";
import styles from "./MatchEnd.module.css";

export function MatchEnd() {
  const { state } = useUi();
  const reason = state.hud.matchEndReason.value;
  const winner = state.hud.matchWinner.value;

  if (!reason) {
    return null;
  }

  const lobby = state.lobby.value;
  const entries = state.hud.scoreboard.value;
  const selfEntry = entries.find((e) => e.isSelf);
  const myTeam = selfEntry?.team ?? (state.currentTeam.value ? state.currentTeam.value : undefined);
  const isTdm = lobby?.gametype === "tdm" || (lobby?.gametype !== "ffa" && Boolean(myTeam));

  let title: string;
  let titleClass: string | undefined;
  let subtitle: string;

  if (isTdm) {
    if (winner === "draw") {
      title = "DRAW";
      titleClass = styles.draw;
      subtitle = `${reason} • Stalemate`;
    } else if (myTeam && winner === myTeam) {
      title = "VICTORY";
      titleClass = styles.victory;
      subtitle = `${reason} • Team Victory`;
    } else {
      title = "DEFEAT";
      titleClass = styles.defeat;
      subtitle = `${reason} • ${winner ? winner.toUpperCase() : "Enemy"} Victory`;
    }
  } else {
    // In Call of Duty FFA, 1st place (and top 3) counts as victory; 1st place is the undisputed winner:
    const isVictory = selfEntry && (selfEntry.rank === 1 || selfEntry.name === winner);
    title = isVictory ? "VICTORY" : "DEFEAT";
    titleClass = isVictory ? styles.victory : styles.defeat;
    subtitle = winner && !isVictory ? `${reason} • Winner: ${winner}` : reason;
  }

  return (
    <div class={styles.bannerContainer} data-testid="match-end-banner">
      <h1 class={titleClass}>{title}</h1>
      <p class={styles.reason}>{subtitle}</p>
    </div>
  );
}
