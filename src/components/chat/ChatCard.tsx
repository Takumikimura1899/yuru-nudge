import { motion } from "motion/react";
import type { ReactNode } from "react";
import NudgeyFace from "../NudgeyFace";
import type { NudgeyMood } from "../NudgeySheep";

/** ナッジー側吹き出しの見た目（ChatMessage のナッジー役バブルと ChatCard で共有する単一ソース） */
export const NUDGEY_BUBBLE_CLASS =
  "rounded-3xl rounded-bl-md border border-[var(--line)] bg-[var(--surface-strong)] px-4 py-2.5 text-sm leading-relaxed text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)]";

/**
 * ナッジーのミニ顔アバター（吹き出しの左に添える。左下常設の羊と同一の見た目にする）。
 * 吹き出し本文が同じ発話をテキストで伝えるため、装飾画像として支援技術から隠す。
 */
export function NudgeyAvatar({ mood }: { mood: NudgeyMood }) {
  return <NudgeyFace mood={mood} decorative className="mb-1 h-7 w-7 shrink-0" />;
}

/**
 * ナッジー発話系カード（NudgeCard / HousekeepingCard / ParentSuggestionCard）に共通する
 * ラッパー（登場アニメーション・羊アイコン・吹き出し）を切り出したもの。
 * 吹き出し本文は bubble、その下に置く操作 UI（ボタン群・行一覧等）は children で渡す。
 */
export default function ChatCard({
  bubble,
  mood,
  maxWidthClassName = "max-w-[75%]",
  children,
}: {
  bubble: ReactNode;
  mood: NudgeyMood;
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
      <NudgeyAvatar mood={mood} />
      <div className={`flex ${maxWidthClassName} flex-col gap-2`}>
        <p className={NUDGEY_BUBBLE_CLASS}>{bubble}</p>
        {children}
      </div>
    </motion.li>
  );
}
