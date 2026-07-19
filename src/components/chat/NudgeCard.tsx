import type { ReactionKind } from "../../server/nudges";
import type { NudgeyMood } from "../NudgeySheep";
import ChatCard from "./ChatCard";
import { REACTIONS } from "./reactions";
import type { NudgeStatus } from "./useChat";

export default function NudgeCard({
  prophecy,
  status,
  mood,
  onReact,
}: {
  prophecy: string;
  status: NudgeStatus;
  mood: NudgeyMood;
  onReact: (reaction: ReactionKind) => void;
}) {
  const disabled = status !== "idle";

  return (
    <ChatCard bubble={prophecy} mood={mood}>
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
    </ChatCard>
  );
}
