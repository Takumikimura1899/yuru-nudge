import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { FALLBACK_REPLY, NUDGEY_MODEL } from "./constants";
import { buildPrompt } from "./prompt";
import { nudgeyResponseSchema, type NudgeyResponse } from "./schema";

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
