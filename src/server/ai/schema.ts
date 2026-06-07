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
