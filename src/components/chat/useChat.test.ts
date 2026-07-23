// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { FALLBACK_REPLY, MANUAL_NUDGE_EMPTY_REPLY } from "../../server/ai/constants";
import type { ChatMessageData } from "./useChat";

const resolveNudgeMock = vi.fn();
const requestNudgeMock = vi.fn();
const postReactionMock = vi.fn();
const postDiscardMock = vi.fn();
const postReviveParentMock = vi.fn();
vi.mock("../../server/nudges", () => ({
  resolveNudge: (...args: unknown[]) => resolveNudgeMock(...args),
  requestNudge: (...args: unknown[]) => requestNudgeMock(...args),
  postReaction: (...args: unknown[]) => postReactionMock(...args),
  postDiscard: (...args: unknown[]) => postDiscardMock(...args),
  postReviveParent: (...args: unknown[]) => postReviveParentMock(...args),
}));

const postMutterMock = vi.fn();
vi.mock("../../server/mutterings", () => ({
  postMutter: (...args: unknown[]) => postMutterMock(...args),
}));

const updateIntensityMock = vi.fn();
vi.mock("../../server/profile", () => ({
  updateIntensity: (...args: unknown[]) => updateIntensityMock(...args),
}));

const { useChat, buildChip, toMessages } = await import("./useChat");

// useChat.ts のプライベート定数と同じ文言（棚卸し全行処理後の締めメッセージ）
const HOUSEKEEPING_DONE_REPLY = "じゃあ今回はここまでにするね〜。また気になったら教えてね";

type NudgeMessage = Extract<ChatMessageData, { kind: "nudge" }>;
type HousekeepingMessage = Extract<ChatMessageData, { kind: "housekeeping" }>;
type ParentSuggestionMessage = Extract<ChatMessageData, { kind: "parentSuggestion" }>;

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

const createParentSuggestionMessage = (
  overrides: Partial<ParentSuggestionMessage> = {},
): ChatMessageData => ({
  kind: "parentSuggestion",
  id: "card-1",
  parentSeedId: "parent-1",
  parentTask: "部屋を片付ける",
  status: "idle",
  ...overrides,
});

beforeEach(() => {
  resolveNudgeMock.mockReset().mockResolvedValue({ kind: "none" });
  requestNudgeMock.mockReset().mockResolvedValue({ kind: "none" });
  postReactionMock.mockReset();
  postDiscardMock.mockReset();
  postReviveParentMock.mockReset();
  postMutterMock.mockReset();
  updateIntensityMock.mockReset();
});

describe("buildChip（つぶやき分類チップの組み立て）", () => {
  test("seed かつ task ありなら category:seed で task をそのまま渡す", () => {
    expect(buildChip("seed", "部屋を片付ける")).toEqual({
      category: "seed",
      task: "部屋を片付ける",
    });
  });

  test("seed かつ task が null なら category:seed, task:null になる（LLM スキーマ逸脱の稀ケース）", () => {
    expect(buildChip("seed", null)).toEqual({ category: "seed", task: null });
  });

  test("mood なら task の値によらず category:mood, task:null になる", () => {
    expect(buildChip("mood", "本来 mood では入らない値")).toEqual({
      category: "mood",
      task: null,
    });
    expect(buildChip("mood", null)).toEqual({ category: "mood", task: null });
  });

  test("seed/mood 以外の想定外カテゴリは undefined を返す（チップ非表示）", () => {
    expect(buildChip("unknown", null)).toBeUndefined();
    expect(buildChip("", "何か")).toBeUndefined();
  });
});

