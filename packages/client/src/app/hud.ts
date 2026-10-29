// What the HUD shows, and where each number is allowed to come from.
//
// The rule this file exists to keep: **health, death and ammunition are the
// server's answer, and a hit marker is the server's answer about a shot it
// traced itself.** The client predicts its own movement and its own weapon, and
// a HUD built from that prediction would be a display of what this browser hopes
// happened — a full health bar for a player being shot at, until the correction
// arrived. So `snapshot` is the way in, `local` is refused while a match is
// running, and nothing here can reach the predicted `Player` at all.
//
// Plain data out, signals only: this writes `UiState` and the UI reads it
// (app/uiBridge.ts).

import type { DeathEvent, GameEvent } from "@3d/shared/net/messages/events.js";
import { isSuicide, type DamageCause } from "@3d/shared/game/damage.js";
import type { JoinedMessage } from "@3d/shared/net/messages/session.js";
import type { PlayerId } from "@3d/shared/net/messages/fields.js";
import type { PlayerState } from "@3d/shared/sim/player.js";
import type { StreakState } from "@3d/shared/game/streaks.js";
import { DEFAULT_COMBAT_RULES } from "@3d/shared/game/rules.js";
import { getLoadout } from "@3d/shared/sim/loadout.js";
import type { WeaponEntry, WeaponRegistry } from "@3d/shared/sim/weaponRegistry.js";
import type { GametypeDecl } from "@3d/shared/game/gametypes/declaration.js";
import type { PlayerSnapshot } from "@3d/shared/net/messages/snapshot.js";
import type { HudCounter, HudPlayerInfo, KillFeedEntry, UiState } from "./uiBridge.js";

/** Lines the feed keeps, and how long one stays. The games' own figures, near enough. */
const FEED_LINES = 5;
const FEED_SECONDS = 7;

export class Hud {
  /** Until `joined` says otherwise: an offline world plays by the defaults too. */
  private maxHealth = DEFAULT_COMBAT_RULES.maxHealth;
  /** Who this player is on the wire, so their own kills read differently. Undefined offline. */
  private me: PlayerId | undefined;
  /** The gametype brings the dead back itself: no countdown to show (`CombatRules.respawnDelay`). */
  private noCountdown = false;
  /** What the gametype keeps that the HUD shows: its counters' names, and whether there are points. */
  private counterNames: readonly string[] = [];
  private keepsPoints = false;
  /**
   * A game server is answering. While it is, `local` is ignored — that is the
   * whole of "the server decides", and it is one flag rather than a rule each
   * caller has to remember.
   */
  private connected = false;
  /** In the world on foot. Outside it there is no HUD at all, whatever the wire says. */
  private walking = false;
  /** The feed, newest first, with the moment each line arrived: the signal carries lines and not clocks. */
  private readonly lines: { line: KillFeedEntry; at: number }[] = [];
  /** Player death tallies for the scoreboard. */
  private readonly playerDeaths = new Map<PlayerId, number>();
  /** Current gametype declaration, if known. */
  private gametype?: GametypeDecl;
  private grenadeDangerExpiresAt = 0;
  private damageIndicatorExpiresAt = 0;
  private previousHealth: number | undefined;
  private flashedUntil = 0;
  private flashDuration = 0;
  private wasDead = false;
  private lastKiller: string | null = null;
  private streakEarnedExpiresAt = 0;

  constructor(
    private readonly ui: UiState,
    /** Asked each time: the catalogue arrives after boot, and a weapon index means nothing before it. */
    private readonly weapons: () => WeaponRegistry,
  ) {}

  /** Whether a game server is answering, and so whose numbers these are. */
  get live(): boolean {
    return this.connected;
  }

  /**
   * In a match: the rules give the bar its denominator, `you` says which feed
   * lines are ours, and the gametype — undefined for one this build does not
   * know — says which of the match's numbers there are to show.
   */
  joined(message: JoinedMessage, you: PlayerId, gametype?: GametypeDecl): void {
    this.maxHealth = message.rules.maxHealth;
    this.noCountdown = !message.rules.timedRespawn;
    this.me = you;
    this.gametype = gametype;
    this.connected = true;
    this.counterNames = gametype?.counters ?? [];
    this.keepsPoints = gametype?.points === true;
    this.ui.hud.counters.value = this.counterNames.map((name) => ({ name, value: 0 }));
  }

