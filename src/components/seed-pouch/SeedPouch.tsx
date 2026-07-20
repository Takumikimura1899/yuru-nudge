import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSeedPouch, type PouchSeed } from "../../server/nudges";
import SeedPouchSheet from "./SeedPouchSheet";

type PouchStatus = "loading" | "error" | "ready";

/**
 * タネ袋のトリガーボタン + ボトムシートのコンテナ。
 * チャット状態とのライブ同期はしない（設計判断: fetch-on-open で足りる。Context・イベントバス・
 * lift はこのプロジェクトの規約で導入禁止）。シートは開いた時点のスナップショットを表示するのみで、
 * 開いている間に他所でタネの状態が変わっても反映されない。
 * スクロールロック・フォーカストラップ・Escクローズは SeedPouchSheet 側が担う
 * （AnimatePresence は退場アニメーション完了までそちらをマウントし続けるため、表示中はずっと有効になる）。
 */
export default function SeedPouch() {
  const [open, setOpen] = useState(false);
  const [seeds, setSeeds] = useState<PouchSeed[] | null>(null);
  const [status, setStatus] = useState<PouchStatus>("loading");
  const requestSeqRef = useRef(0);

  /**
   * 前回の seeds を維持したまま再取得する（stale-while-revalidate）。失敗時は status のみ error にする。
   * マウント時 fetch とオープン時 fetch（+リトライ）が並行しうるため、リクエスト連番で後発以外の
   * レスポンスを破棄する（後着の古いレスポンス、特に失敗が新しい状態を上書きしないようにする）。
   */
  async function fetchPouch() {
    const seq = ++requestSeqRef.current;
    setStatus("loading");
    try {
      const result = await getSeedPouch();
      if (seq !== requestSeqRef.current) return; // 後発が走っていたら破棄
      setSeeds(result);
      setStatus("ready");
    } catch {
      if (seq !== requestSeqRef.current) return;
      setStatus("error");
    }
  }

  // マウント時（トリガーボタンのバッジ初期値用）に1回だけ取得する
  useEffect(() => {
    void fetchPouch();
  }, []);

  function openSheet() {
    setOpen(true);
    void fetchPouch();
  }

  // SeedPouchSheet の keydown effect の依存に使われるため安定した参照にする
  // （そうしないと背景の再取得で SeedPouch が再レンダーするたびに毎回作り直され、
  // 表示中のフォーカス位置がリセットされてしまう）
  const closeSheet = useCallback(() => setOpen(false), []);

  const count = seeds?.length ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-label={count > 0 ? `タネ袋を開く（${count}個）` : "タネ袋を開く（からっぽ）"}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] px-3 py-1.5 text-sm font-semibold text-[var(--sea-ink)] shadow-[0_8px_22px_rgba(30,90,72,0.08)] transition hover:-translate-y-0.5"
      >
        <span aria-hidden>🌱</span>
        <span>タネ袋（{count}）</span>
      </button>

      {/* トリガーへのフォーカス復帰は SeedPouchSheet 側の effect クリーンアップ
          （実 unmount = 退場アニメーション完了時）が「開いた時点の要素」へ戻す */}
      <AnimatePresence>
        {open && (
          <SeedPouchSheet seeds={seeds} status={status} onClose={closeSheet} onRetry={fetchPouch} />
        )}
      </AnimatePresence>
    </>
  );
}