describe("toMessages（タイムライン行 → チャットメッセージへの変換）", () => {
  test("reply ありの行は、ユーザーバブルとナッジーバブル(chip付き)の2件に展開する", () => {
    const rows = [
      {
        id: "m-1",
        content: "部屋を片付けたい",
        reply: "部屋を片付けたいんだねぇ。覚えておくよ",
        category: "seed",
        processed_task: "部屋を片付ける",
      },
    ];

    expect(toMessages(rows)).toEqual([
      { kind: "text", id: "m-1-user", role: "user", text: "部屋を片付けたい" },
      {
        kind: "text",
        id: "m-1",
        role: "nudgey",
        text: "部屋を片付けたいんだねぇ。覚えておくよ",
        chip: { category: "seed", task: "部屋を片付ける" },
      },
    ]);
  });

  test("reply が null の行は、ナッジーバブル自体を生成せずユーザーバブルのみになる", () => {
    const rows = [
      { id: "m-2", content: "独り言", reply: null, category: "mood", processed_task: null },
    ];

    expect(toMessages(rows)).toEqual([
      { kind: "text", id: "m-2-user", role: "user", text: "独り言" },
    ]);
  });

  test("複数行は古い順のまま平坦化される", () => {
    const rows = [
      { id: "m-1", content: "A", reply: "返答A", category: "mood", processed_task: null },
      { id: "m-2", content: "B", reply: null, category: "seed", processed_task: "タスクB" },
    ];

    expect(toMessages(rows).map((m) => m.id)).toEqual(["m-1-user", "m-1", "m-2-user"]);
  });
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
          // カード id は都度採番（seedId ではない）。手動ナッジの再表示で同一 seed のカードが
          // 複数回 append されても key が衝突しないようにするため
          id: expect.any(String),
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

  test("失敗（例外）: console.error でログしつつ、ナッジーのキャラ内エラーバブルを末尾に追加する", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    resolveNudgeMock.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]).toMatchObject({
      kind: "text",
      role: "nudgey",
      text: FALLBACK_REPLY,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith("resolveNudge failed", expect.any(Error));

    consoleErrorSpy.mockRestore();
  });
});

describe("send（つぶやき送信）", () => {
  test("成功（ok:true, seed分類）: ナッジーの応答バブルに category/processedTask から組み立てた chip が付き、true を返す", async () => {
    postMutterMock.mockResolvedValue({
      ok: true,
      muttering: {
        id: "m-1",
        category: "seed",
        reply: "部屋を片付けたいんだねぇ。覚えておくよ",
      },
      processedTask: "部屋を片付ける",
    });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    let sendResult: boolean | undefined;
    await act(async () => {
      sendResult = await result.current.send("部屋を片付けたい");
    });

    expect(sendResult).toBe(true);
    const messages = result.current.messages;
    expect(messages.find((m) => m.kind === "text" && m.role === "user")).toMatchObject({
      text: "部屋を片付けたい",
    });
    expect(messages.find((m) => m.kind === "text" && m.role === "nudgey")).toMatchObject({
      text: "部屋を片付けたいんだねぇ。覚えておくよ",
      chip: { category: "seed", task: "部屋を片付ける" },
    });
  });

  test("成功（ok:true, mood分類）: chip は category:mood, task:null になる", async () => {
    postMutterMock.mockResolvedValue({
      ok: true,
      muttering: { id: "m-2", category: "mood", reply: "そっかぁ、疲れてるんだねぇ" },
      processedTask: null,
    });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.send("今日は疲れた");
    });

    expect(
      result.current.messages.find((m) => m.kind === "text" && m.role === "nudgey"),
    ).toMatchObject({
      text: "そっかぁ、疲れてるんだねぇ",
      chip: { category: "mood", task: null },
    });
  });

  test("失敗（ok:false）: チップは付与されず、キャラ内エラー応答のみが残る（既存挙動）", async () => {
    postMutterMock.mockResolvedValue({
      ok: false,
      reply: "今日はちょっとぼんやりしてるみたい",
    });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    let sendResult: boolean | undefined;
    await act(async () => {
      sendResult = await result.current.send("部屋を片付けたい");
    });

    expect(sendResult).toBe(false);
    const messages = result.current.messages;
    expect(messages.some((m) => m.kind === "text" && m.role === "user")).toBe(false);
    const nudgeyMessage = messages.find((m) => m.kind === "text" && m.role === "nudgey");
    expect(nudgeyMessage).toMatchObject({ text: "今日はちょっとぼんやりしてるみたい" });
    expect(nudgeyMessage).not.toHaveProperty("chip");
  });

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

