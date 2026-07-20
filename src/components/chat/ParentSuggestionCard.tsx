import type { NudgeyMood } from "../NudgeySheep";
import ChatCard from "./ChatCard";
import { PARENT_SUGGESTION_ACTIONS, type ParentSuggestionAction } from "./reactions";
import type { NudgeStatus } from "./useChat";

export default function ParentSuggestionCard({
  parentTask,
  status,
  mood,
  onRevive,
  onDecline,
}: {
  parentTask: string;
  status: NudgeStatus;
  mood: NudgeyMood;
  onRevive: () => void;
  onDecline: () => void;
}) {
  const disabled = status !== "idle";
  const handlers: Record<ParentSuggestionAction, () => void> = {
    revive: onRevive,
    decline: onDecline,
  };

  return (
    <ChatCard bubble={`元の「${parentTask}」もやってみる？`} mood={mood}>
      <div className="flex flex-wrap gap-2">
        {PARENT_SUGGESTION_ACTIONS.map((action) => (
          <button
            key={action.value}
            type="button"
            disabled={disabled}
            onClick={handlers[action.value]}
            className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--sea-ink)] transition hover:-translate-y-0.5 hover:border-[var(--lagoon-deep)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {action.label}
          </button>
        ))}
      </div>
    </ChatCard>
  );
}
