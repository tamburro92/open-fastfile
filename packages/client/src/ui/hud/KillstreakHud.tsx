import { streakCost, type KillstreakId } from "../../app/uiBridge.js";
import { useUi } from "../context.js";
import styles from "./KillstreakHud.module.css";

const STREAK_NAMES: Record<KillstreakId, string> = {
  uav: "UAV",
  counter_uav: "Counter-UAV",
  predator_missile: "Predator",
  sentry_gun: "Sentry Gun",
  ims: "I.M.S.",
  sam_turret: "SAM Turret",
  strafe_run: "Strafe Run",
  reaper: "Reaper",
  ac130: "AC-130",
};

/** MW3's own icons, in `public/assets/hud/`. Four streaks have only a crate's, which is the one their menu showed. */
const STREAK_ICONS: Record<KillstreakId, string> = {
  uav: "specialty_uav",
  counter_uav: "specialty_counter_uav",
  predator_missile: "specialty_predator_missile",
  sentry_gun: "specialty_airdrop_sentry",
  ims: "specialty_ims",
  sam_turret: "specialty_sam_turret_crate",
  strafe_run: "specialty_littlebird_flock_crate",
  reaper: "specialty_reaper_crate",
  ac130: "specialty_ac130",
};

export const streakName = (id: KillstreakId): string => STREAK_NAMES[id];
export const streakIcon = (id: KillstreakId): string => `/assets/hud/${STREAK_ICONS[id]}.png`;

export function KillstreakHud() {
  const ui = useUi();
  const player = ui.state.hud.player.value;
  const streakState = ui.state.hud.streaks.value;
  const streakEarned = ui.state.hud.streakEarned.value;

  if (!player || player.dead || !streakState) {
    return null;
  }

  const { package: pkg, streaks, ready, progress, hardline } = streakState;

  return (
    <>
      {streakEarned && (
        <div class={styles.banner} data-testid="hud-streak-earned-banner">
          <img class={styles.bannerIcon} src={streakIcon(streakEarned.streak)} alt={streakName(streakEarned.streak)} />
          <div class={styles.bannerText}>
            <span class={styles.bannerTitle}>KILLSTREAK EARNED</span>
            <span class={styles.bannerSub}>{streakName(streakEarned.streak)}</span>
          </div>
        </div>
      )}

      {pkg !== "specialist" && (
        <div class={styles.container} data-testid="hud-killstreaks">
          <div class={styles.streakStack}>
            {streaks.map((streakId, slot) => {
              const isReady = ready[slot];
              const displayName = streakName(streakId);
              return (
                <div key={`${slot}-${streakId}`} class={`${styles.slot} ${isReady ? styles.slotReady : ""}`} data-testid={`hud-streak-slot-${slot}`}>
                  <div class={styles.iconWrapper}>
                    <img class={`${styles.icon} ${isReady ? "" : styles.iconDim}`} src={streakIcon(streakId)} alt={displayName} />
                  </div>
                  <div class={styles.info}>
                    <span class={styles.name}>{displayName}</span>
                    {isReady ? (
                      <span class={styles.readyKey}>[5]</span>
                    ) : (
                      <span class={styles.cost}>
                        {Math.min(progress, streakCost(streakId, pkg, hardline))}/{streakCost(streakId, pkg, hardline)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
