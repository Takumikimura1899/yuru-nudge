import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { PouchSeed } from "../../server/nudges";

const SHEET_HEADING_ID = "seed-pouch-heading";
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** タネ袋シートの文言。他所で重複定義しない（唯一のソース） */
const COPY = {
  heading: (count: number) => (count > 0 ? `タネ袋（${count}個）` : "タネ袋"),
  loading: "タネ袋をひらいてるよ…",
  empty: "タネ袋はまだからっぽ。つぶやくとナッジーがタネにして貯めていくよ",
  error: "うーん、タネ袋がうまく開けなかった…もう一回ひらいてみて",
  retry: "もういちど",
  close: "閉じる",
  nudgedPill: "提案中",
  listRegion: "タネの一覧",
};

/**
 * タネ袋のオーバーレイ + ボトムシート本体（presentational + 表示中のフォーカス/スクロール制御）。
 * 表示要否は親（SeedPouch）がマウント/アンマウントで制御するが、AnimatePresence は退場アニメーション
 * 完了までこのコンポーネントをマウントし続けるため、body スクロールロック・フォーカストラップ・
 * Esc クローズ・フォーカス復帰の effect はここに置く（`open` の即時変化ではなく実 unmount =
 * アニメ完了時にクリーンアップが走るようにするため）。フォーカス復帰はクリーンアップ内で
 * 「focusin リスナー除去 → returnFocusRef（未指定時は開時要素）へ復帰」の順に行う —
 * 親側の onExitComplete で復帰させると、まだ生きている focusin リスナーが復帰フォーカスを
 * シートへ引き戻す競合が起きる（テストで再現済みのため復活させないこと）。
 */
export default function SeedPouchSheet({
  seeds,
  status,
  onClose,
  onRetry,
  returnFocusRef,
}: {
  seeds: PouchSeed[] | null;
  status: "loading" | "error" | "ready";
  onClose: () => void;
  onRetry: () => void;
  /** 閉じたあとフォーカスを戻す先（通常はトリガーボタン）。未指定時は開いた時点の要素へ戻す */
  returnFocusRef?: { readonly current: HTMLElement | null };
}) {
  const count = seeds?.length ?? 0;
  // シート本文に描画する内容の単一ソース。region/tabIndex の付与条件と描画分岐の両方が
  // ここから導出されるため、両者が食い違うことは構造的にない
  const view =
    status === "error"
      ? ({ kind: "error" } as const)
      : seeds === null
        ? ({ kind: "loading" } as const)
        : seeds.length === 0
          ? ({ kind: "empty" } as const)
          : ({ kind: "list", seeds } as const);
  const panelRef = useRef<HTMLDivElement>(null);

  // 表示中は body スクロールをロックする。クリーンアップは実 unmount（退場アニメーション完了後）で走る
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  // マウント時にシート内の先頭 focusable（✕ボタン）へフォーカスを移し、表示中（退場アニメーション中も
  // 含む）は Tab/Shift+Tab をシート内で循環させ、Esc で閉じる。Tab 以外の経路（スクリーンリーダーの
  // 仮想カーソル・アドレスバーからの復帰等）でフォーカスが外へ逃げた場合も focusin で引き戻す
  useEffect(() => {
    const panel = panelRef.current;
    // 開いた時点でフォーカスされていた要素（通常はトリガーボタン）を記録し、クリーンアップで復帰する
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const nodes = panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (!panel || panel.contains(event.target as Node)) return;
      panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    // クリーンアップは実 unmount（退場アニメーション完了）時。focusin リスナーを外した後に
    // 復帰フォーカスを行う順序なので、復帰先を自分で引き戻してしまう競合は構造的に起きない。
    // 復帰先は returnFocusRef を優先する（macOS の Safari/Firefox はクリックでボタンに
    // フォーカスが乗らず、開時の activeElement が body になりうるため記録だけでは不十分）。
    // 依存の onClose は親で useCallback 済み（不安定だと表示中に effect が再実行され
    // previouslyFocused の記録が壊れる）
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      (returnFocusRef?.current ?? previouslyFocused)?.focus();
    };
  }, [onClose, returnFocusRef]);

  return (
    <>
      <motion.div
        aria-hidden
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/40"
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={SHEET_HEADING_ID}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.8 }}
        className="fixed inset-x-0 bottom-0 z-[60] mx-auto flex w-full max-w-lg flex-col gap-3 rounded-t-3xl border border-[var(--line)] bg-[var(--surface-strong)] p-5 shadow-[0_-8px_30px_rgba(0,0,0,0.15)]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={SHEET_HEADING_ID} className="m-0 text-base font-semibold text-[var(--sea-ink)]">
            {COPY.heading(count)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={COPY.close}
            className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-2.5 py-1.5 text-sm text-[var(--sea-ink-soft)] transition hover:-translate-y-0.5"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>

        {/* スクロール領域はフォーカス可能にしないとキーボード（矢印キー）でスクロールできない。
            region/ラベル/tabIndex は一覧描画時（view.kind === "list"）だけ付ける
            （stale な seeds 件数で決めると、エラー表示中も『タネの一覧』として focusable に残る） */}
        <div
          {...(view.kind === "list" && {
            role: "region",
            "aria-label": COPY.listRegion,
            tabIndex: 0,
          })}
          className="max-h-[70vh] overflow-y-auto rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--chip-line)]"
        >
          {view.kind === "error" ? (
            <div className="flex flex-col items-start gap-3 py-4">
              <p className="m-0 text-sm text-[var(--sea-ink-soft)]">{COPY.error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--sea-ink)] transition hover:-translate-y-0.5"
              >
                {COPY.retry}
              </button>
            </div>
          ) : view.kind === "loading" ? (
            <p role="status" className="m-0 py-4 text-sm text-[var(--sea-ink-soft)] italic">
              {COPY.loading}
            </p>
          ) : view.kind === "empty" ? (
            <p className="m-0 py-4 text-sm text-[var(--sea-ink-soft)]">{COPY.empty}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {view.seeds.map((seed) => (
                <li
                  key={seed.seedId}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5"
                >
                  <span className="text-sm text-[var(--sea-ink)]">{seed.task}</span>
                  {seed.status === "nudged" && (
                    <span className="shrink-0 rounded-full border border-[var(--chip-line)] px-2.5 py-0.5 text-xs text-[var(--sea-ink-soft)]">
                      {COPY.nudgedPill}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>
    </>
  );
}
