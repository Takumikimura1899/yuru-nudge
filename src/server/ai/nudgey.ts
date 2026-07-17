import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import {
  COMPLETION_FALLBACK_REPLY,
  FALLBACK_REPLY,
  NUDGEY_MODEL,
  REVIEW_FALLBACK_REPLY,
} from "./constants";
import {
  buildCompletionPrompt,
  buildMonthlyReviewPrompt,
  buildNudgeSelectPrompt,
  buildPrompt,
  buildSoftenPrompt,
} from "./prompt";
import {
  completionReplySchema,
  monthlyReviewSchema,
  nudgeSelectSchema,
  nudgeyResponseSchema,
  softenedTaskSchema,
  type NudgeyResponse,
} from "./schema";

export type ClassifyResult = { ok: true; data: NudgeyResponse } | { ok: false; reply: string };

/**
 * つぶやきを分類しナッジーの応答を生成する（1回のLLM呼び出しで両方）。
 * 失敗時は throw せず、キャラ内エラー応答を ok:false で返す（設計書 §4.5）。
 * DB には一切触れない。
 */
export async function classifyAndReply(args: {
  content: string;
  intensity: string;
}): Promise<ClassifyResult> {
  try {
    const { output } = await generateText({
      model: google(NUDGEY_MODEL),
      output: Output.object({ schema: nudgeyResponseSchema }),
      system: buildPrompt({ intensity: args.intensity }),
      prompt: args.content,
    });
    return { ok: true, data: output };
  } catch {
    return { ok: false, reply: FALLBACK_REPLY };
  }
}

export type SelectNudgeResult = { ok: true; seedId: string; prophecy: string } | { ok: false };

/**
 * pending seed 候補から今提案する1つを LLM に選ばせ、未来予言を1文生成する（設計書 §9.2）。
 * LLM が候補にない seed_id を返した場合（ハルシネーション）は ok:false にする。
 * 失敗時は throw せず ok:false を返す（呼び出し側は「今回はナッジなし」として扱う）。
 */
export async function selectNudge(args: {
  candidates: { seedId: string; task: string }[];
  moods: string[];
  intensity: string;
}): Promise<SelectNudgeResult> {
  try {
    const candidateLines = args.candidates
      .map((c) => `- id: ${c.seedId}, task: ${c.task}`)
      .join("\n");
    const moodLines =
      args.moods.length > 0 ? args.moods.map((m) => `- ${m}`).join("\n") : "（なし）";

    const { output } = await generateText({
      model: google(NUDGEY_MODEL),
      output: Output.object({ schema: nudgeSelectSchema }),
      system: buildNudgeSelectPrompt({ intensity: args.intensity }),
      prompt: `候補:\n${candidateLines}\n\n最近の気分:\n${moodLines}`,
    });

    const isKnownCandidate = args.candidates.some((c) => c.seedId === output.seed_id);
    if (!isKnownCandidate) {
      console.error("selectNudge: LLM が候補にない seed_id を返した", output.seed_id);
      return { ok: false };
    }

    return { ok: true, seedId: output.seed_id, prophecy: output.prophecy };
  } catch (error) {
    console.error("selectNudge failed", error);
    return { ok: false };
  }
}

/**
 * 完了報告への答え合わせ応答を生成する（設計書 §3.5）。
 * 失敗時は throw せず、intensity に応じた静的フォールバック文を返す。
 */
export async function generateCompletionReply(args: {
  task: string;
  prophecy: string | null;
  intensity: string;
}): Promise<string> {
  try {
    const prompt = `タスク: ${args.task}\n予言: ${args.prophecy ?? "（なし）"}`;

    const { output } = await generateText({
      model: google(NUDGEY_MODEL),
      output: Output.object({ schema: completionReplySchema }),
      system: buildCompletionPrompt({ intensity: args.intensity }),
      prompt,
    });

    return output.reply;
  } catch (error) {
    console.error("generateCompletionReply failed", error);
    return COMPLETION_FALLBACK_REPLY[args.intensity === "sharp" ? "sharp" : "chill"];
  }
}

export type SoftenedTaskResult =
  | { ok: true; softenedTask: string; reply: string }
  | { ok: false; reply: string };

/**
 * 「難しい」反応時の緩和版タスクを生成する（設計書 §3.3, §3.4）。
 * 失敗時は throw せず ok:false + キャラ内エラー応答を返す（呼び出し側は状態遷移を行わない）。
 */
export async function generateSoftenedTask(args: {
  task: string;
  intensity: string;
}): Promise<SoftenedTaskResult> {
  try {
    const { output } = await generateText({
      model: google(NUDGEY_MODEL),
      output: Output.object({ schema: softenedTaskSchema }),
      system: buildSoftenPrompt({ intensity: args.intensity }),
      prompt: `タスク: ${args.task}`,
    });

    return { ok: true, softenedTask: output.softened_task, reply: output.reply };
  } catch (error) {
    console.error("generateSoftenedTask failed", error);
    return { ok: false, reply: FALLBACK_REPLY };
  }
}

/** プロンプトに列挙する完了タスクの上限件数（件数自体は全数をプロンプトに明記する） */
const MONTHLY_REVIEW_PROMPT_CAP = 10;

/**
 * 月次振り返りのセリフを生成する（設計書 §9.3, §10.2）。
 * 失敗時は throw せず、件数入りの静的フォールバックを返す。
 */
export async function generateMonthlyReview(args: {
  completed: { task: string; prophecy: string }[];
  intensity: string;
}): Promise<string> {
  try {
    const lines = args.completed
      .slice(0, MONTHLY_REVIEW_PROMPT_CAP)
      .map((c) => `- ${c.task}${c.prophecy ? `（予言: ${c.prophecy}）` : ""}`)
      .join("\n");

    const { output } = await generateText({
      model: google(NUDGEY_MODEL),
      output: Output.object({ schema: monthlyReviewSchema }),
      system: buildMonthlyReviewPrompt({ intensity: args.intensity }),
      prompt: `先月完了したタスク（全${args.completed.length}件）:\n${lines}`,
    });

    return output.reply;
  } catch (error) {
    console.error("generateMonthlyReview failed", error);
    return REVIEW_FALLBACK_REPLY[args.intensity === "sharp" ? "sharp" : "chill"](
      args.completed.length,
    );
  }
}
