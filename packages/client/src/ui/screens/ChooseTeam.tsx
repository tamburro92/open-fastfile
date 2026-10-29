import { useUi } from "../context.js";
import { MenuColumn, MenuPanel, MenuScreen, useEscape, type MenuItem } from "../menu/Menu.js";
import styles from "./PauseMenu.module.css";

/**
 * Team selection screen for team gametypes (e.g. Team Deathmatch).
 * Displayed on joining before class selection, and available from the pause menu (Call of Duty standard).
 */
export function ChooseTeam() {
  const { state, commands } = useUi();
  const choice = state.teamChoice.value;
  const currentTeam = state.currentTeam.value;
  const names = state.teamNames.value;

  useEscape(choice === "change" ? () => commands.closeTeamChoice() : undefined);

  const items: MenuItem[] = [
    {
      key: "team-auto",
      label: "Auto-Assign",
      description: "Automatically join the team with fewer players.",
      onSelect: () => commands.chooseTeam("auto"),
    },
    {
      key: "team-allies",
      label: `${names.allies}${currentTeam === "allies" ? " (Current)" : ""}`,
      description: `Fight for ${names.allies}.`,
      current: currentTeam === "allies",
      onSelect: () => commands.chooseTeam("allies"),
    },
    {
      key: "team-axis",
      label: `${names.axis}${currentTeam === "axis" ? " (Current)" : ""}`,
      description: `Fight for ${names.axis}.`,
      current: currentTeam === "axis",
      onSelect: () => commands.chooseTeam("axis"),
    },
    choice === "spawn"
      ? { label: "Leave Game", description: "Back to the main menu.", divider: true, onSelect: () => commands.returnToMenu() }
      : { label: "Back", description: "Return to the pause menu.", divider: true, onSelect: () => commands.closeTeamChoice() },
  ];

  return (
    <MenuScreen class={styles.screen} role="dialog" aria-label="Choose Team">
      <MenuColumn title="Choose Team" items={items} />
      <MenuPanel title={state.worldName.value ?? "Choose Team"}>
        {choice === "change" ? (
          <p class={styles.note}>Changing teams will eliminate you and allow you to select a loadout on your new team.</p>
        ) : (
          <p class={styles.note}>Select a team to deploy with your squad.</p>
        )}
      </MenuPanel>
    </MenuScreen>
  );
}
