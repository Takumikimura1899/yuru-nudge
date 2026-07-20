import type { NudgeyMood } from "../NudgeySheep";
import { NudgeyAvatar } from "./ChatCard";

export default function ThinkingIndicator({ mood }: { mood: NudgeyMood }) {
  return (
    <li className="rise-in flex items-end gap-2">
      <NudgeyAvatar mood={mood} />
      <p
        role="status"
        className="max-w-[75%] rounded-3xl rounded-bl-md border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--sea-ink-soft)] italic"
      >
        ナッジーが考え中…
      </p>
    </li>
  );
}
