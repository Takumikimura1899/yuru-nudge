import { describe, expect, test } from "vite-plus/test";
import { buildPrompt } from "./prompt";

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
