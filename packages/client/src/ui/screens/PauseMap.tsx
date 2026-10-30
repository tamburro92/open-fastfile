import { useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { MinimapPing } from "../../app/uiBridge.js";
import { useUi } from "../context.js";
import styles from "./PauseMap.module.css";

/**
 * The whole map, as authored, with the player on it. The HUD map turns under
 * the player; this one stays still and turns the arrow instead, by the
 * opposite of the HUD's turn.
 */
export function PauseMap() {
  const { map, pings } = useUi().state.minimap;
  const m = map.value;
  if (!m) {
    return null;
  }
  return (
    <div class={styles.frame} style={{ aspectRatio: `${m.width} / ${m.height}` }} data-testid="pause-map">
      <img class={styles.map} src={m.image} alt="" draggable={false} />
      <Marker />
      <PausePings pings={pings.value} />
    </div>
  );
}

function PausePings({ pings }: { pings: readonly MinimapPing[] }) {
  if (pings.length === 0) {
    return null;
  }
  return (
    <>
      {pings.map((p) => (
        <div
          key={p.id}
          class={p.isEnemy ? styles.enemyPing : styles.selfPing}
          style={{
            left: `${clamp01(p.u) * 100}%`,
            top: `${clamp01(p.v) * 100}%`,
            opacity: p.alpha,
          }}
          data-testid="pause-radar-ping"
          data-enemy={p.isEnemy}
        />
      ))}
    </>
  );
}

/** Written outside Preact's render, like the HUD map, since the pose is a per-frame signal. Off the map, it waits at the edge. */
function Marker() {
  const pose = useUi().state.minimap.pose;
  const marker = useRef<HTMLDivElement>(null);
  useSignalEffect(() => {
    const p = pose.value;
    const el = marker.current;
    if (!el) {
      return;
    }
    el.hidden = !p;
    if (!p) {
      return;
    }
    el.style.left = `${clamp01(p.u) * 100}%`;
    el.style.top = `${clamp01(p.v) * 100}%`;
    el.style.setProperty("--heading", `${-p.rotation}rad`);
  });
  return (
    <div ref={marker} class={styles.marker} hidden>
      <img class={styles.player} src="/assets/hud/compassping_player.png" alt="" />
    </div>
  );
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
