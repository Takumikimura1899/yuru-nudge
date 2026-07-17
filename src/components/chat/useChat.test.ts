// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { FALLBACK_REPLY } from "../../server/ai/constants";
import type { ChatMessageData } from "./useChat";

const resolveNudgeMock = vi.fn();
const postReactionMock = vi.fn();
const postDiscardMock = vi.fn();
vi.mock("../../server/nudges", () => ({
  resolveNudge: (...args: unknown[]) => resolveNudgeMock(...args),
  postReaction: (...args: unknown[]) => postReactionMock(...args),
  postDiscard: (...args: unknown[]) => postDiscardMock(...args),
}));

const postMutterMock = vi.fn();
vi.mock("../../server/mutterings", () => ({
  postMutter: (...args: unknown[]) => postMutterMock(...args),
}));

const updateIntensityMock = vi.fn();
vi.mock("../../server/profile", () => ({
  updateIntensity: (...args: unknown[]) => updateIntensityMock(...args),
}));

const { useChat } = await import("./useChat");

// useChat.ts のプライベート定数と同じ文言（棚卸し全行処理後の締めメッセージ）
const HOUSEKEEPING_DONE_REPLY = "じゃあ今回はここまでにするね〜。また気になったら教えてね";

type NudgeMessage = Extract<ChatMessageData, { kind: "nudge" }>;
type HousekeepingMessage = Extract<ChatMessageData, { kind: "housekeeping" }>;

const createNudgeMessage = (overrides: Partial<NudgeMessage> = {}): ChatMessageData => ({
  kind: "nudge",
  id: "seed-1",
  seedId: "seed-1",
  prophecy: "片付いた部屋、気持ちいいかも",
  status: "idle",
  ...overrides,
});

const createHousekeepingMessage = (items: HousekeepingMessage["items"]): ChatMessageData => ({
  kind: "housekeeping",
  id: "hk-1",
  items,
});

beforeEach(() => {
  resolveNudgeMock.mockReset().mockResolvedValue({ kind: "none" });
  postReactionMock.mockReset();
  postDiscardMock.mockReset();
  postMutterMock.mockReset();
  updateIntensityMock.mockReset();
});

describe("起動時の resolveNudge", () => {
  test("kind:nudge ならナッジカードを末尾に追加する", async () => {
    resolveNudgeMock.mockResolvedValue({
      kind: "nudge",
      seed: { seedId: "seed-1", task: "部屋を片付ける", prophecy: "片付いた部屋、気持ちいいかも" },
    });

    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await waitFor(() => {
      expect(result.current.messages).toEqual([
        {
          kind: "nudge",
          id: "seed-1",
          seedId: "seed-1",
          prophecy: "片付いた部屋、気持ちいいかも",
          status: "idle",
        },
      ]);
    });
  });

  test("kind:housekeeping なら棚卸しカードを末尾に追加する", async () => {
    resolveNudgeMock.mockResolvedValue({
      kind: "housekeeping",
      items: [{ seedId: "seed-1", task: "部屋を片付ける" }],
    });

    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]).toMatchObject({
      kind: "housekeeping",
      items: [{ seedId: "seed-1", task: "部屋を片付ける", status: "idle" }],
    });
  });

  test("kind:none なら何も追加しない", async () => {
    resolveNudgeMock.mockResolvedValue({ kind: "none" });

    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await waitFor(() => {
      expect(resolveNudgeMock).toHaveBeenCalledTimes(1);
    });
    expect(result.current.messages).toEqual([]);
  });

  test("kind:review なら通常のナッジーテキストバブルとして末尾に追加する", async () => {
    resolveNudgeMock.mockResolvedValue({ kind: "review", reply: "先月の予言、2つ叶ったねぇ" });

    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]).toMatchObject({
      kind: "text",
      role: "nudgey",
      text: "先月の予言、2つ叶ったねぇ",
    });
  });
});

describe("send（つぶやき送信）", () => {
  test("postMutter が in-flight の間に別のバブルが追加されても、失敗時の巻き戻しは楽観表示した本人のバブルだけを消す", async () => {
    let resolvePostMutter!: (value: { ok: false; reply: string }) => void;
    postMutterMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePostMutter = resolve;
        }),
    );
    postReactionMock.mockResolvedValue({ ok: true, reply: "いいね、お疲れさま" });

    const { result } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    // send() を開始（postMutter は未解決のまま in-flight）。楽観的ユーザーバブルが末尾に積まれる
    let sendPromise: Promise<boolean> | undefined;
    act(() => {
      sendPromise = result.current.send("洗濯する");
    });

    // in-flight 中に別の非同期処理（react）がバブルを2件末尾に追加する
    await act(async () => {
      await result.current.react("seed-1", "completed");
    });

    // postMutter が失敗で解決 → 巻き戻しが走る
    await act(async () => {
      resolvePostMutter({ ok: false, reply: "今日はちょっとぼんやりしてるみたい" });
      await sendPromise;
    });

    const messages = result.current.messages;
    // 楽観表示していた「洗濯する」ユーザーバブルだけが消える（末尾要素ではなく id で除去）
    expect(messages.some((m) => m.kind === "text" && m.text === "洗濯する")).toBe(false);
    // in-flight 中に追加された react() 側のバブルは誤って消されず残る
    expect(messages.find((m) => m.kind === "text" && m.text === "やったよ")).toBeTruthy();
    expect(messages.find((m) => m.kind === "text" && m.text === "いいね、お疲れさま")).toBeTruthy();
    // postMutter 失敗のキャラ内エラー応答が追加される
    expect(
      messages.find((m) => m.kind === "text" && m.text === "今日はちょっとぼんやりしてるみたい"),
    ).toBeTruthy();
  });
});

