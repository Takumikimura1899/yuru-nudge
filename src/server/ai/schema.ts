import { z } from "zod";

/** LLM が 1 回の呼び出しで返す分類 + 応答 + タスク整形の構造化出力 */
export const nudgeyResponseSchema = z.object({
  category: z
    .enum(["seed", "mood"])
    .describe(
      "つぶやきの分類。seed: アクション可能なタスクの種。mood: 行動に落とせない気分・雑感。曖昧な場合は seed",
    ),
  reply: z.string().min(1).describe("ナッジーの応答（1〜2文）"),
  processed_task: z
    .string()
    .nullable()
    .describe(
      "category が seed のとき、アクション可能な短い動詞句に整えたタスク文。mood のときは null",
    ),
});

export type NudgeyResponse = z.infer<typeof nudgeyResponseSchema>;

/** ナッジ選択 LLM の構造化出力（seed候補から1つ選び、未来予言を1文添える） */
export const nudgeSelectSchema = z.object({
  seed_id: z.string().describe("提案する seed の id。候補の中からそのまま1つ選ぶ"),
  prophecy: z.string().min(1).describe("提案に添える未来予言（1文）。提案バブルの本文そのもの"),
});

export type NudgeSelectResult = z.infer<typeof nudgeSelectSchema>;

/** 完了報告への答え合わせ応答の構造化出力 */
export const completionReplySchema = z.object({
  reply: z.string().min(1).describe("完了報告への短い受け止め（1〜2文）"),
});

export type CompletionReplyResult = z.infer<typeof completionReplySchema>;

/** 「難しい」反応時の緩和版タスク生成の構造化出力 */
export const softenedTaskSchema = z.object({
  softened_task: z
    .string()
    .min(1)
    .describe("元のタスクを緩和した、アクション可能な短い動詞句（元より明らかに小さい粒度）"),
  reply: z.string().min(1).describe("緩和版を提案する短い一声（1文程度）"),
});

export type SoftenedTaskResult = z.infer<typeof softenedTaskSchema>;
