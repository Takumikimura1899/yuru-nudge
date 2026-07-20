// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import SeedPouchSheet from "./SeedPouchSheet";
import type { PouchSeed } from "../../server/nudges";

const createPouchSeed = (overrides: Partial<PouchSeed> = {}): PouchSeed => ({
  seedId: "seed-1",
  task: "部屋を片付ける",
  status: "pending",
  ...overrides,
});

const createDefaultProps = (
  overrides: Partial<{ seeds: PouchSeed[] | null; status: "loading" | "error" | "ready" }> = {},
) => ({
  seeds: [] as PouchSeed[] | null,
  status: "ready" as const,
  onClose: vi.fn(),
  onRetry: vi.fn(),
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("SeedPouchSheet", () => {
  test("ready+seeds: 各タネのタスク名を一覧表示し、nudged行にのみ『提案中』ピルを付ける", () => {
    const seeds = [
      createPouchSeed({ seedId: "seed-1", task: "部屋を片付ける", status: "nudged" }),
      createPouchSeed({ seedId: "seed-2", task: "本を読む", status: "pending" }),
    ];
    render(<SeedPouchSheet {...createDefaultProps({ seeds })} />);

    const nudgedRow = screen.getByText("部屋を片付ける").closest("li");
    const pendingRow = screen.getByText("本を読む").closest("li");
    if (!nudgedRow || !pendingRow) throw new Error("row not found");

    expect(within(nudgedRow).getByText("提案中")).toBeInTheDocument();
    expect(within(pendingRow).queryByText("提案中")).not.toBeInTheDocument();
  });

  test("ready+0件: 空状態文言を表示する", () => {
    render(<SeedPouchSheet {...createDefaultProps({ seeds: [] })} />);

    expect(
      screen.getByText("タネ袋はまだからっぽ。つぶやくとナッジーがタネにして貯めていくよ"),
    ).toBeInTheDocument();
  });

  test("error: エラー文言と『もういちど』ボタンを表示し、クリックで onRetry が呼ばれる", async () => {
    const user = userEvent.setup();
    const props = createDefaultProps({ status: "error", seeds: null });
    render(<SeedPouchSheet {...props} />);

    expect(
      screen.getByText("うーん、タネ袋がうまく開けなかった…もう一回ひらいてみて"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "もういちど" }));

    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  test("role=dialog / aria-modal=true / aria-labelledby が見出し要素を指す", () => {
    render(<SeedPouchSheet {...createDefaultProps()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");

    const headingId = dialog.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    const heading = screen.getByRole("heading");
    expect(heading).toHaveAttribute("id", headingId);
  });

  test("✕ の装飾絵文字 span は aria-hidden で読み上げツリーから除外される", () => {
    render(<SeedPouchSheet {...createDefaultProps()} />);

    const closeGlyph = screen.getByText("✕");
    expect(closeGlyph).toHaveAttribute("aria-hidden", "true");
    // aria-hidden の子ではなく aria-label 側で名前解決される（読み上げ内容が絵文字にすり替わらない）
    expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument();
  });
});
