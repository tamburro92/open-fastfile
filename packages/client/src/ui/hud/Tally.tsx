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
  const isDeathmatch = state.lobby.value?.gametype === "ffa" || state.lobby.value?.gametype === "tdm";
  const dmExcluded = ["scoreLimit", "timeLeft", "alliesScore", "axisScore"];
  const visible = isDeathmatch
    ? counters.filter((c) => !dmExcluded.includes(c.name))
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
  const isDeathmatch = state.lobby.value?.gametype === "ffa" || state.lobby.value?.gametype === "tdm";
  const points = state.hud.points.value;
  // In Free-for-All and Team Deathmatch, the score is cleanly integrated into FfaHud/TdmHud and the Scoreboard,
  // rather than a floating arcade tally above weapon ammo (which is used in Zombies).
  if (isDeathmatch || points === null) {
    return null;
  }
  return (
    <div class={styles.points} data-testid="hud-points">
      {points}
    </div>
  );
}
