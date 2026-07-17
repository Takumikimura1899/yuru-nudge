import { describe, expect, test } from "vite-plus/test";
import {
  buildCompletionPrompt,
  buildMonthlyReviewPrompt,
  buildNudgeSelectPrompt,
  buildPrompt,
  buildSoftenPrompt,
} from "./prompt";

describe("buildPrompt", () => {
  test("ナッジーのキャラクター定義を含む", () => {
    const prompt = buildPrompt({ intensity: "chill" });
    expect(prompt).toContain("ナッジー");
    expect(prompt).toContain("ぼく");
    expect(prompt).toContain("〜だねぇ");
  });

  test("分類基準（曖昧なら seed）を含む", () => {
    const prompt = buildPrompt({ intensity: "chill" });
    expect(prompt).toContain("seed");
    expect(prompt).toContain("mood");
    expect(prompt).toContain("曖昧");
    expect(prompt).toMatch(/曖昧.*seed/s);
  });

  test("NGトーン（責めない・義務感禁止）を含む", () => {
    const prompt = buildPrompt({ intensity: "chill" });
    expect(prompt).toContain("まだやってないの？");
    expect(prompt).toContain("やらなきゃ");
    expect(prompt).toContain("するべき");
    expect(prompt).toContain("禁止");
  });

  test.each([
    { intensity: "chill", keyword: "〜かもねぇ" },
    { intensity: "sharp", keyword: "〜すると効率いいよ" },
  ])("intensity=$intensity のトーン（$keyword）を含む", ({ intensity, keyword }) => {
    expect(buildPrompt({ intensity })).toContain(keyword);
  });

  test("chill と sharp でトーン部分が異なる", () => {
    const chill = buildPrompt({ intensity: "chill" });
    const sharp = buildPrompt({ intensity: "sharp" });
    expect(chill).not.toBe(sharp);
    expect(chill).toContain("Chill");
    expect(sharp).toContain("Sharp");
  });

  test("未知の intensity は chill として扱う", () => {
    expect(buildPrompt({ intensity: "unknown" })).toContain("Chill");
  });
});

describe("buildNudgeSelectPrompt", () => {
  test("入力形式（候補・最近の気分）の説明を含む", () => {
    const prompt = buildNudgeSelectPrompt({ intensity: "chill" });
    expect(prompt).toContain("候補");
    expect(prompt).toContain("最近の気分");
  });

  test("候補にない id を作らない旨の選択基準を含む", () => {
    const prompt = buildNudgeSelectPrompt({ intensity: "chill" });
    expect(prompt).toContain("候補にある id をそのまま");
    expect(prompt).toContain("候補にない id を作らない");
  });

  test("未来予言（prophecy）の作り方を含む", () => {
    const prompt = buildNudgeSelectPrompt({ intensity: "chill" });
    expect(prompt).toContain("未来予言");
    expect(prompt).toContain("prophecy");
  });

  test("NGトーン（禁止事項）を含む", () => {
    expect(buildNudgeSelectPrompt({ intensity: "chill" })).toContain("禁止事項");
  });

  test.each([
    { intensity: "chill", keyword: "Chill" },
    { intensity: "sharp", keyword: "Sharp" },
  ])("intensity=$intensity のトーン（$keyword）を含む", ({ intensity, keyword }) => {
    expect(buildNudgeSelectPrompt({ intensity })).toContain(keyword);
  });
});

describe("buildCompletionPrompt", () => {
  test("入力形式（タスク・予言）の説明を含む", () => {
    const prompt = buildCompletionPrompt({ intensity: "chill" });
    expect(prompt).toContain("タスク");
    expect(prompt).toContain("予言");
  });

  test("予言の答え合わせと、次のタスクに触れない旨の方針を含む", () => {
    const prompt = buildCompletionPrompt({ intensity: "chill" });
    expect(prompt).toContain("答え合わせ");
    expect(prompt).toContain("次のタスクには一切触れない");
  });

  test.each([
    { intensity: "chill", keyword: "Chill" },
    { intensity: "sharp", keyword: "Sharp" },
  ])("intensity=$intensity のトーン（$keyword）を含む", ({ intensity, keyword }) => {
    expect(buildCompletionPrompt({ intensity })).toContain(keyword);
  });

  test("completedCount 未指定時は累計言及節を含まない", () => {
    const prompt = buildCompletionPrompt({ intensity: "chill" });
    expect(prompt).not.toContain("累計言及");
    expect(prompt).not.toContain("累計完了数");
  });

  test("completedCount が渡されたら累計言及節（自慢げにしない・次を促さない）と入力形式の説明を含む", () => {
    const prompt = buildCompletionPrompt({ intensity: "chill", completedCount: 5 });
    expect(prompt).toContain("累計言及");
    expect(prompt).toContain("累計完了数");
    expect(prompt).toContain("自慢げにしない");
    expect(prompt).toContain("次を促さない");
  });

  test("completedCount が null のときは未指定時と同様に累計言及節を含まない", () => {
    const prompt = buildCompletionPrompt({ intensity: "chill", completedCount: null });
    expect(prompt).not.toContain("累計言及");
  });
});

describe("buildSoftenPrompt", () => {
  test("元のタスクより明らかに小さい粒度にする旨の緩和基準を含む", () => {
    const prompt = buildSoftenPrompt({ intensity: "chill" });
    expect(prompt).toContain("softened_task");
    expect(prompt).toContain("明らかに小さく");
  });

  test("無理はさせない旨の応答方針を含む", () => {
    expect(buildSoftenPrompt({ intensity: "chill" })).toContain("無理はさせない");
  });

  test.each([
    { intensity: "chill", keyword: "Chill" },
    { intensity: "sharp", keyword: "Sharp" },
  ])("intensity=$intensity のトーン（$keyword）を含む", ({ intensity, keyword }) => {
    expect(buildSoftenPrompt({ intensity })).toContain(keyword);
  });
});

describe("buildMonthlyReviewPrompt", () => {
  test("入力形式（完了したタスク）の説明を含む", () => {
    const prompt = buildMonthlyReviewPrompt({ intensity: "chill" });
    expect(prompt).toContain("完了したタスク");
  });

  test("先月について語り、今月の催促はしない旨の応答方針を含む", () => {
    const prompt = buildMonthlyReviewPrompt({ intensity: "chill" });
    expect(prompt).toContain("先月について語る");
    expect(prompt).toContain("催促はしない");
  });

  test("NGトーン（禁止事項）を含む", () => {
    expect(buildMonthlyReviewPrompt({ intensity: "chill" })).toContain("禁止事項");
  });

  test.each([
    { intensity: "chill", keyword: "Chill" },
    { intensity: "sharp", keyword: "Sharp" },
  ])("intensity=$intensity のトーン（$keyword）を含む", ({ intensity, keyword }) => {
    expect(buildMonthlyReviewPrompt({ intensity })).toContain(keyword);
  });
});