  /**
   * The gametype's counters as the snapshot carries them — values in the
   * declaration's order — written only when one has changed.
   */
  counters(values: readonly number[]): void {
    const next: HudCounter[] = this.counterNames.map((name, i) => ({ name, value: values[i] ?? 0 }));
    const last = this.ui.hud.counters.value;
    if (next.length !== last.length || next.some((counter, i) => counter.value !== last[i]!.value || counter.name !== last[i]!.name)) {
      this.ui.hud.counters.value = next;
    }
  }

  /** Whether the player is on foot in the world. The HUD is nothing in the dollhouse or between worlds. */
  setWalking(walking: boolean): void {
    if (this.walking !== walking) {
      this.walking = walking;
      if (!walking) {
        this.ui.hud.player.value = null;
      }
    }
  }

  /**
   * One authoritative tick: the player's own state as the server has it, and
   * what has happened that they have not been told yet.
   *
   * `events` is already de-duplicated (net/connection.ts), so this appends
   * blindly. De-duplicating here as well would hide the day that stops being
   * true, and a kill feed that silently swallows a repeat looks exactly like one
   * that never had a repeat to swallow.
   */
  snapshot(self: PlayerState | undefined, events: readonly GameEvent[], now: number, others: readonly PlayerSnapshot[] = []): void {
    if (self) {
      this.publish(self);
      const points = this.keepsPoints ? self.points : null;
      if (this.ui.hud.points.value !== points) {
        this.ui.hud.points.value = points;
      }
      if (this.previousHealth !== undefined && self.health < this.previousHealth && !self.dead) {
        // Towards the blast that did it, if one went off on this tick; ahead otherwise.
        let damageAngle: number | null = null;
        for (const event of events) {
          if (event.kind === "detonate" && event.what !== "flashbang") {
            damageAngle = relativeAngle(event.at.x - self.movement.feet.x, event.at.z - self.movement.feet.z, self.movement.yaw);
            break;
          }
        }
        this.ui.hud.damageIndicator.value = {
          angle: damageAngle ?? 0,
          intensity: Math.min(1.0, (this.previousHealth - self.health) / 45),
          expiresAt: now + 750,
        };
        this.damageIndicatorExpiresAt = now + 750;
      }
      this.previousHealth = self.health;
    }
    for (const event of events) {
      // Named rather than defaulted: the tail carries physics spawns now, and an
      // `else` here would have put a corpse in the kill feed. A fifth kind is a
      // compile error in this switch, which is where it should be noticed.
      switch (event.kind) {
        case "hit":
          this.ui.hud.hit.value = { id: event.id, lethal: event.lethal };
          break;
        case "death":
          this.playerDeaths.set(event.victim, (this.playerDeaths.get(event.victim) ?? 0) + 1);
          this.addKill(event, now);
          break;
        case "spawn":
          break; // the HUD has nothing to say about a body on the floor
        case "detonate":
          break; // drawn and heard by the projectiles view; a hit already said what it cost
        case "announce":
          if (event.what === "ffaWinner") {
            this.ui.hud.matchWinner.value = event.player ? this.nameOf(event.player) : null;
            this.ui.hud.matchEndReason.value = "Score Limit Reached";
          } else if (event.what === "ffaTimeUp") {
            this.ui.hud.matchWinner.value = event.player ? this.nameOf(event.player) : null;
            this.ui.hud.matchEndReason.value = "Time Limit Reached";
          } else if (event.what === "tdmWinner") {
            const team = event.team !== null && this.gametype ? (this.gametype.teams[event.team] ?? null) : null;
            this.ui.hud.matchWinner.value = team;
            this.ui.hud.matchEndReason.value = "Score Limit Reached";
          } else if (event.what === "tdmTimeUp") {
            const team = event.team !== null && this.gametype ? (this.gametype.teams[event.team] ?? null) : null;
            this.ui.hud.matchWinner.value = team;
            this.ui.hud.matchEndReason.value = "Time Limit Reached";
          } else if (event.what === "tdmDraw") {
            this.ui.hud.matchWinner.value = "draw";
            this.ui.hud.matchEndReason.value = "Time Limit Reached";
          } else if (event.what === "flashbang") {
            if (event.player === this.me || event.player === null) {
              const durSeconds = (event.value ?? 30) / 10;
              this.triggerFlash(durSeconds, now);
            }
          } else if (event.what === "killstreak_earned") {
            // Only the banner: which slots are ready is the snapshot's to say (`streaks`).
            const streak = this.ui.hud.streaks.value?.streaks[event.value ?? 0];
            if (event.player === this.me && streak) {
              this.ui.hud.streakEarned.value = { streak };
              this.streakEarnedExpiresAt = now + 3500;
            }
          }
          break;
      }
    }
    this.updateScoreboard(self, others);
    this.expire(now);
  }

