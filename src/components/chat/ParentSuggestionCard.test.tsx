// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import ParentSuggestionCard from "./ParentSuggestionCard";
import type { NudgeStatus } from "./useChat";

const createDefaultProps = (overrides: Partial<{ status: NudgeStatus }> = {}) => ({
  parentTask: "部屋を片付ける",
  status: "idle" as NudgeStatus,
  mood: "chill" as const,
  onRevive: vi.fn(),
  onDecline: vi.fn(),
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("ParentSuggestionCard", () => {
  test("親タスク名を含む再提案文言を表示する", () => {
    render(<ParentSuggestionCard {...createDefaultProps()} />);

    expect(screen.getByText("元の「部屋を片付ける」もやってみる？")).toBeInTheDocument();
  });

  test("2つのボタンを表示する", () => {
    render(<ParentSuggestionCard {...createDefaultProps()} />);

    expect(screen.getByRole("button", { name: "やってみる" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "今はいいや" })).toBeInTheDocument();
  });

  test("「やってみる」をクリックすると onRevive が呼ばれる", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    render(<ParentSuggestionCard {...props} />);

    await user.click(screen.getByRole("button", { name: "やってみる" }));

    expect(props.onRevive).toHaveBeenCalledTimes(1);
    expect(props.onDecline).not.toHaveBeenCalled();
  });

  test("「今はいいや」をクリックすると onDecline が呼ばれる", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    render(<ParentSuggestionCard {...props} />);

    await user.click(screen.getByRole("button", { name: "今はいいや" }));

    expect(props.onDecline).toHaveBeenCalledTimes(1);
    expect(props.onRevive).not.toHaveBeenCalled();
  });

  test.each(["sending", "resolved"] as NudgeStatus[])(
    "status=%s のときは全ボタンが disabled になる",
    (status) => {
      render(<ParentSuggestionCard {...createDefaultProps({ status })} />);

      expect(screen.getByRole("button", { name: "やってみる" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "今はいいや" })).toBeDisabled();
    },
  );

  test("status=idle のときはボタンが有効", () => {
    render(<ParentSuggestionCard {...createDefaultProps({ status: "idle" })} />);

    expect(screen.getByRole("button", { name: "やってみる" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "今はいいや" })).toBeEnabled();
  });
});
