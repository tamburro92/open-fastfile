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
  { value: 30, label: "30 Kills", desc: "Default Call of Duty Deathmatch score limit." },
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

import { BOT_COUNTS, BOT_DIFFICULTIES, TEAM_BOT_COUNTS } from "./BotSetup.js";

export function GameRules(props: { onBack: () => void }) {
  const { state, commands } = useUi();
  const lobby = state.lobby.value;

  const [activeTab, setActiveTab] = useState<"menu" | "score" | "time" | "bots" | "diff" | "count" | "friendly" | "enemy">("menu");

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

  const botsEnabled = lobby?.bots !== false;
  const botDifficulty = lobby?.botDifficulty ?? "regular";
  const botCount = lobby?.botCount ?? (isTdm ? 6 : 5);
  const friendlyBots = lobby?.friendlyBots ?? 3;
  const enemyBots = lobby?.enemyBots ?? 3;

  const scoreLabel = (s: number) => (s === 0 ? "Unlimited" : `${s} Kills`);
  const timeLabel = (sec: number) =>
    TIME_LIMITS.find((t) => t.seconds === sec)?.label ?? (sec === 0 ? "Unlimited" : `${Math.round(sec / 60)} Minutes`);
  const diffLabel = BOT_DIFFICULTIES.find((d) => d.id === botDifficulty)?.label ?? "Regular";

  if (activeTab === "score") {
    const items: MenuItem[] = [
      ...SCORE_LIMITS.map((opt): MenuItem => ({
        key: `score-${opt.value}`,
        label: opt.label,
        description: opt.desc,
        current: opt.value === currentScore,
        onSelect: () => {
          commands.setLobbyRules({
            scoreLimit: opt.value,
            timeLimit: currentTime,
            ...(lobby?.bots !== undefined ? { bots: lobby.bots } : {}),
            ...(lobby?.botDifficulty !== undefined ? { botDifficulty: lobby.botDifficulty } : {}),
            ...(lobby?.botCount !== undefined ? { botCount: lobby.botCount } : {}),
            ...(lobby?.friendlyBots !== undefined ? { friendlyBots: lobby.friendlyBots } : {}),
            ...(lobby?.enemyBots !== undefined ? { enemyBots: lobby.enemyBots } : {}),
          });
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
          commands.setLobbyRules({
            scoreLimit: currentScore,
            timeLimit: opt.seconds,
            ...(lobby?.bots !== undefined ? { bots: lobby.bots } : {}),
            ...(lobby?.botDifficulty !== undefined ? { botDifficulty: lobby.botDifficulty } : {}),
            ...(lobby?.botCount !== undefined ? { botCount: lobby.botCount } : {}),
            ...(lobby?.friendlyBots !== undefined ? { friendlyBots: lobby.friendlyBots } : {}),
            ...(lobby?.enemyBots !== undefined ? { enemyBots: lobby.enemyBots } : {}),
          });
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

  if (activeTab === "bots") {
    const items: MenuItem[] = [
      {
        key: "bots-on",
        label: "Enabled",
        description: "AI bot opponents will participate in the match.",
        current: botsEnabled,
        onSelect: () => {
          commands.setLobbyRules({
            scoreLimit: currentScore,
            timeLimit: currentTime,
            bots: true,
            botDifficulty,
            botCount,
            friendlyBots,
            enemyBots,
          });
          setActiveTab("menu");
        },
      },
      {
        key: "bots-off",
        label: "Disabled",
        description: "No bots will spawn.",
        current: !botsEnabled,
        onSelect: () => {
          commands.setLobbyRules({
            scoreLimit: currentScore,
            timeLimit: currentTime,
            bots: false,
            botDifficulty,
            botCount,
            friendlyBots,
            enemyBots,
          });
          setActiveTab("menu");
        },
      },
      { label: "Back", description: "Return to Game Rules.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Bots" items={items} />
        <MenuPanel title="Bots">
          <div class={styles.body}>
            <p class={styles.desc}>Toggle whether bots participate in the match.</p>
            <p class={styles.label}>Current: {botsEnabled ? "Enabled" : "Disabled"}</p>
          </div>
        </MenuPanel>
      </MenuScreen>
    );
  }

  if (activeTab === "diff") {
    const items: MenuItem[] = [
      ...BOT_DIFFICULTIES.map((opt): MenuItem => ({
        key: `diff-${opt.id}`,
        label: opt.label,
        description: opt.desc,
        current: opt.id === botDifficulty,
        onSelect: () => {
          commands.setLobbyRules({
            scoreLimit: currentScore,
            timeLimit: currentTime,
            bots: botsEnabled,
            botDifficulty: opt.id,
            botCount,
            friendlyBots,
            enemyBots,
          });
          setActiveTab("menu");
        },
      })),
      { label: "Back", description: "Return to Game Rules.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Bot Difficulty" items={items} />
        <MenuPanel title="Bot Difficulty">
          <div class={styles.body}>
            <p class={styles.desc}>Choose bot combat difficulty level.</p>
            <p class={styles.label}>Current: {diffLabel}</p>
          </div>
        </MenuPanel>
      </MenuScreen>
    );
  }

  if (activeTab === "count") {
    const items: MenuItem[] = [
      ...BOT_COUNTS.map((opt): MenuItem => ({
        key: `count-${opt.value}`,
        label: opt.label,
        description: opt.desc,
        current: opt.value === botCount,
        onSelect: () => {
          commands.setLobbyRules({
            scoreLimit: currentScore,
            timeLimit: currentTime,
            bots: opt.value > 0,
            botDifficulty,
            botCount: opt.value,
            friendlyBots: Math.ceil(opt.value / 2),
            enemyBots: Math.floor(opt.value / 2),
          });
          setActiveTab("menu");
        },
      })),
      { label: "Back", description: "Return to Game Rules.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Bot Count" items={items} />
        <MenuPanel title="Bot Count">
          <div class={styles.body}>
            <p class={styles.desc}>The number of AI bot opponents.</p>
            <p class={styles.label}>Current: {botCount} Bots</p>
          </div>
        </MenuPanel>
      </MenuScreen>
    );
  }

  if (activeTab === "friendly") {
    const items: MenuItem[] = [
      ...TEAM_BOT_COUNTS.map((opt): MenuItem => ({
        key: `friendly-${opt.value}`,
        label: opt.label,
        description: opt.desc,
        current: opt.value === friendlyBots,
        onSelect: () => {
          commands.setLobbyRules({
            scoreLimit: currentScore,
            timeLimit: currentTime,
            bots: botsEnabled,
            botDifficulty,
            botCount: opt.value + enemyBots,
            friendlyBots: opt.value,
            enemyBots,
          });
          setActiveTab("menu");
        },
      })),
      { label: "Back", description: "Return to Game Rules.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Friendly Bots" items={items} />
        <MenuPanel title="Friendly Bots">
          <div class={styles.body}>
            <p class={styles.desc}>The number of AI bots assigned to your team ({state.teamNames.value.allies}).</p>
            <p class={styles.label}>Current: {friendlyBots} Bots</p>
          </div>
        </MenuPanel>
      </MenuScreen>
    );
  }

  if (activeTab === "enemy") {
    const items: MenuItem[] = [
      ...TEAM_BOT_COUNTS.map((opt): MenuItem => ({
        key: `enemy-${opt.value}`,
        label: opt.label,
        description: opt.desc,
        current: opt.value === enemyBots,
        onSelect: () => {
          commands.setLobbyRules({
            scoreLimit: currentScore,
            timeLimit: currentTime,
            bots: botsEnabled,
            botDifficulty,
            botCount: friendlyBots + opt.value,
            friendlyBots,
            enemyBots: opt.value,
          });
          setActiveTab("menu");
        },
      })),
      { label: "Back", description: "Return to Game Rules.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Enemy Bots" items={items} />
        <MenuPanel title="Enemy Bots">
          <div class={styles.body}>
            <p class={styles.desc}>The number of AI bots assigned to the enemy team ({state.teamNames.value.axis}).</p>
            <p class={styles.label}>Current: {enemyBots} Bots</p>
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
    {
      label: "Bots",
      description: `Current: ${botsEnabled ? "Enabled" : "Disabled"}. Toggle AI bot opponents.`,
      onSelect: () => setActiveTab("bots"),
    },
    {
      label: "Bot Difficulty",
      description: `Current: ${diffLabel}. Call of Duty AI difficulty tier.`,
      onSelect: () => setActiveTab("diff"),
    },
    ...(isTdm
      ? [
          {
            label: "Friendly Bots",
            description: `Current: ${friendlyBots} Bots. ${state.teamNames.value.allies} bots.`,
            onSelect: () => setActiveTab("friendly"),
          },
          {
            label: "Enemy Bots",
            description: `Current: ${enemyBots} Bots. ${state.teamNames.value.axis} bots.`,
            onSelect: () => setActiveTab("enemy"),
          },
        ]
      : [
          {
            label: "Bot Count",
            description: `Current: ${botCount} Bots. Number of bot opponents.`,
            onSelect: () => setActiveTab("count"),
          },
        ]),
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
          <h3 class={`${styles.label} ${styles.gap}`}>Bots</h3>
          <p class={styles.value}>
            {!botsEnabled
              ? "Disabled"
              : isTdm
                ? `${friendlyBots} Friendly / ${enemyBots} Enemy (${diffLabel})`
                : `${botCount} Bots (${diffLabel})`}
          </p>
        </div>
      </MenuPanel>
    </MenuScreen>
  );
}
