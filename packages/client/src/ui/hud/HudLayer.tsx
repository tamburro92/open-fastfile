import { useUi } from "../context.js";
import { FfaHud } from "./FfaHud.js";
import { TdmHud } from "./TdmHud.js";
import styles from "./HudLayer.module.css";
import { KillFeed } from "./KillFeed.js";
import { MatchEnd } from "./MatchEnd.js";
import { Minimap } from "./Minimap.js";
import { NameTags } from "./NameTags.js";
import { Reticle } from "./Reticle.js";
import { Scoreboard } from "./Scoreboard.js";
import { UsePrompt } from "./UsePrompt.js";
import { Counters, Points } from "./Tally.js";
import { Ammo, Health } from "./Vitals.js";
import { EquipmentHud } from "./EquipmentHud.js";
import { KillstreakHud } from "./KillstreakHud.js";
import { GrenadeIndicator } from "./GrenadeIndicator.js";
import { HeartbeatSensor } from "./HeartbeatSensor.js";
import { DamageIndicator } from "./DamageIndicator.js";
import { FlashOverlay } from "./FlashOverlay.js";

/**
 * The in-game HUD. Each widget (minimap, weapon, score, connection status)
 * goes in one region. The layer passes clicks through to the game; a widget
 * that needs the pointer sets `pointer-events: auto` on itself.
 *
 * The reticle belongs to none of them: the crosshair and the hit marker are at
 * the middle of the screen, which is where the camera points rather than a
 * corner to lay things out in.
 */
export function HudLayer() {
  return (
    <div class={styles.layer}>
      <NameTags />
      <FlashOverlay />
      <div class={styles.topLeft} data-region="top-left">
        <Minimap />
      </div>
      <div class={styles.topRight} data-region="top-right">
        <KillFeed />
      </div>
      <div class={styles.bottomLeft} data-region="bottom-left">
        <FfaHud />
        <TdmHud />
        <Counters />
        <Health />
      </div>
      <div class={styles.bottomCenter} data-region="bottom-center" />
      <div class={styles.bottomRight} data-region="bottom-right">
        <KillstreakHud />
        <EquipmentHud />
        <Points />
        <Ammo />
      </div>
      <Reticle />
      <GrenadeIndicator />
      <HeartbeatSensor />
      <DamageIndicator />
      <UsePrompt />
      <Scoreboard />
      <MatchEnd />
      <Toast />
    </div>
  );
}

function Toast() {
  const toast = useUi().state.toast.value;
  return toast ? (
    <div class={styles.toast} role="status">
      {toast}
    </div>
  ) : null;
}
