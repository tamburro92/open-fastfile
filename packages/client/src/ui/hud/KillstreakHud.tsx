import { useUi } from "../context.js";
import { STREAK_COST_MAP } from "../../app/uiBridge.js";
import styles from "./KillstreakHud.module.css";

const STREAK_NAMES: Record<string, string> = {
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

export function KillstreakHud() {
  const ui = useUi();
  const player = ui.state.hud.player.value;
  const streakState = ui.state.hud.streaks.value;
  const streakEarned = ui.state.hud.streakEarned.value;

  if (!player || player.dead) {
    return null;
  }

  const pkg = streakState.package;
  const streaks = streakState.streaks;
  const ready = streakState.ready;
  const points = pkg === "support" ? streakState.totalPoints : streakState.killsThisLife;

  return (
    <>
      {streakEarned && (
        <div class={styles.banner} data-testid="hud-streak-earned-banner">
          <img class={styles.bannerIcon} src={streakEarned.icon} alt={streakEarned.name} />
          <div class={styles.bannerText}>
            <span class={styles.bannerTitle}>KILLSTREAK EARNED</span>
            <span class={styles.bannerSub}>{streakEarned.name}</span>
          </div>
        </div>
      )}

      <div class={styles.container} data-testid="hud-killstreaks">
        <div class={styles.streakStack}>
          {streaks.map((streakId, slot) => {
            const isReady = ready[slot];
            const baseCost = STREAK_COST_MAP[streakId]?.[pkg === "support" ? "support" : "assault"] ?? 5;
            const displayName = STREAK_NAMES[streakId] ?? streakId.toUpperCase();
            const iconUrl = `/assets/hud/specialty_${streakId}.png`;

            return (
              <div
                key={`${slot}-${streakId}`}
                class={`${styles.slot} ${isReady ? styles.slotReady : ""}`}
                data-testid={`hud-streak-slot-${slot}`}
              >
                <div class={styles.iconWrapper}>
                  <img
                    class={`${styles.icon} ${isReady ? "" : styles.iconDim}`}
                    src={iconUrl}
                    alt={displayName}
                  />
                </div>
                <div class={styles.info}>
                  <span class={styles.name}>{displayName}</span>
                  {isReady ? (
                    <span class={styles.readyKey}>[5]</span>
                  ) : (
                    <span class={styles.cost}>
                      {points}/{baseCost}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
