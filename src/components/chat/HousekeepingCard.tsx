import { motion } from "motion/react";
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
    <motion.li
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 26, mass: 0.7 }}
      className="flex items-end gap-2 justify-start"
    >
      <span aria-hidden className="mb-1 text-xl">
        🐑
      </span>
      <div className="flex max-w-[85%] flex-col gap-2">
        <p className="rounded-3xl rounded-bl-md border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5 text-sm leading-relaxed text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)]">
          これまだ気になってる？
        </p>
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
      </div>
    </motion.li>
  );
}
