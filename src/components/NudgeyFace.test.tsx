// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vite-plus/test";
import type { NudgeyMood } from "./nudgey/parts";
import NudgeyFace from "./NudgeyFace";

afterEach(() => {
  cleanup();
});

describe("NudgeyFace", () => {
  test("role=img と aria-label『ナッジー』を持つ", () => {
    render(<NudgeyFace mood="chill" />);

    expect(screen.getByRole("img", { name: "ナッジー" })).toBeInTheDocument();
  });

  test.each([
    { mood: "chill" as NudgeyMood, hasGlasses: false, hasHappyFace: false },
    { mood: "sharp" as NudgeyMood, hasGlasses: true, hasHappyFace: false },
    { mood: "happy" as NudgeyMood, hasGlasses: false, hasHappyFace: true },
  ])(
    "mood=$mood: メガネ表示=$hasGlasses、喜び表情表示=$hasHappyFace",
    ({ mood, hasGlasses, hasHappyFace }) => {
      render(<NudgeyFace mood={mood} />);

      expect(screen.queryByTestId("avatar-glasses") !== null).toBe(hasGlasses);
      expect(screen.queryByTestId("avatar-happy-face") !== null).toBe(hasHappyFace);
    },
  );

  test("className を渡すと svg のクラスに追加される（デフォルトの block クラスは保持する）", () => {
    render(<NudgeyFace mood="chill" className="custom-class" />);

    const svg = screen.getByRole("img", { name: "ナッジー" });
    expect(svg).toHaveClass("custom-class");
    expect(svg).toHaveClass("block");
  });

  test("decorative のときは aria-hidden になり、role と aria-label を持たない", () => {
    const { container } = render(<NudgeyFace mood="chill" decorative />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(svg).not.toHaveAttribute("aria-label");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
