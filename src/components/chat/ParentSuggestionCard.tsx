import { motion } from "motion/react";
import { PARENT_SUGGESTION_ACTIONS, type ParentSuggestionAction } from "./reactions";
import type { NudgeStatus } from "./useChat";

export default function ParentSuggestionCard({
  parentTask,
  status,
  onRevive,
  onDecline,
}: {
  parentTask: string;
  status: NudgeStatus;
  onRevive: () => void;
  onDecline: () => void;
}) {
  const disabled = status !== "idle";
  const handlers: Record<ParentSuggestionAction, () => void> = {
    revive: onRevive,
    decline: onDecline,
  };

  return (
    <motion.li
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 26, mass: 0.7 }}
      className="flex items-end gap-2 justify-start"
    >
      <span aria-hidden className="mb-1 text-xl">
        🐑
      </span>
      <div className="flex max-w-[75%] flex-col gap-2">
        <p className="rounded-3xl rounded-bl-md border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5 text-sm leading-relaxed text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)]">
          元の「{parentTask}」もやってみる？
        </p>
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
      </div>
    </motion.li>
  );
}