  /** Update the tactical scoreboard ranking. */
  private updateScoreboard(self: PlayerState | undefined, others: readonly PlayerSnapshot[]): void {
    if (!this.connected) {
      return;
    }
    const teamOf = (teamIndex: number | null | undefined): string | undefined => {
      if (teamIndex === null || teamIndex === undefined || !this.gametype?.teams) {
        return undefined;
      }
      return this.gametype.teams[teamIndex];
    };

    const entries: { id: string; name: string; score: number; deaths: number; isSelf: boolean; team?: string }[] = [];
    if (this.me !== undefined) {
      entries.push({
        id: this.me,
        name: this.nameOf(this.me),
        score: self?.points ?? 0,
        deaths: this.playerDeaths.get(this.me) ?? 0,
        isSelf: true,
        team: teamOf(self?.team) ?? this.ui.currentTeam.value ?? undefined,
      });
    }
    for (const peer of others) {
      entries.push({
        id: peer.id,
        name: this.nameOf(peer.id),
        score: peer.state.points,
        deaths: this.playerDeaths.get(peer.id) ?? 0,
        isSelf: false,
        team: teamOf(peer.state.team),
      });
    }

    entries.sort((a, b) => b.score - a.score || a.deaths - b.deaths);
    this.ui.hud.scoreboard.value = entries.map((entry, idx) => ({
      rank: idx + 1,
      ...entry,
    }));
  }

  /**
   * The local player's own state, for a world with no match behind it.
   *
   * Refused outright while connected. Offline there is nobody to ask and the
   * numbers are nobody's but this browser's; in a match they are the server's,
   * and a prediction arriving here would overwrite the correction sixty times a
   * second.
   */
  local(state: PlayerState): void {
    if (!this.connected) {
      this.publish(state);
    }
  }

  /** Out of the world, or out of the match: the HUD holds nothing over. */
  clear(): void {
    this.connected = false;
    this.walking = false;
    this.me = undefined;
    this.maxHealth = DEFAULT_COMBAT_RULES.maxHealth;
    this.noCountdown = false;
    this.counterNames = [];
    this.keepsPoints = false;
    this.gametype = undefined;
    this.playerDeaths.clear();
    this.ui.hud.scoreboard.value = [];
    this.ui.hud.scoreboardOpen.value = false;
    this.ui.hud.matchWinner.value = null;
    this.ui.hud.matchEndReason.value = null;
    this.ui.hud.points.value = null;
    this.ui.hud.counters.value = [];
    this.ui.hud.streaks.value = null;
    this.lines.length = 0;
    this.ui.hud.player.value = null;
    // Written by `App` rather than here (it is predicted, not the server's), but
    // cleared here with the rest: "the HUD holds nothing over" is one place.
    this.ui.hud.cone.value = 0;
    this.ui.hud.ads.value = 0;
    this.ui.hud.hit.value = null;
    this.ui.hud.feed.value = [];
    this.resetEquipment();
    this.ui.hud.grenadeDanger.value = null;
    this.ui.hud.damageIndicator.value = null;
    this.ui.hud.flashed.value = 0;
    this.grenadeDangerExpiresAt = 0;
    this.damageIndicatorExpiresAt = 0;
    this.previousHealth = undefined;
    this.flashedUntil = 0;
    this.flashDuration = 0;
    this.wasDead = false;
    this.streakEarnedExpiresAt = 0;
    this.ui.hud.streakEarned.value = null;
  }

  triggerFlash(duration: number, now: number): void {
    this.flashDuration = duration;
    this.flashedUntil = now + duration * 1000;
    this.ui.hud.flashed.value = 1.0;
  }

  useLethal(): void {
    const eq = this.ui.hud.equipment.value;
    if (eq.lethal && eq.lethal.count > 0) {
      this.ui.hud.equipment.value = {
        ...eq,
        lethal: { ...eq.lethal, count: eq.lethal.count - 1 },
      };
    }
  }

  useTactical(): void {
    const eq = this.ui.hud.equipment.value;
    if (eq.tactical && eq.tactical.count > 0) {
      this.ui.hud.equipment.value = {
        ...eq,
        tactical: { ...eq.tactical, count: eq.tactical.count - 1 },
      };
    }
  }