describe("初回提案（send 成功時の firstSeed トリガー）", () => {
  test("seed 分類の send 成功後に requestNudge(firstSeed) を投げ、kind:nudge ならナッジカードを追加する", async () => {
    postMutterMock.mockResolvedValue({
      ok: true,
      muttering: { id: "m-1", category: "seed", reply: "覚えておくよ" },
      processedTask: "部屋を片付ける",
    });
    requestNudgeMock.mockResolvedValue({
      kind: "nudge",
      seed: { seedId: "seed-1", task: "部屋を片付ける", prophecy: "片付いた部屋、気持ちいいかも" },
    });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.send("部屋を片付けたい");
    });

    expect(requestNudgeMock).toHaveBeenCalledWith({ data: { trigger: "firstSeed" } });
    await waitFor(() => {
      expect(result.current.messages.find((m) => m.kind === "nudge")).toMatchObject({
        seedId: "seed-1",
        prophecy: "片付いた部屋、気持ちいいかも",
        status: "idle",
      });
    });
  });

  test("kind:none（ナッジ経験済み等）なら何も追加しない", async () => {
    postMutterMock.mockResolvedValue({
      ok: true,
      muttering: { id: "m-1", category: "seed", reply: "覚えておくよ" },
      processedTask: "部屋を片付ける",
    });
    requestNudgeMock.mockResolvedValue({ kind: "none" });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.send("部屋を片付けたい");
    });

    expect(requestNudgeMock).toHaveBeenCalledTimes(1);
    expect(result.current.messages.some((m) => m.kind === "nudge")).toBe(false);
  });

  test("mood 分類では requestNudge を呼ばない", async () => {
    postMutterMock.mockResolvedValue({
      ok: true,
      muttering: { id: "m-2", category: "mood", reply: "そっかぁ" },
      processedTask: null,
    });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.send("今日は疲れた");
    });

    expect(requestNudgeMock).not.toHaveBeenCalled();
  });

  test("send 失敗（ok:false）では requestNudge を呼ばない", async () => {
    postMutterMock.mockResolvedValue({ ok: false, reply: "今日はちょっと…" });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.send("部屋を片付けたい");
    });

    expect(requestNudgeMock).not.toHaveBeenCalled();
  });

  test("requestNudge の失敗はキャラ内エラーを出さず console.error のみ（send の成功体験を壊さない）", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    postMutterMock.mockResolvedValue({
      ok: true,
      muttering: { id: "m-1", category: "seed", reply: "覚えておくよ" },
      processedTask: "部屋を片付ける",
    });
    requestNudgeMock.mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.send("部屋を片付けたい");
    });

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "requestNudge(firstSeed) failed",
        expect.any(Error),
      );
    });
    // キャラ内エラーバブル（FALLBACK_REPLY）は追加されない
    expect(
      result.current.messages.some((m) => m.kind === "text" && m.text === FALLBACK_REPLY),
    ).toBe(false);

    consoleErrorSpy.mockRestore();
  });
});

