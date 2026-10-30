import styles from "./ScoreBars.module.css";

/** MW3's `MM:SS`, and the three colours its `scoreboard` menu gives the clock as it runs out. */
export function formatMatchTime(seconds: number | undefined): string {
  if (seconds === undefined) {
    return "";
  }
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function matchTimeColor(seconds: number | undefined): string {
  if (seconds !== undefined && seconds < 10) {
    return "rgb(255 128 0)";
  }
  return seconds !== undefined && seconds < 30 ? "rgb(255 191 0)" : "rgb(255 255 255)";
}

function Bar(props: { which: "top" | "bottom"; score: number; limit: number; color: string }) {
  const fill = props.limit > 0 ? Math.min(1, Math.max(0, props.score / props.limit)) : 0;
  const part = (name: string) => `url(/assets/hud/hud_scorebar_${props.which}${name}.png)`;
  return (
    <div class={`${styles.row} ${props.which === "top" ? styles.top : styles.bottom}`}>
      <span class={styles.score}>{props.score}</span>
      <div class={styles.track}>
        <div class={styles.bg} style={{ backgroundImage: part("bar_bg") }} />
        <div class={styles.fill} style={{ width: `${fill * 100}%` }}>
          <div class={styles.bar} style={{ background: props.color, maskImage: part("bar"), WebkitMaskImage: part("bar") }} />
          <div class={styles.cap} style={{ background: props.color, maskImage: part("cap"), WebkitMaskImage: part("cap") }} />
        </div>
      </div>
    </div>
  );
}

/** The two bars of MW3's score HUD, in its own art: `hud_scorebar_*`, tinted as its `g_ScoresColor_*` say. */
export function ScoreBars(props: {
  top: number;
  bottom: number;
  limit: number;
  topColor: string;
  bottomColor: string;
  timeLeft?: number;
  unlimited?: boolean;
}) {
  return (
    <div class={styles.bars}>
      {!props.unlimited && (
        <span class={styles.timer} style={{ color: matchTimeColor(props.timeLeft) }}>
          {formatMatchTime(props.timeLeft)}
        </span>
      )}
      <Bar which="top" score={props.top} limit={props.limit} color={props.topColor} />
      <Bar which="bottom" score={props.bottom} limit={props.limit} color={props.bottomColor} />
    </div>
  );
}

/** `g_ScoresColor_MyTeam`, `_EnemyTeam` and `_Free`, read from iw5mp_server.exe. */
export const MY_TEAM_COLOR = "rgb(102 153 217)";
export const ENEMY_TEAM_COLOR = "rgb(191 64 64)";
export const FREE_COLOR = "rgb(194 199 26)";
