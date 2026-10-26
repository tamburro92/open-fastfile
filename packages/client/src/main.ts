import { App } from "./app/App.js";

const container = document.getElementById("app");
if (!container) {
  throw new Error("missing #app container in index.html");
}
const app = new App(container);

/* eslint-disable @typescript-eslint/no-explicit-any */
(window as any).__app = app;

(window as any).__game = {
  app,
  getState: () => {
    const fp = (app as any).systems?.firstPerson;
    const player = fp?.player;
    const scoreboard = (app as any).ui?.hud?.scoreboard?.value ?? [];
    const selfScore = scoreboard.find((e: any) => e.isSelf);
    return {
      feet: player?.movement?.feet ? { x: player.movement.feet.x, y: player.movement.feet.y, z: player.movement.feet.z } : null,
      yaw: player?.movement?.yaw ?? 0,
      pitch: player?.movement?.pitch ?? 0,
      health: player?.state?.health ?? 0,
      alive: player?.state?.alive ?? false,
      score: selfScore?.score ?? 0,
      deaths: selfScore?.deaths ?? 0,
      scoreboard,
      killFeed: (app as any).ui?.hud?.killFeed?.value ?? [],
      winner: (app as any).ui?.hud?.matchWinner?.value ?? null,
      prompt: (app as any).ui?.prompt?.value ?? null,
      screen: (app as any).screens?.current,
      inMatch: (app as any).match?.inMatch ?? false,
    };
  },
  getPeers: () => {
    const remotes = (app as any).systems?.remotes;
    const peers: any[] = [];
    if (remotes && (remotes as any).players) {
      for (const [id, remote] of (remotes as any).players) {
        peers.push({
          id,
          name: (app as any).ui?.lobby?.value?.players?.find((p: any) => p.id === id)?.username ?? id,
          feet: { x: remote.drawn.feet.x, y: remote.drawn.feet.y, z: remote.drawn.feet.z },
          weapon: remote.weapon?.id ?? null,
        });
      }
    }
    return peers;
  },
  lookAt: (target: { x: number; y: number; z: number }) => {
    const fp = (app as any).systems?.firstPerson;
    if (!fp?.player) {
      return;
    }
    const feet = fp.player.movement.feet;
    const eyeY = feet.y + 1.5;
    const dx = target.x - feet.x;
    const dy = (target.y + 1.2) - eyeY;
    const dz = target.z - feet.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    fp.player.look(yaw, pitch);
    (fp as any).pending.yaw = 0;
    (fp as any).pending.pitch = 0;
  },
  setFire: (firing: boolean) => {
    const input = (app as any).systems?.input;
    if (!input) {
      return;
    }
    input.setTestLocked(true);
    input.setTestHeld("fire", firing);
  },
  setMove: (forward: boolean) => {
    const input = (app as any).systems?.input;
    if (!input) {
      return;
    }
    input.setTestLocked(true);
    input.setTestHeld("forward", forward);
  },
  unlock: () => {
    const input = (app as any).systems?.input;
    if (input) {
      input.setTestLocked(true);
      (app as any).pause?.resume?.();
    }
  }
};
/* eslint-enable @typescript-eslint/no-explicit-any */

app.start();