  resetEquipment(): void {
    const playing = this.ui.playingClass.value;
    const selected = playing ?? this.ui.selectedLoadout.value;
    const loadout = getLoadout(this.ui.loadouts.value, selected);
    const lethalId = loadout?.lethal ?? "frag_grenade_mp";
    const tacticalId = loadout?.tactical ?? "flash_grenade_mp";
    this.ui.hud.equipment.value = {
      lethal: {
        id: lethalId,
        name: lethalId === "semtex_mp" ? "Semtex" : "Frag",
        count: 1,
      },
      tactical: {
        id: tacticalId,
        name: "Flash",
        count: 2,
      },
    };
  }

  /**
   * Write the player signal, and only when something a player could see has
   * changed: this runs every tick, and a fresh object each time re-renders the
   * health and ammunition widgets at 60 Hz for nothing.
   */
  private publish(state: PlayerState): void {
    if (!this.walking) {
      return;
    }
    if (this.wasDead && !state.dead) {
      this.resetEquipment();
      this.lastKiller = null;
    }
    this.wasDead = state.dead;
    const next = this.describe(state);
    if (!same(this.ui.hud.player.value, next)) {
      this.ui.hud.player.value = next;
    }
  }

  private describe(state: PlayerState): HudPlayerInfo {
    const entry = this.weapons().entry(this.weapons().idAt(state.weaponIndex));
    return {
      health: state.health,
      maxHealth: this.maxHealth,
      dead: state.dead,
      // A tenth of a second: the countdown is drawn to one decimal, so this is
      // what makes the comparison above true on the other fifty-odd ticks.
      respawnIn: this.noCountdown ? null : Math.round(state.respawnIn * 10) / 10,
      killedBy: state.dead ? this.lastKiller : null,
      weapon:
        state.weapon === null || entry === undefined
          ? null
          : {
              // The underbarrel weapon by its own name while it is the half in hand, as MW3's HUD says "M203".
              name: (state.alt?.held && underbarrelName(entry, state.attachments)) || (entry.display ?? entry.id),
              ammo: state.weapon.ammo,
              reloading: state.weapon.state === "reloading",
              // Only a launcher's reserve is finite (`WeaponController.stock`); everything else reloads for ever.
              reserve: state.alt?.held && underbarrelName(entry, state.attachments) ? state.alt.stock : null,
            },
    };
  }

  private addKill(event: DeathEvent, now: number): void {
    const suicide = isSuicide(event.victim, event.killer);
    const killerName = suicide || event.killer === null ? null : this.nameOf(event.killer);
    const line: KillFeedEntry = {
      id: event.id,
      killer: killerName,
      victim: this.nameOf(event.victim),
      how: suicide ? (event.killer === null ? BY_THE_WORLD : BY_THEMSELVES)[event.cause] : null,
      mine: this.me !== undefined && (event.killer === this.me || event.victim === this.me),
    };
    if (this.me !== undefined && event.victim === this.me) {
      this.lastKiller = killerName;
    }
    this.lines.unshift({ line, at: now });
    this.lines.length = Math.min(this.lines.length, FEED_LINES);
    this.ui.hud.feed.value = this.lines.map((held) => held.line);
  }

  private expire(now: number): void {
    const before = this.lines.length;
    while (this.lines.length > 0 && now - this.lines[this.lines.length - 1]!.at > FEED_SECONDS * 1000) {
      this.lines.pop();
    }
    if (this.lines.length !== before) {
      this.ui.hud.feed.value = this.lines.map((held) => held.line);
    }
    if (this.grenadeDangerExpiresAt > 0 && now >= this.grenadeDangerExpiresAt) {
      this.ui.hud.grenadeDanger.value = null;
      this.grenadeDangerExpiresAt = 0;
    }
    if (this.damageIndicatorExpiresAt > 0 && now >= this.damageIndicatorExpiresAt) {
      this.ui.hud.damageIndicator.value = null;
      this.damageIndicatorExpiresAt = 0;
    }
    if (this.streakEarnedExpiresAt > 0 && now >= this.streakEarnedExpiresAt) {
      this.ui.hud.streakEarned.value = null;
      this.streakEarnedExpiresAt = 0;
    }
    if (this.flashedUntil > 0) {
      if (now >= this.flashedUntil) {
        this.ui.hud.flashed.value = 0;
        this.flashedUntil = 0;
      } else {
        const remaining = (this.flashedUntil - now) / 1000;
        const alpha = Math.min(1.0, Math.max(0, remaining / (this.flashDuration || 1)));
        this.ui.hud.flashed.value = alpha;
      }
    }
  }

