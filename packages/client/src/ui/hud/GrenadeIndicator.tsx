import { useUi } from "../context.js";
import styles from "./GrenadeIndicator.module.css";

export function GrenadeIndicator() {
  const ui = useUi();
  const danger = ui.state.hud.grenadeDanger.value;
  const player = ui.state.hud.player.value;

  if (!danger || !player || player.dead) {
    return null;
  }

  // Position around a radius of 90px from screen center towards danger.angle (deg)
  const angleRad = (danger.angle * Math.PI) / 180;
  const radius = 95; // pixels from crosshair
  const x = Math.sin(angleRad) * radius;
  const y = -Math.cos(angleRad) * radius;

  return (
    <div class={styles.container} data-testid="hud-grenade-indicator">
      <div
        class={styles.indicator}
        style={{
          transform: `translate(${x}px, ${y}px) rotate(${danger.angle}deg)`,
        }}
      >
        <svg viewBox="0 0 32 32" class={styles.icon} aria-hidden="true">
          {/* Arrow pointing towards danger */}
          <polygon points="16,1 11,8 21,8" fill="#ffffff" />
          {/* MW3 grenade body silhouette */}
          <ellipse cx="16" cy="20" rx="7" ry="8" fill="#ff2222" stroke="#ffffff" stroke-width="1.5" />
          <rect x="14" y="10" width="4" height="3" fill="#ffffff" />
          <circle cx="16" cy="9.5" r="2" fill="none" stroke="#ffffff" stroke-width="1.5" />
        </svg>
      </div>
    </div>
  );
}
