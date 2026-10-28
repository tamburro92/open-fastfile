import { useUi } from "../context.js";
import styles from "./DamageIndicator.module.css";

/**
 * Authentic MW3 Directional Damage Indicator & Vignette.
 *
 * Shows a curved directional red wedge pointing toward the damage source
 * (blast center or attacker) along with a subtle bloody edge vignette.
 */
export function DamageIndicator() {
  const ui = useUi();
  const damage = ui.state.hud.damageIndicator.value;
  const player = ui.state.hud.player.value;

  if (!damage || !player || player.dead) {
    return null;
  }

  const opacity = Math.max(0.2, Math.min(1.0, damage.intensity));

  return (
    <div class={styles.container} data-testid="hud-damage-indicator">
      {/* Edge blood vignette */}
      <div
        class={styles.vignette}
        style={{
          opacity: opacity * 0.8,
        }}
      />

      {/* Directional wedge */}
      <div class={styles.arcCenter}>
        <div
          class={styles.arc}
          style={{
            transform: `rotate(${damage.angle}deg)`,
            opacity,
          }}
        >
          <svg viewBox="0 0 320 320" class={styles.arcSvg} aria-hidden="true">
            <defs>
              <linearGradient id="damageGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#ff1a1a" stop-opacity="1" />
                <stop offset="60%" stop-color="#cc0000" stop-opacity="0.8" />
                <stop offset="100%" stop-color="#880000" stop-opacity="0" />
              </linearGradient>
            </defs>
            {/* Curved crescent arc spanning top ~70 degrees */}
            <path
              d="M 125,40 A 135 135 0 0 1 195,40 L 180,62 A 110 110 0 0 0 140,62 Z"
              fill="url(#damageGrad)"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
