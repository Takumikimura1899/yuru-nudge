/** ナッジーの応答生成に使う Gemini モデル。コスト・レイテンシ優先で flash 系を既定にする */
export const NUDGEY_MODEL = "gemini-2.5-flash";

/** LLM 呼び出し失敗時のキャラ内エラー応答（設計書 §4.5） */
export const FALLBACK_REPLY = "今日はちょっとぼんやりしてるみたい…もう一回言ってくれる？";

/** mood ログの保持上限（設計書 §6.1）。超過分は古いものから削除 */
export const MOOD_LOG_LIMIT = 30;

/** チャットタイムラインの表示件数（設計書 §11.2） */
export const TIMELINE_LIMIT = 20;

/** つぶやきの最大文字数（設計書 §4.3） */
export const MAX_CONTENT_LENGTH = 140;

/** 新規ナッジ提案の最短間隔（設計書 §9.1）。前回 nudged_at からこの時間が経つまでは新規提案しない */
export const NUDGE_INTERVAL_HOURS = 12;

/** nudged 状態のまま無視され続けた場合の自動 archive までの日数（設計書 §9.4） */
export const NUDGE_TIMEOUT_DAYS = 7;

/** この件数以上 pending seed が溜まったら、通常ナッジの代わりに棚卸しを優先する（設計書 §5.2） */
export const HOUSEKEEPING_THRESHOLD = 15;

/**
 * DB由来の intensity_level（string）を "chill" | "sharp" の2値へ正規化する。
 * 未知の値や null 相当の入力は chill 扱い（設計書の既定トーン）。
 * 上記の intensity キー付き静的応答オブジェクトのインデックスや、羊の表情判定などに使う。
 */
export function normalizeIntensity(intensity: string): "chill" | "sharp" {
  return intensity === "sharp" ? "sharp" : "chill";
}

/** 「いらない」反応時の静的応答（設計書 §8.4 の「断り」を踏襲。ゆるく受容し、責めない） */
export const ARCHIVED_REPLY = {
  chill: "そっか、じゃあやめとこ〜。また気になったら教えてね",
  sharp: "了解。タイミングが来たらまた声かけるね",
} as const;

/** 完了時の答え合わせ応答の LLM 失敗時フォールバック（設計書 §8.4 の「完了」サンプルを流用） */
export const COMPLETION_FALLBACK_REPLY = {
  chill: "やったんだ〜。えらいねぇ",
  sharp: "いいね、お疲れさま",
} as const;

/** 月次振り返りの LLM 失敗時フォールバック（件数入り。設計書 §9.3, §10.2 のトーンを踏襲） */
export const REVIEW_FALLBACK_REPLY = {
  chill: (count: number) => `先月は${count}個も終わらせてたんだねぇ。えらいねぇ`,
  sharp: (count: number) => `先月の完了は${count}件。いいペースだったね`,
} as const;

/** 累計セリフ織り込みを試みる確率（設計書 §8.2「たまに織り込む（低確率）」） */
export const TALLY_MENTION_PROBABILITY = 0.3;

/** 累計セリフを織り込むための completed 総数の下限（少なすぎる件数では言及しない） */
export const TALLY_MENTION_MIN_COUNT = 3;

/**
 * 親タスクの再提案で「やってみる」が選ばれた際の静的応答（設計書 §3.4）。
 * 即時ナッジはしない（自動復帰ではない）ため LLM は呼ばず、pending に戻したことだけを伝える
 */
export const PARENT_REVIVED_REPLY = {
  chill: "じゃあまた気が向いたときに声かけるね",
  sharp: "了解。またタイミングを見て声をかけるね",
} as const;
