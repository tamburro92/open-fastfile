import { useComputed, useSignalEffect } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { MinimapInfo, MinimapPing } from "../../app/uiBridge.js";
import { useUi } from "../context.js";
import styles from "./Minimap.module.css";

/**
 * The map around the player, turned so they always face up: the image turns
 * and slides under a fixed arrow. Shown while walking in a world that has a
 * `minimap`.
 */
export function Minimap() {
  const { minimap } = useUi().state;
  const map = minimap.map.value;
  // Only whether there is a pose re-renders this; the pose itself changes every frame.
  const walking = useComputed(() => minimap.pose.value !== null).value;
  if (!map) {
    return null;
  }
  return (
    <div class={styles.frame} hidden={!walking} data-testid="minimap">
      <MapImage map={map} />
      <svg class={styles.player} viewBox="-10 -10 20 20" aria-hidden="true">
        <path d="M0 -8 L6.5 7 L0 3.5 L-6.5 7 Z" />
      </svg>
    </div>
  );
}

/**
 * Follows the pose outside Preact's render: the effect writes the transform
 * straight to the image and the radar pings overlay layer.
 */
function MapImage({ map }: { map: MinimapInfo }) {
  const { pose, pings } = useUi().state.minimap;
  const image = useRef<HTMLImageElement>(null);
  const pingsLayer = useRef<HTMLDivElement>(null);
  useSignalEffect(() => {
    const p = pose.value;
    if (p) {
      const transform = `rotate(${p.rotation}rad) translate(${-p.u * 100}%, ${-p.v * 100}%)`;
      if (image.current) {
        image.current.style.transform = transform;
      }
      if (pingsLayer.current) {
        pingsLayer.current.style.transform = transform;
      }
    }
  });
  return (
    <>
      <img
        ref={image}
        class={styles.map}
        src={map.image}
        alt=""
        draggable={false}
        style={{ width: `${map.width * 100}%`, height: `${map.height * 100}%` }}
      />
      <div
        ref={pingsLayer}
        class={styles.pingsLayer}
        style={{ width: `${map.width * 100}%`, height: `${map.height * 100}%` }}
      >
        <PingMarkers pings={pings.value} />
      </div>
    </>
  );
}

function PingMarkers({ pings }: { pings: readonly MinimapPing[] }) {
  if (pings.length === 0) {
    return null;
  }
  return (
    <>
      {pings.map((p) => (
        <span
          key={p.id}
          class={p.isEnemy ? styles.enemyPing : styles.selfPing}
          style={{
            left: `${p.u * 100}%`,
            top: `${p.v * 100}%`,
            opacity: p.alpha,
          }}
          data-testid="radar-ping"
          data-enemy={p.isEnemy}
        />
      ))}
    </>
  );
}