describe("react（ナッジへの反応）", () => {
  test("成功（alreadyReactedでない）: status:resolved になり、ナッジーの応答バブルが追加される", async () => {
    postReactionMock.mockResolvedValue({ ok: true, reply: "いいね、お疲れさま" });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.react("seed-1", "completed");
    });

    const messages = result.current.messages;
    expect(messages.find((m) => m.kind === "nudge")).toMatchObject({ status: "resolved" });
    expect(messages.find((m) => m.kind === "text" && m.role === "user")).toMatchObject({
      text: "やったよ",
    });
    expect(messages.find((m) => m.kind === "text" && m.role === "nudgey")).toMatchObject({
      text: "いいね、お疲れさま",
    });
  });

  test("alreadyReacted: status:resolved になるが応答バブルは追加しない", async () => {
    postReactionMock.mockResolvedValue({ ok: true, alreadyReacted: true, reply: "" });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.react("seed-1", "completed");
    });

    const messages = result.current.messages;
    expect(messages.find((m) => m.kind === "nudge")).toMatchObject({ status: "resolved" });
    expect(messages.filter((m) => m.kind === "text" && m.role === "nudgey")).toHaveLength(0);
  });

  test("失敗（ok:false）: 楽観バブルを取り消し、status を idle に戻し、エラー応答を追加する", async () => {
    postReactionMock.mockResolvedValue({ ok: false, reply: "今日はちょっと…" });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.react("seed-1", "completed");
    });

    const messages = result.current.messages;
    expect(messages.find((m) => m.kind === "nudge")).toMatchObject({ status: "idle" });
    expect(messages.filter((m) => m.kind === "text" && m.role === "user")).toHaveLength(0);
    expect(messages.find((m) => m.kind === "text" && m.role === "nudgey")).toMatchObject({
      text: "今日はちょっと…",
    });
  });

  test("通信失敗（throw）: FALLBACK_REPLY で巻き戻す", async () => {
    postReactionMock.mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.react("seed-1", "completed");
    });

    const messages = result.current.messages;
    expect(messages.find((m) => m.kind === "nudge")).toMatchObject({ status: "idle" });
    expect(messages.find((m) => m.kind === "text" && m.role === "nudgey")).toMatchObject({
      text: FALLBACK_REPLY,
    });
  });
});

describe("棚卸し（keep / discard）", () => {
  test("keep はサーバー呼び出しをせず、該当行をクライアント側だけで消す", () => {
    const items: HousekeepingMessage["items"] = [
      { seedId: "seed-1", task: "部屋を片付ける", status: "idle" },
      { seedId: "seed-2", task: "本を読む", status: "idle" },
    ];
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createHousekeepingMessage(items)], initialIntensity: "chill" }),
    );

    act(() => {
      result.current.keep("seed-1");
    });

    expect(postDiscardMock).not.toHaveBeenCalled();
    const housekeeping = result.current.messages.find((m) => m.kind === "housekeeping");
    expect(housekeeping).toMatchObject({ items: [{ seedId: "seed-2" }] });
  });

  test("discard 成功で該当行を消し、最後の1件なら締めのメッセージに置き換える", async () => {
    postDiscardMock.mockResolvedValue({ ok: true });
    const items: HousekeepingMessage["items"] = [
      { seedId: "seed-1", task: "部屋を片付ける", status: "idle" },
    ];
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createHousekeepingMessage(items)], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.discard("seed-1");
    });

    expect(postDiscardMock).toHaveBeenCalledWith({ data: { seedId: "seed-1" } });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      kind: "text",
      role: "nudgey",
      text: HOUSEKEEPING_DONE_REPLY,
    });
  });

  test("discard が通信例外で失敗したら該当行の status を idle に戻す", async () => {
    postDiscardMock.mockRejectedValue(new Error("network error"));
    const items: HousekeepingMessage["items"] = [
      { seedId: "seed-1", task: "部屋を片付ける", status: "idle" },
    ];
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createHousekeepingMessage(items)], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.discard("seed-1");
    });

    const housekeeping = result.current.messages.find((m) => m.kind === "housekeeping");
    expect(housekeeping).toMatchObject({ items: [{ seedId: "seed-1", status: "idle" }] });
  });

  test("discard が ok:false（競合で対象が既に pending でない）を返したら行を消さず status を idle に戻す", async () => {
    postDiscardMock.mockResolvedValue({ ok: false });
    const items: HousekeepingMessage["items"] = [
      { seedId: "seed-1", task: "部屋を片付ける", status: "idle" },
    ];
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createHousekeepingMessage(items)], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.discard("seed-1");
    });

    const housekeeping = result.current.messages.find((m) => m.kind === "housekeeping");
    expect(housekeeping).toMatchObject({ items: [{ seedId: "seed-1", status: "idle" }] });
  });
});
