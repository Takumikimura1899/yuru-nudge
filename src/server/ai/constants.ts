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

/** seedの保持上限（暫定）。一時超過は許容する（設計書 §5.1, §5.3） */
export const SEED_LIMIT = 20;

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
