import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { NudgeyResponse } from "./schema";

const generateTextMock = vi.fn();

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  Output: { object: (opts: unknown) => opts },
}));

vi.mock("@ai-sdk/google", () => ({
  google: (model: string) => ({ modelId: model }),
}));

const { classifyAndReply } = await import("./nudgey");
const { FALLBACK_REPLY } = await import("./constants");

const createMockNudgeyResponse = (overrides: Partial<NudgeyResponse> = {}): NudgeyResponse => ({
  category: "seed",
  reply: "部屋を片付けたいんだねぇ。覚えておくよ",
  processed_task: "部屋を片付ける",
  ...overrides,
});

describe("classifyAndReply", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  test("LLM が返した構造化出力を ok:true で返す", async () => {
    const output = createMockNudgeyResponse();
    generateTextMock.mockResolvedValue({ output });

    const result = await classifyAndReply({
      content: "部屋を片付けたい",
      intensity: "chill",
    });

    expect(result).toEqual({ ok: true, data: output });
  });

  test("mood 分類の出力もそのまま返す", async () => {
    const output = createMockNudgeyResponse({
      category: "mood",
      reply: "そっかぁ、疲れてるんだねぇ",
      processed_task: null,
    });
    generateTextMock.mockResolvedValue({ output });

    const result = await classifyAndReply({
      content: "今日は疲れた",
      intensity: "chill",
    });

    expect(result).toEqual({ ok: true, data: output });
  });

  test("つぶやき本文を prompt、intensity 反映済みプロンプトを system として渡す", async () => {
    generateTextMock.mockResolvedValue({ output: createMockNudgeyResponse() });

    await classifyAndReply({ content: "本を読みたい", intensity: "sharp" });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const args = generateTextMock.mock.calls[0]?.[0] as {
      prompt: string;
      system: string;
    };
    expect(args.prompt).toBe("本を読みたい");
    expect(args.system).toContain("Sharp");
  });

  test("LLM 呼び出しが失敗したらキャラ内エラーを ok:false で返す（throw しない）", async () => {
    generateTextMock.mockRejectedValue(new Error("rate limited"));

    const result = await classifyAndReply({
      content: "部屋を片付けたい",
      intensity: "chill",
    });

    expect(result).toEqual({ ok: false, reply: FALLBACK_REPLY });
  });
});
