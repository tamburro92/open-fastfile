import { DEFAULT_CLASSES, LOADOUT_COUNT } from "../../app/uiBridge.js";
import { useUi } from "../context.js";
import { MenuColumn, MenuPanel, MenuScreen, useEscape, type MenuItem } from "../menu/Menu.js";
import { classSummary } from "./classes.js";
import styles from "./PauseMenu.module.css";

/**
 * Which class to play, chosen in the match: on joining, before the player is in
 * the world at all, and from the pause menu after.
 *
 * Supports both Custom Classes (0..4) and authentic MW3 Default Classes (5..9).
 * The choice is sent by number and the game server looks the class up in its own
 * copy of this player's classes, so there is nothing here to trust. A change made
 * while alive is held by the server until the next spawn — this screen only says
 * so, it does not decide it.
 */
export function ChooseClass() {
  const { state, commands } = useUi();
  const choice = state.classChoice.value;
  const playing = state.playingClass.value;
  const pending = state.pendingClass.value;
  const weapons = state.weapons.value;
  // On joining there is nothing to go back to: Esc does nothing, and Leave Game is the way out.
  useEscape(choice === "change" ? () => commands.closeClassChoice() : undefined);

  const customItems: MenuItem[] = state.loadouts.value.map((loadout, index): MenuItem => ({
    key: `class-${index}`,
    label: loadout.name + (index === pending ? " (next)" : index === playing ? " (current)" : ""),
    description: classSummary(loadout, weapons),
    divider: index === 0 ? "Custom Classes" : undefined,
    onSelect: () => commands.chooseClass(index),
  }));

  const defaultItems: MenuItem[] = DEFAULT_CLASSES.map((loadout, i): MenuItem => {
    const index = LOADOUT_COUNT + i;
    return {
      key: `default-class-${i}`,
      label: loadout.name + (index === pending ? " (next)" : index === playing ? " (current)" : ""),
      description: classSummary(loadout, weapons),
      divider: i === 0 ? "Default Classes" : undefined,
      onSelect: () => commands.chooseClass(index),
    };
  });

  const exitItem: MenuItem =
    choice === "spawn"
      ? { key: "leave-game", label: "Leave Game", description: "Back to the main menu.", divider: true, onSelect: () => commands.returnToMenu() }
      : { key: "back", label: "Back", description: "Back to the pause menu.", divider: true, onSelect: () => commands.closeClassChoice() };

  const items: MenuItem[] = [...customItems, ...defaultItems, exitItem];
  return (
    <MenuScreen class={styles.screen} role="dialog" aria-label="Choose Class">
      <MenuColumn title="Choose Class" items={items} />
      <MenuPanel title={state.worldName.value ?? "Choose Class"}>
        {choice === "change" && <p class={styles.note}>A new class takes effect when you next spawn.</p>}
      </MenuPanel>
    </MenuScreen>
  );
}
