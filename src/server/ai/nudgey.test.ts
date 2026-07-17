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

const { classifyAndReply, selectNudge, generateCompletionReply, generateSoftenedTask } =
  await import("./nudgey");
const { FALLBACK_REPLY, COMPLETION_FALLBACK_REPLY } = await import("./constants");

// selectNudge / generateSoftenedTask は失敗時に console.error でログするため、テスト出力を汚さない
vi.spyOn(console, "error").mockImplementation(() => {});

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

describe("selectNudge", () => {
  const candidates = [
    { seedId: "seed-1", task: "部屋を片付ける" },
    { seedId: "seed-2", task: "本を読む" },
  ];

  beforeEach(() => {
    generateTextMock.mockReset();
  });

  test("候補内の seed_id を選んでいれば ok:true で prophecy とともに返す", async () => {
    generateTextMock.mockResolvedValue({
      output: { seed_id: "seed-2", prophecy: "本を読んだ後、賢くなった気分になれるかも" },
    });

    const result = await selectNudge({ candidates, moods: [], intensity: "chill" });

    expect(result).toEqual({
      ok: true,
      seedId: "seed-2",
      prophecy: "本を読んだ後、賢くなった気分になれるかも",
    });
  });

  test("候補に無い seed_id を返した場合（ハルシネーション）は ok:false", async () => {
    generateTextMock.mockResolvedValue({
      output: { seed_id: "seed-999", prophecy: "でっちあげの予言" },
    });

    const result = await selectNudge({ candidates, moods: [], intensity: "chill" });

    expect(result).toEqual({ ok: false });
  });

  test("LLM 呼び出しが失敗したら ok:false（throw しない）", async () => {
    generateTextMock.mockRejectedValue(new Error("rate limited"));

    const result = await selectNudge({ candidates, moods: [], intensity: "chill" });

    expect(result).toEqual({ ok: false });
  });

  test("候補と直近の気分をプロンプトに含め、intensity 反映済みプロンプトを system として渡す", async () => {
    generateTextMock.mockResolvedValue({ output: { seed_id: "seed-1", prophecy: "..." } });

    await selectNudge({ candidates, moods: ["今日は疲れた"], intensity: "sharp" });

    const args = generateTextMock.mock.calls[0]?.[0] as { prompt: string; system: string };
    expect(args.prompt).toContain("seed-1");
    expect(args.prompt).toContain("部屋を片付ける");
    expect(args.prompt).toContain("今日は疲れた");
    expect(args.system).toContain("Sharp");
  });

  test("気分が空配列のときはプロンプトに「（なし）」と表示する", async () => {
    generateTextMock.mockResolvedValue({ output: { seed_id: "seed-1", prophecy: "..." } });

    await selectNudge({ candidates, moods: [], intensity: "chill" });

    const args = generateTextMock.mock.calls[0]?.[0] as { prompt: string };
    expect(args.prompt).toContain("（なし）");
  });
});

describe("generateCompletionReply", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  test("LLM の reply をそのまま返す", async () => {
    generateTextMock.mockResolvedValue({ output: { reply: "ほら、楽しみだねぇ" } });

    const result = await generateCompletionReply({
      task: "部屋を片付ける",
      prophecy: "片付いた部屋、気持ちいいかも",
      intensity: "chill",
    });

    expect(result).toBe("ほら、楽しみだねぇ");
  });

  test.each([
    { intensity: "chill", expected: COMPLETION_FALLBACK_REPLY.chill },
    { intensity: "sharp", expected: COMPLETION_FALLBACK_REPLY.sharp },
  ])(
    "LLM 呼び出しが失敗したら intensity=$intensity の静的フォールバックを返す（throw しない）",
    async ({ intensity, expected }) => {
      generateTextMock.mockRejectedValue(new Error("rate limited"));

      const result = await generateCompletionReply({
        task: "部屋を片付ける",
        prophecy: null,
        intensity,
      });

      expect(result).toBe(expected);
    },
  );

  test("タスクと予言をプロンプトに含める。予言が無ければ「（なし）」にする", async () => {
    generateTextMock.mockResolvedValue({ output: { reply: "..." } });

    await generateCompletionReply({ task: "部屋を片付ける", prophecy: null, intensity: "chill" });

    const args = generateTextMock.mock.calls[0]?.[0] as { prompt: string };
    expect(args.prompt).toContain("部屋を片付ける");
    expect(args.prompt).toContain("（なし）");
  });
});

describe("generateSoftenedTask", () => {
  beforeEach(() => {
    generateTextMock.mockReset();
  });

  test("成功時は緩和タスクと reply を ok:true で返す", async () => {
    generateTextMock.mockResolvedValue({
      output: { softened_task: "机の上だけ片付ける", reply: "じゃあ机の上だけとか？" },
    });

    const result = await generateSoftenedTask({ task: "部屋を片付ける", intensity: "chill" });

    expect(result).toEqual({
      ok: true,
      softenedTask: "机の上だけ片付ける",
      reply: "じゃあ机の上だけとか？",
    });
  });

  test("LLM 呼び出しが失敗したら ok:false + キャラ内エラー応答を返す（throw しない）", async () => {
    generateTextMock.mockRejectedValue(new Error("rate limited"));

    const result = await generateSoftenedTask({ task: "部屋を片付ける", intensity: "chill" });

    expect(result).toEqual({ ok: false, reply: FALLBACK_REPLY });
  });

  test("タスクをプロンプトに含める", async () => {
    generateTextMock.mockResolvedValue({ output: { softened_task: "...", reply: "..." } });

    await generateSoftenedTask({ task: "部屋を片付ける", intensity: "chill" });

    const args = generateTextMock.mock.calls[0]?.[0] as { prompt: string };
    expect(args.prompt).toContain("部屋を片付ける");
  });
});
