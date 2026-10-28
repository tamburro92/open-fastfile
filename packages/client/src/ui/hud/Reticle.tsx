import { useEffect, useState } from "preact/hooks";
import type { HitMarkerInfo, HudPlayerInfo } from "../../app/uiBridge.js";
import { useUi } from "../context.js";
import styles from "./Reticle.module.css";

/**
 * How long a hit marker stays, milliseconds. Long enough to register at a
 * glance, short enough that two rounds of a burst are two marks rather than one
 * that never goes out.
 */
const HIT_MARKER_MS = 400;

/**
 * How far into the aim the crosshair is gone: a fraction of the weapon's own
 * `ads`, so a weapon with a slow raise fades slower in seconds and every weapon
 * is bare before its sights arrive.
 *
 * Short of 1 on purpose. The last of the transition is where the sight picture
 * becomes readable, and a crosshair still at a few percent there is a second
 * reticle floating beside the real one — which reads as a misaligned sight
 * rather than as a fading crosshair.
 */
const CROSSHAIR_GONE_BY = 0.85;

/**
 * The middle of the screen: where the player is aiming, whether the last round
 * counted, and — upon death — authentic Modern Warfare 3 death presentation.
 *
 * Nothing here is drawn while paused: the pause menu is over the world, and a
 * crosshair on top of a menu is aiming at nothing.
 */
export function Reticle() {
  const { state } = useUi();
  const player = state.hud.player.value;
  if (!player || state.paused.value) {
    return null;
  }
  return player.dead ? <Downed player={player} /> : <Crosshair />;
}

/**
 * Four arms around a gap, and **the gap is the weapon's cone**: the round is
 * going somewhere inside it, so this is a reading of the player's accuracy
 * rather than decoration. Firing and running open it; standing still and aiming
 * close it back to the weapon's own minimum.
 *
 * The arms are elements rather than one SVG path because each is placed by the
 * cone, and `calc()` in a stylesheet is a cheaper way to do that sixty times a
 * second than rebuilding a path string. `--cone` is a fraction of *half* the
 * viewport height (app/uiBridge.ts), which is exactly what `50vh` turns back
 * into pixels — so this needs no camera, no field of view and no resize
 * listener to stay honest at any window size.
 */
function Crosshair() {
  const hud = useUi().state.hud;
  const cone = hud.cone.value;
  // Aiming replaces the crosshair with the weapon's own sights, so this one
  // fades out on the way down them and is gone before they are up. The hit
  // marker is not part of it: a scoped shot still has to say that it counted.
  const shown = Math.max(0, 1 - hud.ads.value / CROSSHAIR_GONE_BY);
  return (
    <div class={styles.centre}>
      {shown > 0 && (
        <div class={styles.crosshair} style={`--cone:${cone};opacity:${shown}`} data-testid="crosshair">
          <span class={`${styles.arm} ${styles.up}`} />
          <span class={`${styles.arm} ${styles.down}`} />
          <span class={`${styles.arm} ${styles.left}`} />
          <span class={`${styles.arm} ${styles.right}`} />
        </div>
      )}
      <HitMarker />
    </div>
  );
}

/**
 * The server's answer about a round this player fired, and the only feedback
 * here that is not state: the app is told a hit happened, never that one is
 * "still" happening, so the fade is this component's own.
 *
 * Keyed on the event id so that a second hit restarts the animation rather than
 * joining the first one already under way.
 */
function HitMarker() {
  const hit = useUi().state.hud.hit.value;
  const [shown, setShown] = useState<HitMarkerInfo | null>(null);

  useEffect(() => {
    if (!hit) {
      return;
    }
    setShown(hit);
    const timer = setTimeout(() => setShown(null), HIT_MARKER_MS);
    return () => clearTimeout(timer);
  }, [hit]);

  if (!shown) {
    return null;
  }
  return (
    <svg
      key={shown.id}
      class={shown.lethal ? styles.hitLethal : styles.hit}
      viewBox="-16 -16 32 32"
      aria-hidden="true"
      data-testid={shown.lethal ? "hit-marker-lethal" : "hit-marker"}
    >
      <path d="M-11 -11 L-5 -5 M11 -11 L5 -5 M-11 11 L-5 5 M11 11 L5 5" />
    </svg>
  );
}

/**
 * Dead, and counting. Authentic Modern Warfare 3 multiplayer death overlay:
 * blood vignette, KIA / killer banner, and respawn countdown.
 */
function Downed({ player }: { player: HudPlayerInfo }) {
  const respawnIn = player.respawnIn;
  const killedBy = player.killedBy;

  let countdownText: string;
  if (respawnIn === null) {
    countdownText = "waiting to be brought back";
  } else if (respawnIn > 0) {
    countdownText = `respawning in ${respawnIn.toFixed(1)}s`;
  } else {
    countdownText = "Press SPACE to Respawn";
  }

  return (
    <div class={styles.deathContainer} role="status">
      <div class={styles.deathVignette} aria-hidden="true" />
      <div class={styles.downed}>
        <div class={styles.skullBadge} aria-hidden="true">
          <span class={styles.skullLine} />
          <div class={styles.skullIcon}>
            <svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12c0 3.32 1.62 6.26 4.11 8.05.3.22.68.32 1.05.28l.84-.09v1.76c0 .55.45 1 1 1h8c.55 0 1-.45 1-1v-1.76l.84.09c.37.04.75-.06 1.05-.28C20.38 18.26 22 15.32 22 12c0-5.52-4.48-10-10-10zm-3 12c-.83 0-1.5-.67-1.5-1.5S8.17 11 9 11s1.5.67 1.5 1.5S9.83 14 9 14zm6 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
            </svg>
          </div>
          <span class={styles.skullLine} />
        </div>
        {killedBy ? (
          <>
            <span class={styles.killedByLabel}>KILLED BY</span>
            <span class={styles.downedTitle}>{killedBy}</span>
          </>
        ) : (
          <span class={styles.downedTitle}>KILLED IN ACTION</span>
        )}
        <span class={styles.downedCount}>{countdownText}</span>
      </div>
    </div>
  );
}
