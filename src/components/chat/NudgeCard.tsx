import type { ReactionKind } from "../../server/nudges";
import { REACTIONS } from "./reactions";
import type { NudgeStatus } from "./useChat";

export default function NudgeCard({
  prophecy,
  status,
  onReact,
}: {
  prophecy: string;
  status: NudgeStatus;
  onReact: (reaction: ReactionKind) => void;
}) {
  const disabled = status !== "idle";

  return (
    <li className="rise-in flex items-end gap-2 justify-start">
      <span aria-hidden className="mb-1 text-xl">
        🐑
      </span>
      <div className="flex max-w-[75%] flex-col gap-2">
        <p className="rounded-3xl rounded-bl-md border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5 text-sm leading-relaxed text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)]">
          {prophecy}
        </p>
        <div className="flex flex-wrap gap-2">
          {REACTIONS.map((reaction) => (
            <button
              key={reaction.value}
              type="button"
              disabled={disabled}
              onClick={() => onReact(reaction.value)}
              className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--sea-ink)] transition hover:-translate-y-0.5 hover:border-[var(--lagoon-deep)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {reaction.label}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}
