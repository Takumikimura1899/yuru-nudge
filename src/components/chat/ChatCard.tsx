import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * ナッジー発話系カード（NudgeCard / HousekeepingCard / ParentSuggestionCard）に共通する
 * ラッパー（登場アニメーション・羊アイコン・吹き出し）を切り出したもの。
 * 吹き出し本文は bubble、その下に置く操作 UI（ボタン群・行一覧等）は children で渡す。
 */
export default function ChatCard({
  bubble,
  maxWidthClassName = "max-w-[75%]",
  children,
}: {
  bubble: ReactNode;
  maxWidthClassName?: string;
  children?: ReactNode;
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
      <div className={`flex ${maxWidthClassName} flex-col gap-2`}>
        <p className="rounded-3xl rounded-bl-md border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5 text-sm leading-relaxed text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)]">
          {bubble}
        </p>
        {children}
      </div>
    </motion.li>
  );
}
