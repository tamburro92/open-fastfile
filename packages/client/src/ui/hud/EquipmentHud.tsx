import { useUi } from "../context.js";
import styles from "./EquipmentHud.module.css";

/** MW3's own HUD icon for each piece of equipment. */
const ICONS: Record<string, string> = {
  frag_grenade_mp: "hud_us_grenade",
  semtex_mp: "hud_us_semtex",
  flash_grenade_mp: "hud_us_flashgrenade",
};

function Icon(props: { id: string; name: string }) {
  const icon = ICONS[props.id];
  return icon ? <img class={styles.icon} src={`/assets/hud/${icon}.png`} alt="" title={props.name} /> : null;
}

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
          <Icon id={tactical.id} name={tactical.name} />
          <span class={ICONS[tactical.id] ? styles.hidden : styles.name}>{tactical.name}</span>
          <span class={tactical.count > 0 ? styles.count : styles.countEmpty}>x{tactical.count}</span>
        </div>
      )}
      {lethal && (
        <div class={lethal.count > 0 ? styles.item : styles.itemEmpty} data-testid="hud-lethal">
          <span class={styles.keyHint}>G</span>
          <Icon id={lethal.id} name={lethal.name} />
          <span class={ICONS[lethal.id] ? styles.hidden : styles.name}>{lethal.name}</span>
          <span class={lethal.count > 0 ? styles.count : styles.countEmpty}>x{lethal.count}</span>
        </div>
      )}
    </div>
  );
}
