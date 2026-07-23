// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { PouchSeed } from "../../server/nudges";

const getSeedPouchMock = vi.fn();
vi.mock("../../server/nudges", () => ({
  getSeedPouch: (...args: unknown[]) => getSeedPouchMock(...args),
}));

// SeedPouch は手動ナッジの橋渡しに useNavigate を使う。テストは Router ツリー外で render するため
// フックだけ差し替える（遷移の中身は navigateMock の引数で検証する）
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

const { default: SeedPouch } = await import("./SeedPouch");

const createPouchSeed = (overrides: Partial<PouchSeed> = {}): PouchSeed => ({
  seedId: "seed-1",
  task: "部屋を片付ける",
  status: "pending",
  ...overrides,
});

const ERROR_COPY = "うーん、タネ袋がうまく開けなかった…もう一回ひらいてみて";

/** getSeedPouch の解決タイミングを手動制御するための deferred */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getSeedPouchMock.mockReset();
  getSeedPouchMock.mockResolvedValue([]);
  navigateMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("SeedPouch", () => {
  test("マウント時に fetch し、トリガーのバッジ件数に反映する", async () => {
    getSeedPouchMock.mockResolvedValue([createPouchSeed(), createPouchSeed({ seedId: "seed-2" })]);

    render(<SeedPouch />);

    expect(await screen.findByText("タネ袋（2）")).toBeInTheDocument();
    expect(getSeedPouchMock).toHaveBeenCalledTimes(1);
  });

  test("トリガー押下でシートが開き、再度 fetch が走る", async () => {
    const user = userEvent.setup();
    render(<SeedPouch />);
    const trigger = await screen.findByRole("button", { name: /タネ袋を開く/ });
    getSeedPouchMock.mockClear();

    await user.click(trigger);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(getSeedPouchMock).toHaveBeenCalledTimes(1);
  });

  test("開くとシート内（✕ボタン）へフォーカスが移り、Escで閉じるとトリガーへ復帰する", async () => {
    const user = userEvent.setup();
    render(<SeedPouch />);
    const trigger = await screen.findByRole("button", { name: /タネ袋を開く/ });

    await user.click(trigger);
    const closeButton = await screen.findByRole("button", { name: "閉じる" });
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Escape}");

    // AnimatePresence の exit アニメーション（spring）が完了して DOM から外れるまで待つ
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  test("✕ボタンで閉じる", async () => {
    const user = userEvent.setup();
    render(<SeedPouch />);
    const trigger = await screen.findByRole("button", { name: /タネ袋を開く/ });
    await user.click(trigger);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "閉じる" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("オーバーレイクリックで閉じる", async () => {
    const user = userEvent.setup();
    render(<SeedPouch />);
    const trigger = await screen.findByRole("button", { name: /タネ袋を開く/ });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    // オーバーレイは背景の暗幕で、装飾要素(aria-hidden)のため role/label でのクエリ手段を持たない。
    // ダイアログの直前の兄弟要素として描画される（背景幕→パネルの並び）という構造を頼りに取得する
    const overlay = dialog.previousElementSibling;
    if (!(overlay instanceof HTMLElement)) throw new Error("overlay not found");

    await user.click(overlay);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("『なにか提案して』でシートが閉じ、/?nudge=manual へ navigate する（手動ナッジの橋渡し）", async () => {
    const user = userEvent.setup();
    getSeedPouchMock.mockResolvedValue([createPouchSeed()]);
    render(<SeedPouch />);
    const trigger = await screen.findByRole("button", { name: /タネ袋を開く/ });
    await user.click(trigger);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: "なにか提案して" }));

    expect(navigateMock).toHaveBeenCalledWith({ to: "/", search: { nudge: "manual" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  test("fetch 失敗時: バッジは直前の件数を維持し、シートはエラー表示になる", async () => {
    const user = userEvent.setup();
    getSeedPouchMock.mockResolvedValueOnce([
      createPouchSeed(),
      createPouchSeed({ seedId: "seed-2" }),
    ]);
    render(<SeedPouch />);
    await screen.findByText("タネ袋（2）");

    getSeedPouchMock.mockRejectedValueOnce(new Error("network error"));
    const trigger = screen.getByRole("button", { name: /タネ袋を開く/ });
    await user.click(trigger);

    expect(await screen.findByText(ERROR_COPY)).toBeInTheDocument();
    expect(screen.getByText("タネ袋（2）")).toBeInTheDocument();
  });

  describe("退場アニメーション中（AnimatePresence がまだマウントを維持している間）", () => {
    test("閉じた直後も Tab キーのシート内トラップが効いたまま（背景へフォーカスが漏れない）", async () => {
      const user = userEvent.setup();
      render(<SeedPouch />);
      const trigger = await screen.findByRole("button", { name: /タネ袋を開く/ });

      await user.click(trigger);
      const closeButton = await screen.findByRole("button", { name: "閉じる" });
      expect(closeButton).toHaveFocus();

      // fireEvent で同期的に閉じる（userEvent は内部で待機を挟むため、退場アニメーションが
      // 先に終わってしまい「まだ残っている」瞬間を捉えられないことがある）
      fireEvent.click(closeButton);
      expect(screen.getByRole("dialog")).toBeInTheDocument(); // まだ退場アニメーション中

      // Tab キーのデフォルト（次要素へのフォーカス移動）は jsdom 自身は実装せず userEvent が
      // 模倣する機能のため、ここでは「トラップの keydown ハンドラがまだ有効か」を
      // 同期的な素の KeyboardEvent で直接確認する（preventDefault されていればハンドラが生きている）
      const tabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(tabEvent);

      expect(tabEvent.defaultPrevented).toBe(true);
      expect(closeButton).toHaveFocus(); // シート内（自分自身）に留まる
    });

    test("閉じた直後も body スクロールロックを維持し、完全に消えたあとに復元する", async () => {
      const user = userEvent.setup();
      const originalOverflow = document.body.style.overflow;
      render(<SeedPouch />);
      const trigger = await screen.findByRole("button", { name: /タネ袋を開く/ });

      await user.click(trigger);
      const closeButton = await screen.findByRole("button", { name: "閉じる" });
      expect(document.body.style.overflow).toBe("hidden");

      // fireEvent で同期的に閉じ、退場アニメーション中の瞬間を確実に捉える
      fireEvent.click(closeButton);

      // まだ退場アニメーション中: ダイアログは残っており、ロックも維持されたまま
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(document.body.style.overflow).toBe("hidden");

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(document.body.style.overflow).toBe(originalOverflow);
    });
  });

  test("fetchPouch の競合ガード: 新しい方が先に成功した後に古い方が失敗しても状態を上書きしない", async () => {
    const user = userEvent.setup();
    const mountFetch = createDeferred<PouchSeed[]>();
    const openFetch = createDeferred<PouchSeed[]>();
    getSeedPouchMock.mockReset();
    getSeedPouchMock.mockImplementationOnce(() => mountFetch.promise); // マウント時 fetch（1回目）
    getSeedPouchMock.mockImplementationOnce(() => openFetch.promise); // オープン時 fetch（2回目）

    render(<SeedPouch />); // 1回目の fetch が in-flight のまま止まる
    const trigger = await screen.findByRole("button", { name: /タネ袋を開く/ });
    await user.click(trigger); // 2回目の fetch を発火（1回目はまだ pending）
    await screen.findByRole("dialog");

    // 新しい方（2回目）が先に成功
    await act(async () => {
      openFetch.resolve([createPouchSeed({ seedId: "seed-2", task: "本を読む" })]);
      await openFetch.promise;
    });
    expect(screen.getByText("本を読む")).toBeInTheDocument();

    // 古い方（1回目）が後から失敗しても、新しい方の ready 状態を上書きしない
    await act(async () => {
      mountFetch.reject(new Error("stale failure"));
      await mountFetch.promise.catch(() => {});
    });

    expect(screen.queryByText(ERROR_COPY)).not.toBeInTheDocument();
    expect(screen.getByText("本を読む")).toBeInTheDocument();
  });
});
