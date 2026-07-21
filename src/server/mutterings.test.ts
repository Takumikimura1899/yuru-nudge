import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Kysely } from "kysely";
import type { DB } from "./db-types";
import type { NudgeyResponse } from "./ai/schema";

vi.mock("./env", () => ({
  env: {
    APP_USER_ID: "test-user",
    API_SECRET_KEY: "test-secret",
    DATABASE_URL: "postgresql://test",
  },
}));

const classifyAndReplyMock = vi.fn();
vi.mock("./ai/nudgey", () => ({
  classifyAndReply: (...args: unknown[]) => classifyAndReplyMock(...args),
}));

const { processMutter, fetchTimeline, postMutterInput } = await import("./mutterings");

const createMockNudgeyResponse = (overrides: Partial<NudgeyResponse> = {}): NudgeyResponse => ({
  category: "seed",
  reply: "部屋を片付けたいんだねぇ。覚えておくよ",
  processed_task: "部屋を片付ける",
  ...overrides,
});

const createMockMuttering = (overrides = {}) => ({
  id: "m-1",
  user_id: "test-user",
  content: "部屋を片付けたい",
  category: "seed",
  reply: "部屋を片付けたいんだねぇ。覚えておくよ",
  created_at: new Date("2026-06-07T00:00:00Z"),
  ...overrides,
});

/** Kysely のチェーンを模した DB モック。終端メソッド以外は自身を返す */
const createMockDb = () => {
  const db: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethods = [
    "selectFrom",
    "select",
    "selectAll",
    "where",
    "orderBy",
    "limit",
    "insertInto",
    "values",
    "returningAll",
    "deleteFrom",
    "updateTable",
    "set",
  ];
  for (const method of chainMethods) {
    db[method] = vi.fn().mockReturnThis();
  }
  db.executeTakeFirst = vi.fn().mockResolvedValue(undefined);
  db.executeTakeFirstOrThrow = vi.fn();
  db.execute = vi.fn().mockResolvedValue([]);
  db.transaction = vi.fn(() => ({
    execute: (cb: (trx: typeof db) => Promise<unknown>) => cb(db),
  }));
  db.destroy = vi.fn();
  return db;
};

type MockDb = ReturnType<typeof createMockDb>;
const asDb = (db: MockDb) => db as unknown as Kysely<DB>;

describe("postMutterInput（バリデーション）", () => {
  test("1〜140文字を受理し、前後の空白はトリムする", () => {
    expect(postMutterInput.parse({ content: "  片付けたい  " })).toEqual({
      content: "片付けたい",
    });
    expect(postMutterInput.parse({ content: "あ".repeat(140) }).content).toHaveLength(140);
  });

  test.each([
    { name: "空文字", content: "" },
    { name: "空白のみ", content: "   " },
    { name: "141文字", content: "あ".repeat(141) },
  ])("$name は拒否する", ({ content }) => {
    expect(() => postMutterInput.parse({ content })).toThrow();
  });
});

