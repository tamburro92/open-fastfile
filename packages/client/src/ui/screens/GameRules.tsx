import { useState } from "preact/hooks";
import {
  DEFAULT_FFA_SCORE_LIMIT,
  DEFAULT_FFA_TIME_LIMIT_SECONDS,
  DEFAULT_TDM_SCORE_LIMIT,
  DEFAULT_TDM_TIME_LIMIT_SECONDS,
} from "../../app/uiBridge.js";
import { useUi } from "../context.js";
import { MenuColumn, MenuPanel, MenuScreen, menuStyles, useEscape, type MenuItem } from "../menu/Menu.js";
import { MenuArt } from "./MenuArt.js";
import styles from "./GameSetup.module.css";

const SCORE_LIMITS = [
  { value: 0, label: "Unlimited", desc: "No kill limit. Match is decided by the time limit." },
  { value: 5, label: "5 Kills", desc: "Fast-paced match ending at 5 kills." },
  { value: 10, label: "10 Kills", desc: "Short match ending at 10 kills." },
  { value: 15, label: "15 Kills", desc: "Match ends when score reaches 15 kills." },
  { value: 20, label: "20 Kills", desc: "Match ends when score reaches 20 kills." },
  { value: 25, label: "25 Kills", desc: "Match ends when score reaches 25 kills." },
  { value: 30, label: "30 Kills", desc: "Default Call of Duty Free-for-All score limit." },
  { value: 40, label: "40 Kills", desc: "Extended match ending at 40 kills." },
  { value: 50, label: "50 Kills", desc: "Endurance deathmatch ending at 50 kills." },
  { value: 75, label: "75 Kills", desc: "Default Call of Duty Team Deathmatch score limit." },
  { value: 100, label: "100 Kills", desc: "High kill target match ending at 100 kills." },
  { value: 150, label: "150 Kills", desc: "Extended team match ending at 150 kills." },
  { value: 200, label: "200 Kills", desc: "Marathon team match ending at 200 kills." },
];

const TIME_LIMITS = [
  { seconds: 0, label: "Unlimited", desc: "No time limit. Match continues until score limit is reached." },
  { seconds: 150, label: "2.5 Minutes", desc: "Blitz round of 2.5 minutes." },
  { seconds: 300, label: "5 Minutes", desc: "Quick match of 5 minutes." },
  { seconds: 480, label: "8 Minutes", desc: "Match duration of 8 minutes." },
  { seconds: 600, label: "10 Minutes", desc: "Default Call of Duty match time limit." },
  { seconds: 900, label: "15 Minutes", desc: "Longer match duration of 15 minutes." },
  { seconds: 1200, label: "20 Minutes", desc: "Extended match duration of 20 minutes." },
  { seconds: 1800, label: "30 Minutes", desc: "Marathon match duration of 30 minutes." },
];

export function GameRules(props: { onBack: () => void }) {
  const { state, commands } = useUi();
  const lobby = state.lobby.value;

  const [activeTab, setActiveTab] = useState<"menu" | "score" | "time">("menu");

  // Esc goes back to sub-menu first, then exits to Game Setup:
  useEscape(() => {
    if (activeTab !== "menu") {
      setActiveTab("menu");
    } else {
      props.onBack();
    }
  });

  const isTdm = lobby?.gametype === "tdm";
  const defaultScore = isTdm ? DEFAULT_TDM_SCORE_LIMIT : DEFAULT_FFA_SCORE_LIMIT;
  const defaultTime = isTdm ? DEFAULT_TDM_TIME_LIMIT_SECONDS : DEFAULT_FFA_TIME_LIMIT_SECONDS;

  const currentScore = lobby?.scoreLimit ?? defaultScore;
  const currentTime = lobby?.timeLimit ?? defaultTime;

  const scoreLabel = (s: number) => (s === 0 ? "Unlimited" : `${s} Kills`);
  const timeLabel = (sec: number) =>
    TIME_LIMITS.find((t) => t.seconds === sec)?.label ?? (sec === 0 ? "Unlimited" : `${Math.round(sec / 60)} Minutes`);

  if (activeTab === "score") {
    const items: MenuItem[] = [
      ...SCORE_LIMITS.map((opt): MenuItem => ({
        key: `score-${opt.value}`,
        label: opt.label,
        description: opt.desc,
        current: opt.value === currentScore,
        onSelect: () => {
          commands.setLobbyRules({ scoreLimit: opt.value, timeLimit: currentTime });
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
            <p class={styles.label}>Current: {scoreLabel(currentScore)}</p>
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
        description: opt.desc,
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
            <p class={styles.label}>Current: {timeLabel(currentTime)}</p>
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
      description: `Current: ${scoreLabel(currentScore)}. Set the kills needed to win.`,
      onSelect: () => setActiveTab("score"),
    },
    {
      label: "Time Limit",
      description: `Current: ${timeLabel(currentTime)}. Set match duration.`,
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
          <p class={styles.value}>{scoreLabel(currentScore)}</p>
          <h3 class={`${styles.label} ${styles.gap}`}>Time Limit</h3>
          <p class={styles.value}>{timeLabel(currentTime)}</p>
        </div>
      </MenuPanel>
    </MenuScreen>
  );
}
