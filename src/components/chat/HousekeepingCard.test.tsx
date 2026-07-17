// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import HousekeepingCard from "./HousekeepingCard";
import type { HousekeepingRow } from "./useChat";

const createMockItem = (overrides: Partial<HousekeepingRow> = {}): HousekeepingRow => ({
  seedId: "seed-1",
  task: "部屋を片付ける",
  status: "idle",
  ...overrides,
});

const createDefaultProps = (overrides: Partial<{ items: HousekeepingRow[] }> = {}) => ({
  items: [createMockItem()],
  onKeep: vi.fn(),
  onDiscard: vi.fn(),
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("HousekeepingCard", () => {
  test("各アイテムのタスク文言を一覧表示する", () => {
    const items = [
      createMockItem({ seedId: "seed-1", task: "部屋を片付ける" }),
      createMockItem({ seedId: "seed-2", task: "本を読む" }),
    ];
    render(<HousekeepingCard {...createDefaultProps({ items })} />);

    expect(screen.getByText("部屋を片付ける")).toBeInTheDocument();
    expect(screen.getByText("本を読む")).toBeInTheDocument();
  });

  test("「気になってる」クリックで onKeep(seedId) が呼ばれる", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps({ items: [createMockItem({ seedId: "seed-1" })] });
    render(<HousekeepingCard {...props} />);

    await user.click(screen.getByRole("button", { name: "気になってる" }));

    expect(props.onKeep).toHaveBeenCalledTimes(1);
    expect(props.onKeep).toHaveBeenCalledWith("seed-1");
    expect(props.onDiscard).not.toHaveBeenCalled();
  });

  test("「もういいや」クリックで onDiscard(seedId) が呼ばれる", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps({ items: [createMockItem({ seedId: "seed-1" })] });
    render(<HousekeepingCard {...props} />);

    await user.click(screen.getByRole("button", { name: "もういいや" }));

    expect(props.onDiscard).toHaveBeenCalledTimes(1);
    expect(props.onDiscard).toHaveBeenCalledWith("seed-1");
    expect(props.onKeep).not.toHaveBeenCalled();
  });

  test("discarding 中の行は該当行のボタンのみ disabled になり、他の行は操作できる", () => {
    const items = [
      createMockItem({ seedId: "seed-1", task: "部屋を片付ける", status: "discarding" }),
      createMockItem({ seedId: "seed-2", task: "本を読む", status: "idle" }),
    ];
    render(<HousekeepingCard {...createDefaultProps({ items })} />);

    const row1 = screen.getByText("部屋を片付ける").closest("li");
    const row2 = screen.getByText("本を読む").closest("li");
    if (!row1 || !row2) throw new Error("row not found");

    expect(within(row1).getByRole("button", { name: "気になってる" })).toBeDisabled();
    expect(within(row1).getByRole("button", { name: "もういいや" })).toBeDisabled();
    expect(within(row2).getByRole("button", { name: "気になってる" })).toBeEnabled();
    expect(within(row2).getByRole("button", { name: "もういいや" })).toBeEnabled();
  });
});
