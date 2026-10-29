import { useUi } from "../context.js";
import styles from "./NameTags.module.css";

/** Teammates' names over their heads, placed by the app each frame (app/presenters.ts). */
export function NameTags() {
  const tags = useUi().state.hud.nameTags.value;
  if (tags.length === 0) {
    return null;
  }
  return (
    <div class={styles.layer} aria-hidden="true">
      {tags.map((t) => (
        <span key={t.id} class={styles.name} style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }} data-testid="name-tag">
          {t.name}
        </span>
      ))}
    </div>
  );
}