describe("requestManualNudge（手動ナッジ）", () => {
  test("kind:nudge ならナッジカードを末尾に追加する", async () => {
    requestNudgeMock.mockResolvedValue({
      kind: "nudge",
      seed: { seedId: "seed-1", task: "部屋を片付ける", prophecy: "片付いた部屋、気持ちいいかも" },
    });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.requestManualNudge();
    });

    expect(requestNudgeMock).toHaveBeenCalledWith({ data: { trigger: "manual" } });
    expect(result.current.messages.find((m) => m.kind === "nudge")).toMatchObject({
      seedId: "seed-1",
      prophecy: "片付いた部屋、気持ちいいかも",
      status: "idle",
    });
  });

  test("既にタイムライン上にある seed が再表示されても、カード id が重複しない（都度採番）", async () => {
    requestNudgeMock.mockResolvedValue({
      kind: "nudge",
      seed: { seedId: "seed-1", task: "部屋を片付ける", prophecy: "片付いた部屋、気持ちいいかも" },
    });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.requestManualNudge();
    });

    const cards = result.current.messages.filter((m) => m.kind === "nudge");
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.id)).size).toBe(2);
    expect(cards.every((c) => c.seedId === "seed-1")).toBe(true);
  });

  test.each([{ intensity: "chill" as const }, { intensity: "sharp" as const }])(
    "kind:empty（タネなし）なら intensity=$intensity の静的応答を追加する",
    async ({ intensity }) => {
      requestNudgeMock.mockResolvedValue({ kind: "empty" });
      const { result } = renderHook(() =>
        useChat({ initialMessages: [], initialIntensity: intensity }),
      );

      await act(async () => {
        await result.current.requestManualNudge();
      });

      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0]).toMatchObject({
        kind: "text",
        role: "nudgey",
        text: MANUAL_NUDGE_EMPTY_REPLY[intensity],
      });
    },
  );

  test("kind:none（LLM 失敗・競合等）ならキャラ内エラー応答を追加する（無反応にしない）", async () => {
    requestNudgeMock.mockResolvedValue({ kind: "none" });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.requestManualNudge();
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      kind: "text",
      role: "nudgey",
      text: FALLBACK_REPLY,
    });
  });

  test("kind:housekeeping なら棚卸しカードを追加する（自動と同一フロー）", async () => {
    requestNudgeMock.mockResolvedValue({
      kind: "housekeeping",
      items: [{ seedId: "seed-1", task: "部屋を片付ける" }],
    });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.requestManualNudge();
    });

    expect(result.current.messages[0]).toMatchObject({
      kind: "housekeeping",
      items: [{ seedId: "seed-1", task: "部屋を片付ける", status: "idle" }],
    });
  });

  test("通信失敗（throw）ならキャラ内エラー応答を追加する", async () => {
    requestNudgeMock.mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.requestManualNudge();
    });

    expect(result.current.messages[0]).toMatchObject({
      kind: "text",
      role: "nudgey",
      text: FALLBACK_REPLY,
    });
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

  test("成功時に parentSuggestion が付いていれば、答え合わせバブルの直後に再提案カードを同一更新で追加する", async () => {
    postReactionMock.mockResolvedValue({
      ok: true,
      reply: "いいね、お疲れさま",
      parentSuggestion: { parentSeedId: "parent-1", parentTask: "部屋を片付ける" },
    });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.react("seed-1", "completed");
    });

    const messages = result.current.messages;
    const replyIndex = messages.findIndex(
      (m) => m.kind === "text" && m.role === "nudgey" && m.text === "いいね、お疲れさま",
    );
    const cardIndex = messages.findIndex((m) => m.kind === "parentSuggestion");
    expect(replyIndex).toBeGreaterThanOrEqual(0);
    expect(cardIndex).toBe(replyIndex + 1);
    expect(messages[cardIndex]).toMatchObject({
      kind: "parentSuggestion",
      parentSeedId: "parent-1",
      parentTask: "部屋を片付ける",
      status: "idle",
    });
  });

  test("parentSuggestion がなければ再提案カードを追加しない", async () => {
    postReactionMock.mockResolvedValue({ ok: true, reply: "いいね、お疲れさま" });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.react("seed-1", "completed");
    });

    expect(result.current.messages.some((m) => m.kind === "parentSuggestion")).toBe(false);
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

  test("discard が通信例外で失敗したら該当行の status を idle に戻し、キャラ内エラーバブルを追加する", async () => {
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
    expect(
      result.current.messages.find((m) => m.kind === "text" && m.role === "nudgey"),
    ).toMatchObject({
      text: FALLBACK_REPLY,
    });
  });

  test("discard が ok:false（競合で対象が既に pending でない）を返したら行を消さず status を idle に戻し、キャラ内エラーバブルを追加する", async () => {
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
    expect(
      result.current.messages.find((m) => m.kind === "text" && m.role === "nudgey"),
    ).toMatchObject({
      text: FALLBACK_REPLY,
    });
  });
});