describe("processMutter", () => {
  let db: MockDb;

  beforeEach(() => {
    classifyAndReplyMock.mockReset();
    db = createMockDb();
  });

  test("seed 分類: mutterings と seeds の両方に保存し、保存結果を返す", async () => {
    const nudgey = createMockNudgeyResponse();
    const saved = createMockMuttering();
    classifyAndReplyMock.mockResolvedValue({ ok: true, data: nudgey });
    db.executeTakeFirst.mockResolvedValue({ intensity_level: "chill" });
    db.executeTakeFirstOrThrow.mockResolvedValue(saved);

    const result = await processMutter(asDb(db), {
      userId: "test-user",
      content: "部屋を片付けたい",
    });

    expect(result).toEqual({ ok: true, muttering: saved, processedTask: nudgey.processed_task });
    expect(db.insertInto.mock.calls.map((c) => c[0])).toEqual(["mutterings", "seeds"]);
    expect(db.values).toHaveBeenCalledWith({
      user_id: "test-user",
      content: "部屋を片付けたい",
      category: "seed",
      reply: nudgey.reply,
    });
    expect(db.values).toHaveBeenCalledWith({
      user_id: "test-user",
      muttering_id: saved.id,
      processed_task: nudgey.processed_task,
    });
    expect(db.deleteFrom).not.toHaveBeenCalled();
  });

  test("mood 分類: seeds には保存せず、古い mood の淘汰を実行する", async () => {
    const nudgey = createMockNudgeyResponse({
      category: "mood",
      reply: "そっかぁ、疲れてるんだねぇ",
      processed_task: null,
    });
    const saved = createMockMuttering({ category: "mood", reply: nudgey.reply });
    classifyAndReplyMock.mockResolvedValue({ ok: true, data: nudgey });
    db.executeTakeFirst.mockResolvedValue({ intensity_level: "chill" });
    db.executeTakeFirstOrThrow.mockResolvedValue(saved);

    const result = await processMutter(asDb(db), {
      userId: "test-user",
      content: "今日は疲れた",
    });

    expect(result).toEqual({ ok: true, muttering: saved, processedTask: null });
    expect(db.insertInto.mock.calls.map((c) => c[0])).toEqual(["mutterings"]);
    expect(db.deleteFrom).toHaveBeenCalledWith("mutterings");
  });

  test("プロフィールの intensity を LLM に渡す（未作成なら chill）", async () => {
    classifyAndReplyMock.mockResolvedValue({ ok: true, data: createMockNudgeyResponse() });
    db.executeTakeFirstOrThrow.mockResolvedValue(createMockMuttering());

    db.executeTakeFirst.mockResolvedValue({ intensity_level: "sharp" });
    await processMutter(asDb(db), { userId: "test-user", content: "本を読みたい" });
    expect(classifyAndReplyMock).toHaveBeenCalledWith({
      content: "本を読みたい",
      intensity: "sharp",
    });

    db.executeTakeFirst.mockResolvedValue(undefined);
    await processMutter(asDb(db), { userId: "test-user", content: "本を読みたい" });
    expect(classifyAndReplyMock).toHaveBeenLastCalledWith({
      content: "本を読みたい",
      intensity: "chill",
    });
  });

  test("LLM 失敗時: 何も保存せず、キャラ内エラー応答を返す", async () => {
    classifyAndReplyMock.mockResolvedValue({
      ok: false,
      reply: "今日はちょっとぼんやりしてるみたい…もう一回言ってくれる？",
    });

    const result = await processMutter(asDb(db), {
      userId: "test-user",
      content: "部屋を片付けたい",
    });

    expect(result).toEqual({
      ok: false,
      reply: "今日はちょっとぼんやりしてるみたい…もう一回言ってくれる？",
    });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  test("seed 分類でも processed_task が null なら seeds には保存しない", async () => {
    classifyAndReplyMock.mockResolvedValue({
      ok: true,
      data: createMockNudgeyResponse({ processed_task: null }),
    });
    db.executeTakeFirstOrThrow.mockResolvedValue(createMockMuttering());

    await processMutter(asDb(db), { userId: "test-user", content: "なんかやりたい" });

    expect(db.insertInto.mock.calls.map((c) => c[0])).toEqual(["mutterings"]);
  });
});

describe("fetchTimeline", () => {
  test("直近20件を取得し、古い順に並べ替えて返す", async () => {
    const db = createMockDb();
    const newest = createMockMuttering({ id: "m-2" });
    const oldest = createMockMuttering({ id: "m-1" });
    db.execute.mockResolvedValue([newest, oldest]);

    const result = await fetchTimeline(asDb(db), "test-user");

    expect(result).toEqual([oldest, newest]);
    expect(db.selectFrom).toHaveBeenCalledWith("mutterings");
    expect(db.where).toHaveBeenCalledWith("user_id", "=", "test-user");
    expect(db.orderBy).toHaveBeenCalledWith("created_at", "desc");
    expect(db.limit).toHaveBeenCalledWith(20);
  });

  test("processed_task は原本（parent_id が null の親）の seed に限定したサブクエリで取得する（leftJoin へ退行すると緩和版の子seedとの重複行を招くため、正しい不変条件を保証する）", async () => {
    const db = createMockDb();
    db.execute.mockResolvedValue([]);

    // 実装は eb.selectFrom("seeds")...where("seeds.parent_id","is",null).as("processed_task")
    // というスカラサブクエリを select() のコールバック引数に渡している。Kysely の
    // ExpressionBuilder を模したフェイクをコールバックへ渡し、実際に呼び出させて検証する
    const fakeEb = {
      selectFrom: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      whereRef: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      as: vi.fn((alias: string) => alias),
    };
    db.select = vi.fn((arg: unknown) => {
      if (typeof arg === "function") {
        (arg as (eb: typeof fakeEb) => unknown[])(fakeEb);
      }
      return db;
    });

    await fetchTimeline(asDb(db), "test-user");

    expect(fakeEb.selectFrom).toHaveBeenCalledWith("seeds");
    expect(fakeEb.select).toHaveBeenCalledWith("processed_task");
    expect(fakeEb.whereRef).toHaveBeenCalledWith("seeds.muttering_id", "=", "mutterings.id");
    expect(fakeEb.where).toHaveBeenCalledWith("seeds.parent_id", "is", null);
    expect(fakeEb.as).toHaveBeenCalledWith("processed_task");
  });

  test("緩和版の親子が同一 muttering_id を持つ場合でも、DBが解決した行（親のタスク名を持つ1行）をそのまま重複させずに返す", async () => {
    const db = createMockDb();
    // 実 DB ではスカラサブクエリにより、親（parent_id null）子（parent_id=親id）が同一
    // muttering_id を共有していても行は増殖せず、processed_task は親のタスク名になる。
    // ここではその「正しく解決された」DB応答を模し、fetchTimeline が加工（reverse以外）で
    // 行を増やしたり processed_task を取り違えたりしないことを確認する
    const resolvedRow = createMockMuttering({
      id: "m-1",
      processed_task: "部屋を片付ける", // 親（原本）のタスク名
    });
    db.execute.mockResolvedValue([resolvedRow]);

    const result = await fetchTimeline(asDb(db), "test-user");

    expect(result).toEqual([resolvedRow]);
    expect(result).toHaveLength(1);
  });
});
