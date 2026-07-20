import { AnimatePresence, motion, type Variants } from "motion/react";
import { SheepEars, SheepFace, SheepGlasses, SheepWool, type NudgeyMood } from "./nudgey/parts";

export type { NudgeyMood };

// happy のときだけ小さく2回跳ねる。chill/sharp は静止（y:0）のまま。
const sheepVariants: Variants = {
  chill: { y: 0 },
  sharp: { y: 0 },
  happy: {
    y: [0, -6, 0, -6, 0],
    transition: { duration: 0.6, ease: "easeOut", times: [0, 0.25, 0.5, 0.75, 1] },
  },
};

/**
 * 画面下部に固定表示するナッジー（羊）のマスコット。設計書 §8.6 の3状態を
 * 1つの SVG 内の条件付き <g> で切り替える（通常/Sharpはメガネ、Happyは表情変化のみで
 * ボディ・牧草地は常に同じ）。牧草地を除く本体一式（脚・耳・ボディ・顔・メガネ）を
 * 1つの motion.g にまとめ、happy 時はその一式ごと小さく跳ねさせる（顔だけ・体だけが
 * 分離して見えないように）。
 */
export default function NudgeySheep({ mood, className }: { mood: NudgeyMood; className?: string }) {
  const isSharp = mood === "sharp";

  return (
    <svg
      viewBox="0 0 120 120"
      role="img"
      aria-label="ナッジー"
      className={["block h-auto w-full", className].filter(Boolean).join(" ")}
    >
      {/* 牧草地（常時描画・固定。跳ねる本体とは切り離す） */}
      <g>
        <ellipse cx="60" cy="104" rx="54" ry="9" fill="var(--sand)" />
        <g stroke="var(--palm)" strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M20 103 q2 -8 4 0" />
          <path d="M36 105 q2 -8 4 0" />
          <path d="M60 106 q2 -8 4 0" />
          <path d="M84 105 q2 -8 4 0" />
          <path d="M99 103 q2 -8 4 0" />
        </g>
      </g>

      <motion.g variants={sheepVariants} animate={mood} initial={false}>
        {/* 脚（常時描画） */}
        <g fill="var(--nudgey-ink-soft)">
          <rect x="34" y="80" width="8" height="16" rx="4" />
          <rect x="50" y="84" width="8" height="16" rx="4" />
          <rect x="64" y="84" width="8" height="16" rx="4" />
          <rect x="80" y="80" width="8" height="16" rx="4" />
        </g>

        {/* 耳（常時描画） */}
        <SheepEars />

        {/* ボディ（もこもこ雲＝円の集合。常時描画） */}
        <SheepWool />

        {/* 顔（常時描画・パーツのみ mood で切替） */}
        <SheepFace mood={mood} />

        {/* メガネ（sharp のときだけ。着脱をふわっと見せる） */}
        <AnimatePresence>
          {isSharp && (
            <motion.g
              key="glasses"
              data-testid="glasses"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <SheepGlasses />
            </motion.g>
          )}
        </AnimatePresence>
      </motion.g>
    </svg>
  );
}
