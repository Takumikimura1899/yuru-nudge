import ChatCard from "./ChatCard";
import type { HousekeepingRow } from "./useChat";

export default function HousekeepingCard({
  items,
  onKeep,
  onDiscard,
}: {
  items: HousekeepingRow[];
  onKeep: (seedId: string) => void;
  onDiscard: (seedId: string) => void;
}) {
  return (
    <ChatCard bubble="これまだ気になってる？" maxWidthClassName="max-w-[85%]">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item) => {
          const disabled = item.status === "discarding";
          return (
            <li
              key={item.seedId}
              className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5"
            >
              <span className="text-sm text-[var(--sea-ink)]">{item.task}</span>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onKeep(item.seedId)}
                  className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold text-[var(--sea-ink)] transition hover:-translate-y-0.5 hover:border-[var(--lagoon-deep)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  気になってる
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onDiscard(item.seedId)}
                  className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1 text-xs font-semibold text-[var(--sea-ink-soft)] transition hover:-translate-y-0.5 hover:border-[var(--lagoon-deep)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  もういいや
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </ChatCard>
  );
}
