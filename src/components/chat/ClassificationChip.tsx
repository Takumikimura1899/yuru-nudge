import type { ClassificationChip as ClassificationChipData } from "./useChat";

/**
 * つぶやき分類チップ。ナッジー返答バブルの直下に、つぶやきが seed（タネ）/ mood（きもち）の
 * どちらに分類されたかを表示する。文言テンプレートはここに集約する（他所で文字列を重複定義しない）。
 */
export default function ClassificationChip({ category, task }: ClassificationChipData) {
  return (
    <span className="inline-flex items-center gap-1 self-start rounded-full border border-[var(--line)] bg-[var(--surface-strong)] px-2.5 py-1 text-xs text-[var(--sea-ink-soft)]">
      {category === "seed" ? (
        <>
          <span aria-hidden>🌱</span>
          <span>{task ? `タネにしたよ：『${task}』` : "タネにしたよ"}</span>
        </>
      ) : (
        <>
          <span aria-hidden>💭</span>
          <span>きもち、きいたよ</span>
        </>
      )}
    </span>
  );
}
