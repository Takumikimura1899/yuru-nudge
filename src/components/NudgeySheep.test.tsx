// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vite-plus/test";
import NudgeySheep, { type NudgeyMood } from "./NudgeySheep";

afterEach(() => {
  cleanup();
});

describe("NudgeySheep", () => {
  test("role=img と aria-label『ナッジー』を持つ", () => {
    render(<NudgeySheep mood="chill" />);

    expect(screen.getByRole("img", { name: "ナッジー" })).toBeInTheDocument();
  });

  test.each([
    { mood: "chill" as NudgeyMood, hasGlasses: false, hasHappyFace: false },
    { mood: "sharp" as NudgeyMood, hasGlasses: true, hasHappyFace: false },
    { mood: "happy" as NudgeyMood, hasGlasses: false, hasHappyFace: true },
  ])(
    "mood=$mood: メガネ表示=$hasGlasses、喜び表情表示=$hasHappyFace",
    ({ mood, hasGlasses, hasHappyFace }) => {
      render(<NudgeySheep mood={mood} />);

      expect(screen.queryByTestId("glasses") !== null).toBe(hasGlasses);
      expect(screen.queryByTestId("happy-face") !== null).toBe(hasHappyFace);
    },
  );

  test("className を渡すと svg のクラスに追加される（デフォルトのサイズ指定は保持する）", () => {
    render(<NudgeySheep mood="chill" className="custom-class" />);

    const svg = screen.getByRole("img", { name: "ナッジー" });
    expect(svg).toHaveClass("custom-class");
    expect(svg).toHaveClass("w-full");
  });
});
