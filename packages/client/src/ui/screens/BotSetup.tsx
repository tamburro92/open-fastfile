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

export const BOT_DIFFICULTIES = [
  { id: "recruit", label: "Recruit", desc: "Bots have slow reaction times, poor accuracy, and simple movement." },
  { id: "regular", label: "Regular", desc: "Bots have balanced reaction times, standard accuracy, and use ADS." },
  { id: "hardened", label: "Hardened", desc: "Bots react quickly, aim accurately, and use tactical cover." },
  { id: "veteran", label: "Veteran", desc: "Bots have lightning-fast reflexes, pinpoint accuracy, and aggressive tactics." },
] as const;

export const BOT_COUNTS = [
  { value: 0, label: "0 Bots", desc: "No bots will be spawned." },
  { value: 1, label: "1 Bot", desc: "1 bot opponent." },
  { value: 2, label: "2 Bots", desc: "2 bot opponents." },
  { value: 3, label: "3 Bots", desc: "3 bot opponents." },
  { value: 4, label: "4 Bots", desc: "4 bot opponents." },
  { value: 5, label: "5 Bots", desc: "5 bot opponents." },
  { value: 6, label: "6 Bots", desc: "Standard 6 bot match." },
  { value: 8, label: "8 Bots", desc: "8 bot opponents." },
  { value: 10, label: "10 Bots", desc: "10 bot opponents." },
  { value: 12, label: "12 Bots", desc: "12 bot match." },
  { value: 14, label: "14 Bots", desc: "14 bot match." },
  { value: 16, label: "16 Bots", desc: "Maximum 16 bot match." },
];

export const TEAM_BOT_COUNTS = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  value: n,
  label: `${n} Bot${n === 1 ? "" : "s"}`,
  desc: `${n} bot${n === 1 ? "" : "s"} assigned to this team.`,
}));

export function BotSetup(props: { onBack: () => void }) {
  const { state, commands } = useUi();
  const lobby = state.lobby.value;

  const [activeTab, setActiveTab] = useState<"menu" | "toggle" | "difficulty" | "count" | "friendly" | "enemy">("menu");

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

  const diffLabel = BOT_DIFFICULTIES.find((d) => d.id === botDifficulty)?.label ?? "Regular";

  if (activeTab === "toggle") {
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
        description: "No bots will spawn. Only human players will join.",
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
      { label: "Back", description: "Return to Bot Setup.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Bots" items={items} />
        <MenuPanel title="Bots">
          <div class={styles.body}>
            <p class={styles.desc}>Toggle whether AI bot opponents participate in the match.</p>
            <p class={styles.label}>Current: {botsEnabled ? "Enabled" : "Disabled"}</p>
            <p class={styles.hint}>
              Select<span class={menuStyles.key}>Enter</span>
            </p>
          </div>
        </MenuPanel>
      </MenuScreen>
    );
  }

  if (activeTab === "difficulty") {
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
      { label: "Back", description: "Return to Bot Setup.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Bot Difficulty" items={items} />
        <MenuPanel title="Bot Difficulty">
          <div class={styles.body}>
            <p class={styles.desc}>Choose the combat difficulty level for AI bots.</p>
            <p class={styles.label}>Current: {diffLabel}</p>
            <p class={styles.hint}>
              Select<span class={menuStyles.key}>Enter</span>
            </p>
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
      { label: "Back", description: "Return to Bot Setup.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Bot Count" items={items} />
        <MenuPanel title="Bot Count">
          <div class={styles.body}>
            <p class={styles.desc}>The total number of AI bots in the match.</p>
            <p class={styles.label}>Current: {botCount} Bots</p>
            <p class={styles.hint}>
              Select<span class={menuStyles.key}>Enter</span>
            </p>
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
      { label: "Back", description: "Return to Bot Setup.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Friendly Bots" items={items} />
        <MenuPanel title="Friendly Bots">
          <div class={styles.body}>
            <p class={styles.desc}>The number of AI bots assigned to your team (Allies).</p>
            <p class={styles.label}>Current: {friendlyBots} Bots</p>
            <p class={styles.hint}>
              Select<span class={menuStyles.key}>Enter</span>
            </p>
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
      { label: "Back", description: "Return to Bot Setup.", divider: true, onSelect: () => setActiveTab("menu") },
    ];

    return (
      <MenuScreen>
        <MenuArt />
        <MenuColumn title="Enemy Bots" items={items} />
        <MenuPanel title="Enemy Bots">
          <div class={styles.body}>
            <p class={styles.desc}>The number of AI bots assigned to the enemy team (Axis).</p>
            <p class={styles.label}>Current: {enemyBots} Bots</p>
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
      label: "Bots",
      description: `Current: ${botsEnabled ? "Enabled" : "Disabled"}. Toggle AI bot players in the match.`,
      onSelect: () => setActiveTab("toggle"),
    },
    {
      label: "Bot Difficulty",
      description: `Current: ${diffLabel}. Set AI combat intelligence and difficulty.`,
      onSelect: () => setActiveTab("difficulty"),
    },
    ...(isTdm
      ? [
          {
            label: "Friendly Bots",
            description: `Current: ${friendlyBots} Bots. Allies team bots.`,
            onSelect: () => setActiveTab("friendly"),
          },
          {
            label: "Enemy Bots",
            description: `Current: ${enemyBots} Bots. Axis team bots.`,
            onSelect: () => setActiveTab("enemy"),
          },
        ]
      : [
          {
            label: "Number of Bots",
            description: `Current: ${botCount} Bots. Total bot opponents in Free-for-All.`,
            onSelect: () => setActiveTab("count"),
          },
        ]),
    { label: "Back", description: "Return to Game Setup.", divider: true, onSelect: props.onBack },
  ];

  const summaryLabel = !botsEnabled
    ? "Disabled"
    : isTdm
      ? `${friendlyBots} Friendly / ${enemyBots} Enemy (${diffLabel})`
      : `${botCount} Bots (${diffLabel})`;

  return (
    <MenuScreen>
      <MenuArt />
      <MenuColumn title="Bot Setup" items={items} />
      <MenuPanel title="Bot Setup">
        <div class={styles.body}>
          <h3 class={styles.label}>Bots</h3>
          <p class={styles.value}>{botsEnabled ? "Enabled" : "Disabled"}</p>
          <h3 class={`${styles.label} ${styles.gap}`}>Difficulty</h3>
          <p class={styles.value}>{diffLabel}</p>
          <h3 class={`${styles.label} ${styles.gap}`}>{isTdm ? "Team Bots" : "Bot Count"}</h3>
          <p class={styles.value}>
            {isTdm ? `${friendlyBots} Friendly / ${enemyBots} Enemy` : `${botCount} Bots`}
          </p>
          <h3 class={`${styles.label} ${styles.gap}`}>Summary</h3>
          <p class={styles.value}>{summaryLabel}</p>
        </div>
      </MenuPanel>
    </MenuScreen>
  );
}
