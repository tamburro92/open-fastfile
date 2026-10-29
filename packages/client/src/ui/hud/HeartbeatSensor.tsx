import { useUi } from "../context.js";
import styles from "./HeartbeatSensor.module.css";

/**
 * A heartbeat sensor's screen: the enemies its last sweep found, ahead up and
 * right to the right, out to the edge of its range. MW3 draws it on the gun
 * itself; here it is the same picture on the HUD, by the weapon.
 */
export function HeartbeatSensor() {
  const ui = useUi();
  const blips = ui.state.minimap.heartbeat.value;
  if (blips === null) {
    return null;
  }
  return (
    <div class={styles.screen} data-testid="hud-heartbeat">
      <div class={styles.sweep} />
      {blips
        .filter(({ x, y }) => y >= 0 && Math.hypot(x, y) <= 1)
        .map(({ x, y }, i) => (
          <span key={i} class={styles.blip} style={{ left: `${50 + x * 50}%`, bottom: `${y * 100}%` }} data-testid="heartbeat-blip" />
        ))}
    </div>
  );
}
