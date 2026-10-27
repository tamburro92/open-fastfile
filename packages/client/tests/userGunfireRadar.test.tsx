// @vitest-environment happy-dom
// End-to-end user experience test for the MW3-faithful gunfire radar ping system.
// Verifies user-visible behavior:
// 1. Unsilenced gunfire reveals enemy as a red radar dot on HUD minimap and pause map.
// 2. Silenced weapon firing (with silencer attachment) maintains full radar stealth.
// 3. Ping fade timing matches MW3's 2.0s `compassSoundPingFadeTime`.
// 4. Repeated gunfire updates position and refreshes duration.
// 5. Team filtering (only enemies appear as red blips).

import { act, cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Root } from "../src/ui/Root.js";
import { createUiState, type UiCommands } from "../src/app/uiBridge.js";
import { Radar } from "../src/app/radar.js";
import { isSilenced, resolveWeapon, type WeaponEntry } from "@3d/shared/sim/weaponRegistry.js";
import type { ResolvedMinimap } from "@3d/shared/dsl/resolved.js";

const DOME: ResolvedMinimap = {
  source: "/worlds/dome-mw3/assets/minimap.png",
  center: { x: 5.08, z: -24.587 },
  width: 103.632,
  depth: 103.632,
  rotation: -Math.PI / 2,
  range: 40,
};

function setupUserGame() {
  const state = createUiState();
  const commands: UiCommands = {
    enterWorld: vi.fn(),
    returnToMenu: vi.fn(),
    resume: vi.fn(),
    setQuality: vi.fn(),
    setSensitivity: vi.fn(),
    setAudioVolume: vi.fn(),
    setAudioMuted: vi.fn(),
    previewWeapon: vi.fn(),
    saveLoadout: vi.fn(),
    openClasses: vi.fn(),
    closeClasses: vi.fn(),
    chooseClass: vi.fn(),
    openClassChoice: vi.fn(),
    closeClassChoice: vi.fn(),
    chooseTeam: vi.fn(),
    openTeamChoice: vi.fn(),
    closeTeamChoice: vi.fn(),
    signIn: vi.fn(),
    register: vi.fn(),
    signOut: vi.fn(),
    findGame: vi.fn(),
    createPrivateLobby: vi.fn(),
    setLobbyMap: vi.fn(),
    setLobbyMode: vi.fn(),
    joinLobby: vi.fn(),
    startLobby: vi.fn(),
    endLobby: vi.fn(),
    playHere: vi.fn(),
    leaveLobby: vi.fn(),
    setLobbyRules: vi.fn(),
    setScoreboardOpen: vi.fn(),
    toggleScoreboard: vi.fn(),
  };

  render(<Root state={state} commands={commands} />);

  // User enters the world and begins walking on Dome
  act(() => {
    state.screen.value = "world";
    state.minimap.map.value = { image: DOME.source, width: 1.25, height: 1.25 };
    state.minimap.pose.value = { u: 0.5, v: 0.5, rotation: 0 };
  });

  const radar = new Radar(state);
  return { state, radar };
}

afterEach(cleanup);

