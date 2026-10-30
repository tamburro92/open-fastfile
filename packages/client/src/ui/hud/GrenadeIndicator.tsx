import { useUi } from "../context.js";
import styles from "./GrenadeIndicator.module.css";

export function GrenadeIndicator() {
  const ui = useUi();
  const danger = ui.state.hud.grenadeDanger.value;
  const player = ui.state.hud.player.value;

  if (!danger || !player || player.dead) {
    return null;
  }

  // Both swing about the crosshair; the grenade stays upright and the pointer points.
  const angle = `${danger.angle}deg`;

  return (
    <div class={styles.container} data-testid="hud-grenade-indicator">
      <img
        class={styles.icon}
        src="/assets/hud/grenadeicon_white.png"
        alt=""
        style={{ transform: `rotate(${angle}) translateY(var(--icon-at)) rotate(calc(-1 * ${angle}))` }}
      />
      <img class={styles.pointer} src="/assets/hud/grenadepointer_white.png" alt="" style={{ transform: `rotate(${angle}) translateY(var(--pointer-at))` }} />
    </div>
  );
}
