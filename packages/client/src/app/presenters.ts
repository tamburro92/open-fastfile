// What the HUD shows every frame, from the predicted player and the camera: its
// numbers, the minimap's marker, the crosshair's spread and the use prompt.
// One entry in the frame's update list ("presenters").

import { HEARTBEAT } from "@3d/shared/game/equipment.js";
import { shotSpread } from "@3d/shared/sim/recoil.js";
import { eyeHeight } from "@3d/shared/sim/stance.js";
import { isSilenced } from "@3d/shared/sim/weaponRegistry.js";
import type { FiredShotNotice } from "../engine/audio/weapons.js";
import type { CurrentWorld } from "./currentWorld.js";
import type { Hud } from "./hud.js";
import type { MatchController } from "./match.js";
import { minimapPose } from "./minimap.js";
import type { PauseController } from "./pause.js";
import { Radar } from "./radar.js";
import type { ScreenRouter } from "./screens.js";
import type { Systems } from "./systems.js";
import type { UiState } from "./uiBridge.js";
import type { UseFocus } from "./useFocus.js";

/** Degrees to radians, for the two the crosshair's own width needs. */
const DEG = Math.PI / 180;

export class Presenters {
  readonly radar: Radar;
  /** When the heartbeat sensor last swept, ms. */
  private lastSweep = -Infinity;

  constructor(
    private readonly systems: Systems,
    private readonly ui: UiState,
    private readonly hud: Hud,
    private readonly useFocus: UseFocus,
    private readonly pause: PauseController,
    private readonly screens: ScreenRouter,
    private readonly current: CurrentWorld,
    private readonly match: MatchController,
  ) {
    this.radar = new Radar(ui);
    this.systems.weaponAudio.onFire = (shot) => this.onShotFired(shot);
  }

  update(): void {
    const walking = this.pause.mode === "walk" && this.screens.current === "world";
    this.updateMinimap();
    const map = this.current.world?.minimap;
    if (map) {
      this.radar.sweep(this.match.revealed, map);
    }
    this.radar.update();
    this.updateHeartbeat();
    this.updateHud(walking);
    this.updateCone();
    this.updateUseFocus(walking);
  }

  /**
   * A heartbeat sensor's screen, refreshed once a sweep: between sweeps the blips
   * stay where they were found, as the game's do, rather than tracking anyone.
   */
  private updateHeartbeat(): void {
    const player = this.systems.firstPerson.player;
    const signal = this.ui.minimap.heartbeat;
    if (player.weapon?.def.heartbeat !== true || player.dead) {
      signal.value = null;
      this.lastSweep = -Infinity;
      return;
    }
    const now = performance.now();
    if (signal.value !== null && now - this.lastSweep < HEARTBEAT.sweep * 1000) {
      return;
    }
    this.lastSweep = now;
    const { feet, yaw } = player.movement;
    // Ahead is -z at yaw 0, and right is +x: turned into the player's own frame.
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    signal.value = this.match.sensed.map(({ feet: at }) => {
      const dx = at.x - feet.x;
      const dz = at.z - feet.z;
      return { x: (dx * cos - dz * sin) / HEARTBEAT.range, y: (-dx * sin - dz * cos) / HEARTBEAT.range };
    });
  }

  private onShotFired(shot: FiredShotNotice): void {
    const map = this.current.world?.minimap;
    if (!map) {
      return;
    }
    if (isSilenced(shot.def)) {
      return; // Silencer suppresses gunfire radar ping (stealth)
    }
    const localTeam = this.systems.firstPerson.player.side;
    const isEnemy = shot.own
      ? false
      : localTeam !== null && localTeam !== undefined && shot.team !== null && shot.team !== undefined
        ? shot.team !== localTeam
        : true;
    this.radar.record(shot.id, { x: shot.feet.x, z: shot.feet.z }, isEnemy, shot.own, map);
  }

  /** Where the player stands on the HUD map, while walking. Every frame, since it turns with the mouse: ui/hud/Minimap.tsx draws it without re-rendering. */
  private updateMinimap(): void {
    const map = this.current.world?.minimap;
    const pose = this.ui.minimap.pose;
    if (!map || this.pause.mode !== "walk") {
      pose.value = null;
      if (!map) {
        this.radar.clear();
      }
      return;
    }
    const { feet, yaw } = this.systems.firstPerson.player.movement;
    const next = minimapPose(map, feet.x, feet.z, yaw);
    const last = pose.value;
    if (last?.u !== next.u || last.v !== next.v || last.rotation !== next.rotation) {
      pose.value = next;
    }
  }

  /**
   * The HUD's numbers. `local` is the offline path and the `Hud` refuses it in a
   * match, which is what keeps health and ammunition the server's answer; the
   * check here only saves building a snapshot nobody would read.
   */
  private updateHud(walking: boolean): void {
    this.hud.setWalking(walking);
    if (!this.hud.live) {
      this.hud.local(this.systems.firstPerson.player.snapshot());
    }
  }

  /**
   * How far open the crosshair stands: the cone the next round may leave in,
   * divided by the half-angle the camera is showing, which makes it a fraction of
   * half the screen's height that the widget can draw with no camera of its own.
   *
   * Tangents on both, because that is how an angle becomes a distance on a screen
   * — and it is what the game does with the same two numbers
   * (reverse/iw5-bullet-spread/README.md). The camera's own `fov` rather than the
   * resting one, so a weapon that narrows the view to aim does not also appear to
   * open its cone by the amount it just zoomed in.
   */
  private updateCone(): void {
    const { weapon, movement } = this.systems.firstPerson.player;
    const cone = weapon ? shotSpread(weapon.def, weapon.data.spread, weapon.data.ads, eyeHeight(movement)) : 0;
    const half = Math.tan((this.systems.viewer.camera.fov / 2) * DEG);
    this.ui.hud.cone.value = cone > 0 && half > 0 ? Math.tan(cone * DEG) / half : 0;
    // The same prediction and for the same reason: the crosshair gives way to the
    // weapon's sights as they come up (ui/hud/Reticle.tsx).
    this.ui.hud.ads.value = weapon ? weapon.data.ads : 0;
  }

  /**
   * What the use key would use now, from the predicted player — the same rule the
   * server applies to the input when the key goes down — and the prompt on it.
   * Nothing while not walking, or dead.
   */
  private updateUseFocus(walking: boolean): void {
    const session = this.current.session;
    const world = session?.world;
    const { firstPerson, world: live, collision } = this.systems;
    const player = firstPerson.player;
    if (!session || !world || !walking || player.dead) {
      this.useFocus.update(null);
      return;
    }
    this.useFocus.update({
      world,
      mode: live.presence.mode,
      collision: live,
      presence: live.presence,
      partBounds: (index) => collision.partBounds(index),
      movement: player.movement,
      where: () => this.match.surroundings(session, world),
    });
  }
}