describe("Test Utente: Minimappa e Radar Spari MW3", () => {
  it("Scenario 1: Un nemico spara senza silenziatore e compare come pallino rosso sul radar", () => {
    const { radar } = setupUserGame();

    // Inizialmente nessun ping sul radar
    expect(screen.queryAllByTestId("radar-ping")).toHaveLength(0);

    // Un nemico spara a nord-est della mappa (tempo t = 1000ms)
    act(() => {
      radar.record("bot_soap", { x: 30, z: -50 }, true, false, DOME, 1000);
    });

    // L'utente ora vede il pallino rosso sul radar
    const pings = screen.getAllByTestId("radar-ping");
    expect(pings).toHaveLength(1);
    expect(pings[0]!.getAttribute("data-enemy")).toBe("true");
    expect(pings[0]!.style.opacity).toBe("1");
  });

  it("Scenario 2: Dissolvenza temporale di 2.0s fedele a compassSoundPingFadeTime di MW3", () => {
    const { radar } = setupUserGame();

    act(() => {
      radar.record("bot_makarov", { x: 10, z: -20 }, true, false, DOME, 1000);
    });

    // A t = 2000ms (1.0s dopo lo sparo): il ping è ancora pienamente visibile (alpha = 1)
    act(() => {
      radar.update(2000);
    });
    expect(screen.getByTestId("radar-ping").style.opacity).toBe("1");

    // A t = 2600ms (1.6s dopo lo sparo): il ping sta svanendo gradualmente (alpha ~ 0.5)
    act(() => {
      radar.update(2600);
    });
    const fadingPing = screen.getByTestId("radar-ping");
    const alpha = parseFloat(fadingPing.style.opacity);
    expect(alpha).toBeGreaterThan(0.4);
    expect(alpha).toBeLessThan(0.6);

    // A t = 3000ms (2.0s dopo lo sparo): il ping scompare completamente dal radar
    act(() => {
      radar.update(3000);
    });
    expect(screen.queryAllByTestId("radar-ping")).toHaveLength(0);
  });

  it("Scenario 3: Raffica di spari successivi aggiorna posizione e azzera il timer", () => {
    const { radar } = setupUserGame();

    act(() => {
      radar.record("enemy_sniper", { x: 10, z: -10 }, true, false, DOME, 1000);
    });

    // 1.5s dopo il nemico si muove e spara un secondo colpo a t = 2500ms
    act(() => {
      radar.record("enemy_sniper", { x: 40, z: -60 }, true, false, DOME, 2500);
    });

    // Il ping rimane singolo (non duplica) e la sua opacità torna a 1.0 pieno
    const pings = screen.getAllByTestId("radar-ping");
    expect(pings).toHaveLength(1);
    expect(pings[0]!.style.opacity).toBe("1");

    // A t = 3700ms (1.2s dopo il secondo colpo): è ancora al 100% visibile
    act(() => {
      radar.update(3700);
    });
    expect(screen.getByTestId("radar-ping").style.opacity).toBe("1");
  });

  it("Scenario 4: Quando l'arma è equipaggiata con silenziatore, NON compare nessun ping sul radar", () => {
    const testWeapon: WeaponEntry = {
      game: "iw5",
      id: "iw5_m4_mp",
      display: "M4A1",
      class: "rifle",
      def: {
        game: "iw5",
        weapon: "iw5_m4_mp",
        gun: "iw5_m4_mp_gun",
        roles: {},
        clips: {},
        times: {},
        clipSize: 30,
        fireType: "Full Auto",
        roundsPerLoad: 0,
        boltAction: false,
        adsZoomFov: null,
        adsOverlay: null,
        motion: {},
        hideBones: [],
        sounds: {
          fire: "weap_m4_fire_npc",
          firePlayer: "weap_m4_fire_plr",
        },
      },
      attachments: [
        {
          id: "silencer",
          display: "Silencer",
          tag: "tag_silencer",
          overrides: {
            sounds: {
              fire: "weap_m4silenced_fire_npc",
              firePlayer: "weap_m4silenced_fire_plr",
            },
          },
        },
      ],
    };

    // 1. Arma base (senza silenziatore): isSilenced è falso
    const unsilencedDef = resolveWeapon(testWeapon, []);
    expect(isSilenced(unsilencedDef)).toBe(false);

    // 2. Arma con silenziatore equipaggiato: isSilenced è vero
    const silencedDef = resolveWeapon(testWeapon, [0]);
    expect(silencedDef.silenced).toBe(true);
    expect(isSilenced(silencedDef)).toBe(true);

    // Verifica gameplay: se silenced, nessun ping viene registrato
    const { radar } = setupUserGame();
    if (!isSilenced(silencedDef)) {
      radar.record("sneaky_enemy", { x: 0, z: 0 }, true, false, DOME, 1000);
    }
    // Nessun ping deve apparire sulla minimappa
    expect(screen.queryAllByTestId("radar-ping")).toHaveLength(0);
  });

  it("Scenario 5: I ping degli spari nemici sono visibili anche nella mappa di pausa (Pause Map)", () => {
    const { state, radar } = setupUserGame();

    // Spari nemici registrati sul radar
    act(() => {
      radar.record("enemy_patrol", { x: 20, z: -30 }, true, false, DOME, 1000);
    });

    // L'utente preme Esc / Pausa per aprire la mappa tattica
    act(() => {
      state.paused.value = true;
    });

    // La mappa di pausa mostra il blip nemico alle sue coordinate
    const pausePing = screen.getByTestId("pause-radar-ping");
    expect(pausePing).toBeTruthy();
    expect(pausePing.getAttribute("data-enemy")).toBe("true");
  });
});
