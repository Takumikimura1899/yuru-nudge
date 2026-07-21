// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vite-plus/test";
import ChatMessage from "./ChatMessage";

afterEach(() => {
  cleanup();
});

describe("ChatMessage", () => {
  test("ナッジーメッセージに chip prop があれば、本文の下にチップを描画する", () => {
    render(
      <ChatMessage
        role="nudgey"
        text="部屋を片付けたいんだねぇ。覚えておくよ"
        mood="chill"
        chip={{ category: "seed", task: "部屋を片付ける" }}
      />,
    );

    expect(screen.getByText("部屋を片付けたいんだねぇ。覚えておくよ")).toBeInTheDocument();
    expect(screen.getByText("タネにしたよ：『部屋を片付ける』")).toBeInTheDocument();
  });

  test("ナッジーメッセージに chip prop がなければ、チップを描画しない", () => {
    render(<ChatMessage role="nudgey" text="そっかぁ、疲れてるんだねぇ" mood="chill" />);

    expect(screen.getByText("そっかぁ、疲れてるんだねぇ")).toBeInTheDocument();
    expect(screen.queryByText(/タネにしたよ|きもち、きいたよ/)).not.toBeInTheDocument();
  });

  test("ユーザー側メッセージは chip を渡していても表示せず、吹き出しのみ描画する（従来どおりのマークアップ）", () => {
    render(
      <ChatMessage
        role="user"
        text="部屋を片付けたい"
        mood="chill"
        chip={{ category: "seed", task: "部屋を片付ける" }}
      />,
    );

    expect(screen.getByText("部屋を片付けたい")).toBeInTheDocument();
    expect(screen.queryByText(/タネにしたよ|きもち、きいたよ/)).not.toBeInTheDocument();
  });
});
