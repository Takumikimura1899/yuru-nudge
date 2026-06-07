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