  /** This player's strike package as the server keeps it, written only when it changed. */
  streaks(next: StreakState | null): void {
    const last = this.ui.hud.streaks.value;
    if (!sameStreaks(last, next)) {
      this.ui.hud.streaks.value = next;
    }
  }

  /**
   * The nearest live grenade, as an offset from this player's feet, or null for
   * none in range. Read off the snapshot's projectiles rather than told: the
   * client already knows where every grenade is.
   */
  grenadeThreat(offset: { x: number; z: number } | null, yaw: number, now: number): void {
    if (!offset) {
      return; // the last one fades on its own (`expire`)
    }
    this.ui.hud.grenadeDanger.value = { angle: relativeAngle(offset.x, offset.z, yaw) };
    this.grenadeDangerExpiresAt = now + 350;
  }

  /**
   * A player's name as the lobby gave it. The wire carries ids and nothing else —
   * they are what a snapshot is keyed by — and the lobby the player came from is
   * the only place a browser has ever been told a name.
   */
  private nameOf(id: PlayerId): string {
    if (id === this.me && this.ui.user.value?.username) {
      return this.ui.user.value.username;
    }
    const player = this.ui.lobby.value?.players.find((p) => p.id === id);
    if (player) {
      return player.username;
    }
    if (typeof id === "string" && id.startsWith("#b")) {
      return botDisplayName(id);
    }
    return id;
  }
}

/** Call of Duty multiplayer bot names. */
const BOT_NAMES = ["Ghost", "Soap", "Price", "Roach", "Gaz", "Yuri", "Nikolai", "Makarov", "Shepherd", "Frost", "Sandman", "Grinch"];

export function botDisplayName(id: string): string {
  const match = id.match(/^#b(\d+)$/);
  if (match) {
    const idx = (parseInt(match[1]!, 10) - 1) % BOT_NAMES.length;
    return `${BOT_NAMES[idx]} [BOT]`;
  }
  return id;
}

/**
 * A suicide's line in words, by cause: the world's doing, or their own. A line
 * with a killer names them instead and needs none of this.
 */
const BY_THE_WORLD: Record<DamageCause, string> = {
  bullet: "was shot",
  outOfWorld: "fell out of the world",
  fall: "fell to their death",
  explosion: "was blown up",
  script: "died",
  melee: "was knifed",
};
const BY_THEMSELVES: Record<DamageCause, string> = {
  bullet: "shot themselves",
  outOfWorld: "fell out of the world",
  fall: "fell to their death",
  explosion: "blew themselves up",
  script: "killed themselves",
  melee: "knifed themselves",
};

function same(a: HudPlayerInfo | null, b: HudPlayerInfo): boolean {
  return (
    a !== null &&
    a.health === b.health &&
    a.maxHealth === b.maxHealth &&
    a.dead === b.dead &&
    a.respawnIn === b.respawnIn &&
    a.killedBy === b.killedBy &&
    a.weapon?.name === b.weapon?.name &&
    a.weapon?.ammo === b.weapon?.ammo &&
    a.weapon?.reloading === b.weapon?.reloading &&
    a.weapon?.reserve === b.weapon?.reserve
  );
}

/** MW3's names for its four underbarrel weapons; the asset's own is a localisation key. */
const UNDERBARREL_NAMES: Record<string, string> = { gl: "M203", gp25: "GP25", m320: "M320 GLM", shotgun: "Shotgun" };

/** The underbarrel weapon fitted, by name; null for none, or for a hybrid's other optic, which is the same gun. */
function underbarrelName(entry: WeaponEntry, fitted: readonly number[]): string | null {
  const attachment = entry.attachments.find((one, slot) => one.alt && fitted.includes(slot));
  if (!attachment || attachment.alt?.shareAmmo) {
    return null;
  }
  return UNDERBARREL_NAMES[attachment.id] ?? attachment.id;
}

/**
 * Where a horizontal offset lies relative to a view, in whole degrees clockwise
 * from ahead — positive to the right — because that is how CSS's `rotate` and
 * both indicators draw it. Yaw itself turns the other way, hence the sign.
 */
function relativeAngle(dx: number, dz: number, yaw: number): number {
  const left = Math.atan2(-dx, -dz) - yaw;
  return Math.round((-Math.atan2(Math.sin(left), Math.cos(left)) * 180) / Math.PI);
}

function sameStreaks(a: StreakState | null, b: StreakState | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return (
    a.package === b.package &&
    a.progress === b.progress &&
    a.hardline === b.hardline &&
    a.streaks.every((id, i) => id === b.streaks[i]) &&
    a.ready.every((ready, i) => ready === b.ready[i])
  );
}
