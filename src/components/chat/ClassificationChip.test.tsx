// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vite-plus/test";
import ClassificationChip from "./ClassificationChip";

afterEach(() => {
  cleanup();
});

describe("ClassificationChip", () => {
  test("seed かつ task ありなら「🌱 タネにしたよ：『{task}』」を表示する", () => {
    render(<ClassificationChip category="seed" task="部屋を片付ける" />);

    expect(screen.getByText("🌱")).toBeInTheDocument();
    expect(screen.getByText("タネにしたよ：『部屋を片付ける』")).toBeInTheDocument();
  });

  test("seed かつ task が null なら「🌱 タネにしたよ」を表示する（LLM スキーマ逸脱の稀ケース）", () => {
    render(<ClassificationChip category="seed" task={null} />);

    expect(screen.getByText("🌱")).toBeInTheDocument();
    expect(screen.getByText("タネにしたよ")).toBeInTheDocument();
    expect(screen.queryByText(/タネにしたよ：/)).not.toBeInTheDocument();
  });

  test("mood なら「💭 きもち、きいたよ」を表示する", () => {
    render(<ClassificationChip category="mood" task={null} />);

    expect(screen.getByText("💭")).toBeInTheDocument();
    expect(screen.getByText("きもち、きいたよ")).toBeInTheDocument();
  });

  test("絵文字は装飾として aria-hidden になり、隣接する意味テキストには付かない（読み上げツリーに絵文字が出ず、意味は読める）", () => {
    render(<ClassificationChip category="seed" task="部屋を片付ける" />);

    expect(screen.getByText("🌱")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("タネにしたよ：『部屋を片付ける』")).not.toHaveAttribute("aria-hidden");
  });
});