describe("親タスクの再提案（reviveParent / declineParent）", () => {
  test("reviveParent 成功: postReviveParent に parentSeedId を渡し、カード status:resolved・応答バブル追加", async () => {
    postReviveParentMock.mockResolvedValue({
      ok: true,
      reply: "了解。またタイミングを見て声をかけるね",
    });
    const { result } = renderHook(() =>
      useChat({
        initialMessages: [createParentSuggestionMessage()],
        initialIntensity: "chill",
      }),
    );

    await act(async () => {
      await result.current.reviveParent("card-1", "parent-1");
    });

    expect(postReviveParentMock).toHaveBeenCalledWith({ data: { parentSeedId: "parent-1" } });
    const messages = result.current.messages;
    expect(messages.find((m) => m.kind === "parentSuggestion")).toMatchObject({
      status: "resolved",
    });
    expect(messages.find((m) => m.kind === "text" && m.role === "user")).toMatchObject({
      text: "やってみる",
    });
    expect(messages.find((m) => m.kind === "text" && m.role === "nudgey")).toMatchObject({
      text: "了解。またタイミングを見て声をかけるね",
    });
  });

  test("reviveParent alreadyReacted: status:resolved になるが応答バブルは追加しない", async () => {
    postReviveParentMock.mockResolvedValue({ ok: true, alreadyReacted: true, reply: "" });
    const { result } = renderHook(() =>
      useChat({
        initialMessages: [createParentSuggestionMessage()],
        initialIntensity: "chill",
      }),
    );

    await act(async () => {
      await result.current.reviveParent("card-1", "parent-1");
    });

    const messages = result.current.messages;
    expect(messages.find((m) => m.kind === "parentSuggestion")).toMatchObject({
      status: "resolved",
    });
    expect(messages.filter((m) => m.kind === "text" && m.role === "nudgey")).toHaveLength(0);
  });

  test("reviveParent 失敗（ok:false）: 楽観バブルを取り消し、カード status を idle に戻し、エラー応答を追加する", async () => {
    postReviveParentMock.mockResolvedValue({ ok: false, reply: "今日はちょっと…" });
    const { result } = renderHook(() =>
      useChat({
        initialMessages: [createParentSuggestionMessage()],
        initialIntensity: "chill",
      }),
    );

    await act(async () => {
      await result.current.reviveParent("card-1", "parent-1");
    });

    const messages = result.current.messages;
    expect(messages.find((m) => m.kind === "parentSuggestion")).toMatchObject({ status: "idle" });
    expect(messages.filter((m) => m.kind === "text" && m.role === "user")).toHaveLength(0);
    expect(messages.find((m) => m.kind === "text" && m.role === "nudgey")).toMatchObject({
      text: "今日はちょっと…",
    });
  });

  test("reviveParent 通信失敗（throw）: FALLBACK_REPLY で巻き戻す", async () => {
    postReviveParentMock.mockRejectedValue(new Error("network error"));
    const { result } = renderHook(() =>
      useChat({
        initialMessages: [createParentSuggestionMessage()],
        initialIntensity: "chill",
      }),
    );

    await act(async () => {
      await result.current.reviveParent("card-1", "parent-1");
    });

    const messages = result.current.messages;
    expect(messages.find((m) => m.kind === "parentSuggestion")).toMatchObject({ status: "idle" });
    expect(messages.find((m) => m.kind === "text" && m.role === "nudgey")).toMatchObject({
      text: FALLBACK_REPLY,
    });
  });

  test("reviveParent はカードの id（messageId）でカードを特定する。parentSeedId が一致しても id が違うカードは更新しない", async () => {
    postReviveParentMock.mockResolvedValue({ ok: true, reply: "了解" });
    const otherCard = createParentSuggestionMessage({ id: "card-2", parentSeedId: "parent-1" });
    const targetCard = createParentSuggestionMessage({ id: "card-1", parentSeedId: "parent-1" });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [otherCard, targetCard], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.reviveParent("card-1", "parent-1");
    });

    const cards = result.current.messages.filter((m) => m.kind === "parentSuggestion");
    expect(cards.find((c) => c.id === "card-1")).toMatchObject({ status: "resolved" });
    expect(cards.find((c) => c.id === "card-2")).toMatchObject({ status: "idle" });
  });

  test("reactingSeedId ガードを react() と共有する: 他の反応が in-flight のときは postReviveParent を呼ばない", async () => {
    let resolveReaction!: (value: { ok: true; reply: string }) => void;
    postReactionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReaction = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useChat({
        initialMessages: [createNudgeMessage(), createParentSuggestionMessage()],
        initialIntensity: "chill",
      }),
    );

    let reactPromise: Promise<void> | undefined;
    act(() => {
      reactPromise = result.current.react("seed-1", "completed");
    });

    await act(async () => {
      await result.current.reviveParent("card-1", "parent-1");
    });

    expect(postReviveParentMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveReaction({ ok: true, reply: "いいね、お疲れさま" });
      await reactPromise;
    });
  });

  test("declineParent: server fn は呼ばず、ユーザーバブル + 静的ナッジー応答を追加してカードを resolved にする", () => {
    const { result } = renderHook(() =>
      useChat({
        initialMessages: [createParentSuggestionMessage()],
        initialIntensity: "chill",
      }),
    );

    act(() => {
      result.current.declineParent("card-1");
    });

    expect(postReviveParentMock).not.toHaveBeenCalled();
    const messages = result.current.messages;
    expect(messages.find((m) => m.kind === "parentSuggestion")).toMatchObject({
      status: "resolved",
    });
    expect(messages.find((m) => m.kind === "text" && m.role === "user")).toMatchObject({
      text: "今はいいや",
    });
    expect(messages.find((m) => m.kind === "text" && m.role === "nudgey")).toMatchObject({
      text: "そっか、また気が向いたら教えてね",
    });
  });
});

