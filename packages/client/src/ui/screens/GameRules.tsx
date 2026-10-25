import { useState } from "preact/hooks";
import { DEFAULT_FFA_SCORE_LIMIT, DEFAULT_FFA_TIME_LIMIT_SECONDS } from "../../app/uiBridge.js";
import { useUi } from "../context.js";
import { MenuColumn, MenuPanel, MenuScreen, menuStyles, useEscape, type MenuItem } from "../menu/Menu.js";
import { MenuArt } from "./MenuArt.js";
import styles from "./GameSetup.module.css";

const SCORE_LIMITS = [5, 10, 15, 20, 25, 30, 40, 50];
const TIME_LIMITS = [
  { seconds: 150, label: "2.5 Minutes" },
  { seconds: 300, label: "5 Minutes" },
  { seconds: 480, label: "8 Minutes" },
  { seconds: 600, label: "10 Minutes" },
  { seconds: 900, label: "15 Minutes" },
  { seconds: 1200, label: "20 Minutes" },
];

export function GameRules(props: { onBack: () => void }) {
  const { state, commands } = useUi();
  const lobby = state.lobby.value;
  useEscape(props.onBack);

  const currentScore = lobby?.scoreLimit ?? DEFAULT_FFA_SCORE_LIMIT;
  const currentTime = lobby?.timeLimit ?? DEFAULT_FFA_TIME_LIMIT_SECONDS;

  const [activeTab, setActiveTab] = useState<"menu" | "score" | "time">("menu");

  if (activeTab === "score") {
    const items: MenuItem[] = [
      ...SCORE_LIMITS.map((score): MenuItem => ({
        key: `score-${score}`,
        label: `${score} Kills`,
        description: score === DEFAULT_FFA_SCORE_LIMIT ? "Default Call of Duty FFA score limit." : `Match ends when a player reaches ${score} kills.`,
        current: score === currentScore,
        onSelect: () => {
          commands.setLobbyRules({ scoreLimit: score, timeLimit: currentTime });
          setActiveTab("menu");
        },
      })),
      { label: "Back", description: "Return to Game Rules.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Score Limit" items={items} />
        <MenuPanel title="Score Limit">
          <div class={styles.body}>
            <p class={styles.desc}>The number of kills required to win the match.</p>
            <p class={styles.label}>Current: {currentScore} Kills</p>
            <p class={styles.hint}>
              Select<span class={menuStyles.key}>Enter</span>
            </p>
          </div>
        </MenuPanel>
      </MenuScreen>
    );
  }

  if (activeTab === "time") {
    const items: MenuItem[] = [
      ...TIME_LIMITS.map((opt): MenuItem => ({
        key: `time-${opt.seconds}`,
        label: opt.label,
        description: opt.seconds === DEFAULT_FFA_TIME_LIMIT_SECONDS ? "Default Call of Duty FFA time limit." : `Match ends after ${opt.label}.`,
        current: opt.seconds === currentTime,
        onSelect: () => {
          commands.setLobbyRules({ scoreLimit: currentScore, timeLimit: opt.seconds });
          setActiveTab("menu");
        },
      })),
      { label: "Back", description: "Return to Game Rules.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Time Limit" items={items} />
        <MenuPanel title="Time Limit">
          <div class={styles.body}>
            <p class={styles.desc}>The match duration before time expires.</p>
            <p class={styles.label}>
              Current: {TIME_LIMITS.find((t) => t.seconds === currentTime)?.label ?? `${Math.round(currentTime / 60)} Minutes`}
            </p>
            <p class={styles.hint}>
              Select<span class={menuStyles.key}>Enter</span>
            </p>
          </div>
        </MenuPanel>
      </MenuScreen>
    );
  }

  const items: MenuItem[] = [
    {
      label: "Score Limit",
      description: `Current: ${currentScore} kills. Set the kills needed to win.`,
      onSelect: () => setActiveTab("score"),
    },
    {
      label: "Time Limit",
      description: `Current: ${TIME_LIMITS.find((t) => t.seconds === currentTime)?.label ?? `${Math.round(currentTime / 60)} Minutes`}. Set match duration.`,
      onSelect: () => setActiveTab("time"),
    },
    { label: "Back", description: "Return to Game Setup.", divider: true, onSelect: props.onBack },
  ];

  return (
    <MenuScreen>
      <MenuArt />
      <MenuColumn title="Game Rules" items={items} />
      <MenuPanel title="Game Rules">
        <div class={styles.body}>
          <h3 class={styles.label}>Score Limit</h3>
          <p class={styles.value}>{currentScore} Kills</p>
          <h3 class={`${styles.label} ${styles.gap}`}>Time Limit</h3>
          <p class={styles.value}>
            {TIME_LIMITS.find((t) => t.seconds === currentTime)?.label ?? `${Math.round(currentTime / 60)} Minutes`}
          </p>
        </div>
      </MenuPanel>
    </MenuScreen>
  );
}
