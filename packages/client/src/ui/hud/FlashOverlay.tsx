import { useUi } from "../context.js";
import styles from "./FlashOverlay.module.css";

export function FlashOverlay() {
  const ui = useUi();
  const alpha = ui.state.hud.flashed.value;

  if (alpha <= 0.01) {
    return null;
  }

  return (
    <div
      class={styles.overlay}
      style={{
        opacity: Math.min(1.0, Math.max(0, alpha)),
      }}
      data-testid="hud-flash-overlay"
      aria-hidden="true"
    />
  );
}