describe("celebrating（羊の喜び演出）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("初期値は false", () => {
    const { result } = renderHook(() =>
      useChat({ initialMessages: [], initialIntensity: "chill" }),
    );

    expect(result.current.celebrating).toBe(false);
  });

  test("reaction:completed が成功（alreadyReactedでない）すると true になり、2500ms 後に false へ戻る", async () => {
    postReactionMock.mockResolvedValue({ ok: true, reply: "いいね、お疲れさま" });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.react("seed-1", "completed");
    });
    expect(result.current.celebrating).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(result.current.celebrating).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.celebrating).toBe(false);
  });

  test.each([{ reaction: "softened" as const }, { reaction: "archived" as const }])(
    "reaction:$reaction では celebrating を発火しない（完了以外では喜ばない）",
    async ({ reaction }) => {
      postReactionMock.mockResolvedValue({ ok: true, reply: "うんうん" });
      const { result } = renderHook(() =>
        useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
      );

      await act(async () => {
        await result.current.react("seed-1", reaction);
      });

      expect(result.current.celebrating).toBe(false);
    },
  );

  test("alreadyReacted のときは celebrating を発火しない（新規完了ではないため）", async () => {
    postReactionMock.mockResolvedValue({ ok: true, alreadyReacted: true, reply: "" });
    const { result } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.react("seed-1", "completed");
    });

    expect(result.current.celebrating).toBe(false);
  });

  test("連続完了時はタイマーがリセットされる（debounce-reset。最後のトリガーから2500ms保つ）", async () => {
    postReactionMock.mockResolvedValue({ ok: true, reply: "いいね" });
    const secondNudge = createNudgeMessage({ id: "seed-2", seedId: "seed-2" });
    const { result } = renderHook(() =>
      useChat({
        initialMessages: [createNudgeMessage(), secondNudge],
        initialIntensity: "chill",
      }),
    );

    await act(async () => {
      await result.current.react("seed-1", "completed");
    });
    expect(result.current.celebrating).toBe(true);

    // 最初のトリガーから2000ms（2500ms未満なのでまだ true のはず）
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.celebrating).toBe(true);

    // ここで2回目の完了がタイマーをリセットする
    await act(async () => {
      await result.current.react("seed-2", "completed");
    });
    expect(result.current.celebrating).toBe(true);

    // 2回目のトリガーから2000ms経過。リセットされていれば残り500msあるのでまだ true
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.celebrating).toBe(true);

    // 2回目のトリガーから2500ms経過。ここで false に戻る
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.celebrating).toBe(false);
  });

  test("unmount 時にタイマーを解除する（unmount後にタイマーを進めても例外や警告なし）", async () => {
    postReactionMock.mockResolvedValue({ ok: true, reply: "いいね" });
    const { result, unmount } = renderHook(() =>
      useChat({ initialMessages: [createNudgeMessage()], initialIntensity: "chill" }),
    );

    await act(async () => {
      await result.current.react("seed-1", "completed");
    });

    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(2500);
      });
    }).not.toThrow();
  });
});
