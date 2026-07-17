// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import NudgeCard from "./NudgeCard";
import type { NudgeStatus } from "./useChat";

const createDefaultProps = (overrides: Partial<{ status: NudgeStatus }> = {}) => ({
  prophecy: "片付いた部屋、気持ちいいかも",
  status: "idle" as NudgeStatus,
  onReact: vi.fn(),
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("NudgeCard", () => {
  test("prophecy（未来予言）を表示する", () => {
    render(<NudgeCard {...createDefaultProps()} />);

    expect(screen.getByText("片付いた部屋、気持ちいいかも")).toBeInTheDocument();
  });

  test("3つの反応ボタンを表示する", () => {
    render(<NudgeCard {...createDefaultProps()} />);

    expect(screen.getByRole("button", { name: "やったよ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "難しい" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "いらない" })).toBeInTheDocument();
  });

  test.each([
    { label: "やったよ", reaction: "completed" },
    { label: "難しい", reaction: "softened" },
    { label: "いらない", reaction: "archived" },
  ])("「$label」をクリックすると onReact($reaction) が呼ばれる", async ({ label, reaction }) => {
    const user = userEvent.setup();
    const props = createDefaultProps();
    render(<NudgeCard {...props} />);

    await user.click(screen.getByRole("button", { name: label }));

    expect(props.onReact).toHaveBeenCalledTimes(1);
    expect(props.onReact).toHaveBeenCalledWith(reaction);
  });

  test.each(["sending", "resolved"] as NudgeStatus[])(
    "status=%s のときは全ボタンが disabled になる",
    (status) => {
      render(<NudgeCard {...createDefaultProps({ status })} />);

      expect(screen.getByRole("button", { name: "やったよ" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "難しい" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "いらない" })).toBeDisabled();
    },
  );

  test("status=idle のときはボタンが有効", () => {
    render(<NudgeCard {...createDefaultProps({ status: "idle" })} />);

    expect(screen.getByRole("button", { name: "やったよ" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "難しい" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "いらない" })).toBeEnabled();
  });
});
