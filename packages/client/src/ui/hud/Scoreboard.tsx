import { useUi } from "../context.js";
import styles from "./Scoreboard.module.css";
import type { ScoreboardEntry } from "../../app/uiBridge.js";
import { ENEMY_TEAM_COLOR, formatMatchTime, matchTimeColor, MY_TEAM_COLOR } from "./ScoreBars.js";

/** MW3's own words (`MENU_SCORE_*_WITH`, `MENU_SCOREBOARD`), which its `scoreboard` menu alternates with the mode's name. */
function standing(mine: number, theirs: number, limit: number): string {
  const word = mine > theirs ? "Winning" : mine < theirs ? "Losing" : "Tied";
  return `${word} with ${mine} of ${limit} points.`;
}

function Rows(props: { entries: readonly ScoreboardEntry[]; tint: string }) {
  return (
    <>
      {props.entries.map((entry, i) => (
        <div key={entry.id} class={`${styles.row} ${i % 2 === 0 ? styles.odd : ""}`}>
          <div class={styles.tint} style={{ background: props.tint }} />
          {entry.isSelf && <div class={styles.self} />}
          <span class={styles.player}>{entry.name.endsWith(" [BOT]") ? entry.name.slice(0, -6) : entry.name}</span>
          <span class={styles.score}>{entry.score}</span>
          <span class={styles.kills}>{entry.kills ?? 0}</span>
          {/* Nothing counts assists yet; a 0 would read as a fact about the player. */}
          <span class={styles.assists}>—</span>
          <span class={styles.deaths}>{entry.deaths}</span>
        </div>
      ))}
    </>
  );
}

/**
 * The scoreboard as MW3 lays it out, in its 640x480 units: the band across the top
 * from its `scoreboard` menu, the table from `page_scoreboard`.
 */
export function Scoreboard() {
  const { state } = useUi();
  const open = state.hud.scoreboardOpen.value;
  const winner = state.hud.matchWinner.value;

  // Show if Tab is pressed/open or if the match has concluded
  if (!open && !winner) {
    return null;
  }

  const entries = state.hud.scoreboard.value;
  const lobby = state.lobby.value;
  const counters = state.hud.counters.value;
  const isTdm = lobby?.gametype === "tdm" || (lobby?.gametype !== "ffa" && entries.some((e) => e.team !== undefined));
  const limit = counters.find((c) => c.name === "scoreLimit")?.value ?? lobby?.scoreLimit ?? (isTdm ? 75 : 30);
  const timeLeft = counters.find((c) => c.name === "timeLeft")?.value;
  const untimed = timeLeft === 0 && lobby?.timeLimit === 0;
  const self = entries.find((e) => e.isSelf);
  const myTeam = self?.team ?? state.currentTeam.value ?? "allies";
  const enemyTeam = myTeam === "allies" ? "axis" : "allies";
  const teamScore = (team: string) =>
    counters.find((c) => c.name === `${team}Score`)?.value ?? entries.filter((e) => e.team === team).reduce((sum, e) => sum + e.score, 0);
  const mine = isTdm ? teamScore(myTeam) : (self?.score ?? 0);
  const theirs = teamScore(enemyTeam);
  const mode = lobby?.mode ?? (isTdm ? "Team Deathmatch" : "Free-for-all");
  // The menu's `timeLeft % 8 > 3`: four seconds of each, on a team game.
  const showStanding = isTdm && limit > 0 && timeLeft !== undefined && timeLeft % 8 > 3;
  const names = state.teamNames.value;
  const teamName = (team: string) => (team === "allies" ? names.allies : names.axis).toUpperCase();

  return (
    <div class={styles.overlay} data-testid="tactical-scoreboard">
      <div class={styles.band}>
        <span class={styles.bandScore}>{mine}</span>
        {isTdm && <span class={styles.bandEnemy}>{theirs}</span>}
        <span class={styles.bandCentre}>{showStanding ? standing(mine, theirs, limit) : mode}</span>
        {!untimed && (
          <span class={styles.bandTime} style={{ color: matchTimeColor(timeLeft) }}>
            {formatMatchTime(timeLeft)}
          </span>
        )}
      </div>

      <div class={styles.page}>
        <div class={styles.title}>Scoreboard</div>
        <div class={styles.columns}>
          <span class={styles.player}>Player</span>
          <span class={styles.score}>Score</span>
          <span class={styles.kills}>Kills</span>
          <span class={styles.assists}>Assists</span>
          <span class={styles.deaths}>Deaths</span>
        </div>
        <div class={styles.rows}>
          {isTdm ? (
            [myTeam, enemyTeam].map((team) => (
              <div key={team}>
                <div class={styles.teamHead} style={{ color: team === myTeam ? MY_TEAM_COLOR : ENEMY_TEAM_COLOR }}>
                  <span>{teamName(team)}</span>
                  <span>{teamScore(team)}</span>
                </div>
                <Rows entries={entries.filter((e) => e.team === team)} tint={team === myTeam ? MY_TEAM_COLOR : ENEMY_TEAM_COLOR} />
              </div>
            ))
          ) : (
            <Rows entries={entries} tint="rgb(255 255 0)" />
          )}
        </div>
        <div class={styles.foot} />
      </div>
    </div>
  );
}
