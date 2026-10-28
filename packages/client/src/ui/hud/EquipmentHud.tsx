import { useUi } from "../context.js";
import styles from "./EquipmentHud.module.css";

export function EquipmentHud() {
  const ui = useUi();
  const player = ui.state.hud.player.value;
  const eq = ui.state.hud.equipment.value;

  if (!player || player.dead) {
    return null;
  }

  const lethal = eq.lethal;
  const tactical = eq.tactical;

  if (!lethal && !tactical) {
    return null;
  }

  return (
    <div class={styles.equipment} data-testid="hud-equipment">
      {tactical && (
        <div class={tactical.count > 0 ? styles.item : styles.itemEmpty} data-testid="hud-tactical">
          <span class={styles.keyHint}>Q</span>
          <span class={styles.name}>{tactical.name}</span>
          <span class={tactical.count > 0 ? styles.count : styles.countEmpty}>
            x{tactical.count}
          </span>
        </div>
      )}
      {lethal && (
        <div class={lethal.count > 0 ? styles.item : styles.itemEmpty} data-testid="hud-lethal">
          <span class={styles.keyHint}>G</span>
          <span class={styles.name}>{lethal.name}</span>
          <span class={lethal.count > 0 ? styles.count : styles.countEmpty}>
            x{lethal.count}
          </span>
        </div>
      )}
    </div>
  );
}
