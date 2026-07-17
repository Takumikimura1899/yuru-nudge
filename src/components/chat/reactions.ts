import type { ReactionKind } from "../../server/nudges";

/**
 * nudged タスクへの反応ボタンの定義（設計書 §3.3 の状態遷移に対応）。
 * NudgeCard（ボタン表示順）と useChat（楽観表示のラベル参照）の両方から参照する単一ソース。
 */
export const REACTIONS: { value: ReactionKind; label: string }[] = [
  { value: "completed", label: "やったよ" },
  { value: "softened", label: "難しい" },
  { value: "archived", label: "いらない" },
];

export const REACTION_LABELS: Record<ReactionKind, string> = Object.fromEntries(
  REACTIONS.map((reaction) => [reaction.value, reaction.label]),
) as Record<ReactionKind, string>;

export type ParentSuggestionAction = "revive" | "decline";

/**
 * 親タスク再提案カードのボタン定義（設計書 §3.4）。
 * ParentSuggestionCard（ボタン表示順）と useChat（楽観表示のラベル参照）の両方から参照する単一ソース。
 */
export const PARENT_SUGGESTION_ACTIONS: { value: ParentSuggestionAction; label: string }[] = [
  { value: "revive", label: "やってみる" },
  { value: "decline", label: "今はいいや" },
];

export const PARENT_SUGGESTION_LABELS: Record<ParentSuggestionAction, string> = Object.fromEntries(
  PARENT_SUGGESTION_ACTIONS.map((action) => [action.value, action.label]),
) as Record<ParentSuggestionAction, string>;
