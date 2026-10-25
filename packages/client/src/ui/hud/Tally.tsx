import { useUi } from "../context.js";
import styles from "./Tally.module.css";

/**
 * The gametype's counters, bottom left above the health bar. Each is its
 * declared name over the server's value; a gametype that declares none draws
 * nothing.
 */
export function Counters() {
  const { state } = useUi();
  const counters = state.hud.counters.value;
  const isFfa = state.lobby.value?.gametype === "ffa";
  const visible = isFfa
    ? counters.filter((c) => c.name !== "scoreLimit" && c.name !== "timeLeft")
    : counters;

  if (visible.length === 0) {
    return null;
  }
  return (
    <div class={styles.counters} data-testid="hud-counters">
      {visible.map((counter) => (
        <div key={counter.name} class={styles.counter}>
          <span class={styles.label}>{counter.name}</span>
          <span class={styles.value}>{counter.value}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * This player's purse, bottom right above the magazine. The server's number;
 * nothing in a gametype that keeps no points.
 */
export function Points() {
  const { state } = useUi();
  const isFfa = state.lobby.value?.gametype === "ffa";
  const points = state.hud.points.value;
  // In Free-for-All, the score is cleanly integrated into FfaHud and the Scoreboard,
  // rather than a floating arcade tally above weapon ammo (which is used in Zombies).
  if (isFfa || points === null) {
    return null;
  }
  return (
    <div class={styles.points} data-testid="hud-points">
      {points}
    </div>
  );
}
