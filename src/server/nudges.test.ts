import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import type { Kysely } from "kysely";
import type { DB } from "./db-types";

vi.mock("./env", () => ({
  env: {
    APP_USER_ID: "test-user",
    API_SECRET_KEY: "test-secret",
    DATABASE_URL: "postgresql://test",
  },
}));

const selectNudgeMock = vi.fn();
const generateCompletionReplyMock = vi.fn();
const generateSoftenedTaskMock = vi.fn();
vi.mock("./ai/nudgey", () => ({
  selectNudge: (...args: unknown[]) => selectNudgeMock(...args),
  generateCompletionReply: (...args: unknown[]) => generateCompletionReplyMock(...args),
  generateSoftenedTask: (...args: unknown[]) => generateSoftenedTaskMock(...args),
}));

const { isIntervalElapsed, resolveNudgeState, reactToNudge, discardSeed } =
  await import("./nudges");
const { ARCHIVED_REPLY, HOUSEKEEPING_THRESHOLD, NUDGE_INTERVAL_HOURS, NUDGE_TIMEOUT_DAYS } =
  await import("./ai/constants");

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
    "updateTable",
    "set",
  ];
  for (const method of chainMethods) {
    db[method] = vi.fn().mockReturnThis();
  }
  db.executeTakeFirst = vi.fn().mockResolvedValue(undefined);
  db.execute = vi.fn().mockResolvedValue([]);
  db.transaction = vi.fn(() => ({
    execute: (cb: (trx: typeof db) => Promise<unknown>) => cb(db),
  }));
  db.destroy = vi.fn();
  return db;
};

type MockDb = ReturnType<typeof createMockDb>;
const asDb = (db: MockDb) => db as unknown as Kysely<DB>;

const NOW = new Date("2026-07-18T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const createPendingSeed = (overrides = {}) => ({
  id: "seed-1",
  processed_task: "部屋を片付ける",
  ...overrides,
});

const createRedisplaySeedRow = (overrides = {}) => ({
  id: "seed-1",
  processed_task: "部屋を片付ける",
  prophecy: "片付いた部屋、気持ちいいかも",
  ...overrides,
});

describe("isIntervalElapsed", () => {
  test("null（未提案）は常に経過扱い", () => {
    expect(isIntervalElapsed(null, NOW)).toBe(true);
  });

  test("ちょうど12時間経過は境界を含んで経過扱い", () => {
    const lastNudgedAt = new Date(NOW.getTime() - NUDGE_INTERVAL_HOURS * HOUR_MS);
    expect(isIntervalElapsed(lastNudgedAt, NOW)).toBe(true);
  });

  test("12時間未満は未経過", () => {
    const lastNudgedAt = new Date(NOW.getTime() - NUDGE_INTERVAL_HOURS * HOUR_MS + 1);
    expect(isIntervalElapsed(lastNudgedAt, NOW)).toBe(false);
  });
});

describe("resolveNudgeState", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    selectNudgeMock.mockReset();
    generateCompletionReplyMock.mockReset();
    generateSoftenedTaskMock.mockReset();
  });

  test("タイムアウトした nudged を条件付き UPDATE で一括 archive する（status 再チェックで TOCTOU を回避）", async () => {
    db.execute
      .mockResolvedValueOnce(undefined) // archive UPDATE（戻り値は不使用）
      .mockResolvedValueOnce([]); // fetchPendingSeeds
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined) // pickNudgedSeed
      .mockResolvedValueOnce(undefined); // fetchLastNudgedAt（未提案 → 経過扱い）

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({ kind: "none" });
    expect(db.updateTable).toHaveBeenCalledWith("seeds");
    expect(db.set).toHaveBeenCalledWith({ status: "archived", updated_at: NOW });
    expect(db.where).toHaveBeenCalledWith("user_id", "=", "test-user");
    expect(db.where).toHaveBeenCalledWith("status", "=", "nudged");
    expect(db.where).toHaveBeenCalledWith(
      "nudged_at",
      "<",
      new Date(NOW.getTime() - NUDGE_TIMEOUT_DAYS * DAY_MS),
    );
  });

  test("nudged が複数残っていても nudged_at desc, id asc, limit 1 で決定的に1件選び再表示する", async () => {
    db.execute.mockResolvedValueOnce(undefined); // archive UPDATE
    db.executeTakeFirst.mockResolvedValueOnce(createRedisplaySeedRow()); // pickNudgedSeed

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({
      kind: "nudge",
      seed: { seedId: "seed-1", task: "部屋を片付ける", prophecy: "片付いた部屋、気持ちいいかも" },
    });
    expect(db.orderBy).toHaveBeenCalledWith("nudged_at", "desc");
    expect(db.orderBy).toHaveBeenCalledWith("id", "asc");
    expect(db.limit).toHaveBeenCalledWith(1);
  });

  test("再表示 seed の prophecy が null なら空文字にする", async () => {
    db.execute.mockResolvedValueOnce(undefined); // archive UPDATE
    db.executeTakeFirst.mockResolvedValueOnce(createRedisplaySeedRow({ prophecy: null }));

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({
      kind: "nudge",
      seed: { seedId: "seed-1", task: "部屋を片付ける", prophecy: "" },
    });
  });

  test("間隔経過後に pending が閾値以上なら棚卸しを優先する", async () => {
    const pending = Array.from({ length: HOUSEKEEPING_THRESHOLD }, (_, i) =>
      createPendingSeed({ id: `seed-${i}`, processed_task: `task-${i}` }),
    );
    db.execute
      .mockResolvedValueOnce(undefined) // archive UPDATE
      .mockResolvedValueOnce(pending); // fetchPendingSeeds
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined) // pickNudgedSeed
      .mockResolvedValueOnce(undefined); // fetchLastNudgedAt（未提案 → 経過扱い）

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({
      kind: "housekeeping",
      items: pending.map((p) => ({ seedId: p.id, task: p.processed_task })),
    });
    expect(db.executeTakeFirst).toHaveBeenCalledTimes(2); // generateNewNudge の fetchIntensity には到達していない
    expect(selectNudgeMock).not.toHaveBeenCalled();
  });

  test("間隔が未経過なら pending が閾値以上でも棚卸しを表示しない（棚卸しもナッジ枠を使う扱いのため）", async () => {
    db.execute.mockResolvedValueOnce(undefined); // archive UPDATE
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined) // pickNudgedSeed
      .mockResolvedValueOnce({ nudged_at: new Date(NOW.getTime() - HOUR_MS) }); // 1時間前 → 未経過

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({ kind: "none" });
    // fetchPendingSeeds（棚卸し判定）に到達していない
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  test("pending が0件なら none", async () => {
    db.execute
      .mockResolvedValueOnce(undefined) // archive UPDATE
      .mockResolvedValueOnce([]); // fetchPendingSeeds
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined) // pickNudgedSeed
      .mockResolvedValueOnce(undefined); // fetchLastNudgedAt

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({ kind: "none" });
  });

  test("提案間隔(12h)が未経過なら pending 取得前に none を返す。LLM は呼ばない", async () => {
    db.execute.mockResolvedValueOnce(undefined); // archive UPDATE
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined) // pickNudgedSeed
      .mockResolvedValueOnce({ nudged_at: new Date(NOW.getTime() - HOUR_MS) }); // 1時間前

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({ kind: "none" });
    expect(selectNudgeMock).not.toHaveBeenCalled();
    expect(db.execute).toHaveBeenCalledTimes(1); // fetchPendingSeeds に到達していない
  });

  test("間隔経過・LLM選択成功 → 対象 seed を nudged へ条件付き更新し提案を返す", async () => {
    const pending = [createPendingSeed({ id: "seed-1", processed_task: "部屋を片付ける" })];
    db.execute
      .mockResolvedValueOnce(undefined) // archive UPDATE
      .mockResolvedValueOnce(pending) // fetchPendingSeeds
      .mockResolvedValueOnce([]); // fetchRecentMoods
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined) // pickNudgedSeed
      .mockResolvedValueOnce(undefined) // fetchLastNudgedAt（未提案）
      .mockResolvedValueOnce({ intensity_level: "sharp" }) // fetchIntensity
      .mockResolvedValueOnce({
        id: "seed-1",
        processed_task: "部屋を片付ける",
        prophecy: "片付いた部屋、気持ちいいかも",
      }); // 最終 UPDATE
    selectNudgeMock.mockResolvedValue({
      ok: true,
      seedId: "seed-1",
      prophecy: "片付いた部屋、気持ちいいかも",
    });

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({
      kind: "nudge",
      seed: { seedId: "seed-1", task: "部屋を片付ける", prophecy: "片付いた部屋、気持ちいいかも" },
    });
    expect(selectNudgeMock).toHaveBeenCalledWith({
      candidates: [{ seedId: "seed-1", task: "部屋を片付ける" }],
      moods: [],
      intensity: "sharp",
    });
    expect(db.set).toHaveBeenCalledWith({
      status: "nudged",
      prophecy: "片付いた部屋、気持ちいいかも",
      nudged_at: NOW,
      updated_at: NOW,
    });
    expect(db.where).toHaveBeenCalledWith("id", "=", "seed-1");
    expect(db.where).toHaveBeenCalledWith("status", "=", "pending");
  });

  test("LLM が選択できなかった場合は none。条件付き UPDATE は呼ばない", async () => {
    db.execute
      .mockResolvedValueOnce(undefined) // archive UPDATE
      .mockResolvedValueOnce([createPendingSeed()]) // fetchPendingSeeds
      .mockResolvedValueOnce([]); // fetchRecentMoods
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ intensity_level: "chill" });
    selectNudgeMock.mockResolvedValue({ ok: false });

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({ kind: "none" });
    expect(db.executeTakeFirst).toHaveBeenCalledTimes(3); // 最終 UPDATE は呼ばれない
  });

  test("選択後の条件付き UPDATE が0件（競合で既に処理済み）なら none", async () => {
    db.execute
      .mockResolvedValueOnce(undefined) // archive UPDATE
      .mockResolvedValueOnce([createPendingSeed()]) // fetchPendingSeeds
      .mockResolvedValueOnce([]); // fetchRecentMoods
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ intensity_level: "chill" })
      .mockResolvedValueOnce(undefined); // 最終 UPDATE が0件
    selectNudgeMock.mockResolvedValue({ ok: true, seedId: "seed-1", prophecy: "..." });

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({ kind: "none" });
  });
});

describe("reactToNudge", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    generateCompletionReplyMock.mockReset();
    generateSoftenedTaskMock.mockReset();
  });

  describe("completed", () => {
    test("nudged → completed に更新し、LLM の答え合わせ応答を返す", async () => {
      const updatedSeed = { id: "seed-1", processed_task: "部屋を片付ける", prophecy: "..." };
      db.executeTakeFirst
        .mockResolvedValueOnce(updatedSeed) // 条件付き UPDATE
        .mockResolvedValueOnce({ intensity_level: "sharp" }); // fetchIntensity
      generateCompletionReplyMock.mockResolvedValue("いいね、お疲れさま");

      const result = await reactToNudge(asDb(db), {
        userId: "test-user",
        seedId: "seed-1",
        reaction: "completed",
      });

      expect(result).toEqual({ ok: true, reply: "いいね、お疲れさま" });
      expect(db.set).toHaveBeenCalledWith({ status: "completed", updated_at: expect.any(Date) });
      expect(db.where).toHaveBeenCalledWith("id", "=", "seed-1");
      expect(db.where).toHaveBeenCalledWith("user_id", "=", "test-user");
      expect(db.where).toHaveBeenCalledWith("status", "=", "nudged");
      expect(generateCompletionReplyMock).toHaveBeenCalledWith({
        task: "部屋を片付ける",
        prophecy: "...",
        intensity: "sharp",
      });
    });

    test("既に nudged でない（二重送信）→ alreadyReacted、LLM は呼ばない", async () => {
      db.executeTakeFirst.mockResolvedValueOnce(undefined);

      const result = await reactToNudge(asDb(db), {
        userId: "test-user",
        seedId: "seed-1",
        reaction: "completed",
      });

      expect(result).toEqual({ ok: true, alreadyReacted: true, reply: "" });
      expect(generateCompletionReplyMock).not.toHaveBeenCalled();
      expect(db.executeTakeFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe("archived", () => {
    test.each([
      { intensity: "chill", expected: ARCHIVED_REPLY.chill },
      { intensity: "sharp", expected: ARCHIVED_REPLY.sharp },
    ])(
      "nudged → archived に更新し、intensity=$intensity の静的応答を返す",
      async ({ intensity, expected }) => {
        db.executeTakeFirst
          .mockResolvedValueOnce({ id: "seed-1" })
          .mockResolvedValueOnce({ intensity_level: intensity });

        const result = await reactToNudge(asDb(db), {
          userId: "test-user",
          seedId: "seed-1",
          reaction: "archived",
        });

        expect(result).toEqual({ ok: true, reply: expected });
        expect(db.set).toHaveBeenCalledWith({ status: "archived", updated_at: expect.any(Date) });
      },
    );

    test("既に nudged でない（二重送信）→ alreadyReacted", async () => {
      db.executeTakeFirst.mockResolvedValueOnce(undefined);

      const result = await reactToNudge(asDb(db), {
        userId: "test-user",
        seedId: "seed-1",
        reaction: "archived",
      });

      expect(result).toEqual({ ok: true, alreadyReacted: true, reply: "" });
    });
  });

  describe("softened", () => {
    test("対象が nudged でなければ LLM を呼ばず alreadyReacted", async () => {
      db.executeTakeFirst.mockResolvedValueOnce(undefined); // current select

      const result = await reactToNudge(asDb(db), {
        userId: "test-user",
        seedId: "seed-1",
        reaction: "softened",
      });

      expect(result).toEqual({ ok: true, alreadyReacted: true, reply: "" });
      expect(generateSoftenedTaskMock).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    });

    test("LLM 失敗時は状態遷移せず ok:false を返す", async () => {
      db.executeTakeFirst
        .mockResolvedValueOnce({
          id: "seed-1",
          processed_task: "部屋を片付ける",
          muttering_id: "m-1",
        })
        .mockResolvedValueOnce({ intensity_level: "chill" });
      generateSoftenedTaskMock.mockResolvedValue({ ok: false, reply: "今日はちょっと…" });

      const result = await reactToNudge(asDb(db), {
        userId: "test-user",
        seedId: "seed-1",
        reaction: "softened",
      });

      expect(result).toEqual({ ok: false, reply: "今日はちょっと…" });
      expect(db.transaction).not.toHaveBeenCalled();
    });

    test("成功時はトランザクションで親を softened に、子を pending で挿入する", async () => {
      db.executeTakeFirst
        .mockResolvedValueOnce({
          id: "seed-1",
          processed_task: "部屋を片付ける",
          muttering_id: "m-1",
        }) // current
        .mockResolvedValueOnce({ intensity_level: "chill" }) // fetchIntensity
        .mockResolvedValueOnce({ id: "seed-1", muttering_id: "m-1" }); // trx: 親 UPDATE
      generateSoftenedTaskMock.mockResolvedValue({
        ok: true,
        softenedTask: "机の上だけ片付ける",
        reply: "じゃあ机の上だけとか？",
      });

      const result = await reactToNudge(asDb(db), {
        userId: "test-user",
        seedId: "seed-1",
        reaction: "softened",
      });

      expect(result).toEqual({ ok: true, reply: "じゃあ机の上だけとか？" });
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(db.values).toHaveBeenCalledWith({
        user_id: "test-user",
        muttering_id: "m-1",
        parent_id: "seed-1",
        processed_task: "机の上だけ片付ける",
        status: "pending",
      });
    });

    test("トランザクション内の親 UPDATE が0件（競合）なら alreadyReacted、子は挿入しない", async () => {
      db.executeTakeFirst
        .mockResolvedValueOnce({
          id: "seed-1",
          processed_task: "部屋を片付ける",
          muttering_id: "m-1",
        })
        .mockResolvedValueOnce({ intensity_level: "chill" })
        .mockResolvedValueOnce(undefined); // trx: 親 UPDATE が0件
      generateSoftenedTaskMock.mockResolvedValue({
        ok: true,
        softenedTask: "机の上だけ片付ける",
        reply: "...",
      });

      const result = await reactToNudge(asDb(db), {
        userId: "test-user",
        seedId: "seed-1",
        reaction: "softened",
      });

      expect(result).toEqual({ ok: true, alreadyReacted: true, reply: "" });
      expect(db.insertInto).not.toHaveBeenCalled();
    });
  });
});

describe("discardSeed", () => {
  test("pending の seed を archived へ更新できたら ok:true を返す", async () => {
    const db = createMockDb();
    db.executeTakeFirst.mockResolvedValueOnce({ id: "seed-1", status: "archived" });

    const result = await discardSeed(asDb(db), { userId: "test-user", seedId: "seed-1" });

    expect(result).toEqual({ ok: true });
    expect(db.updateTable).toHaveBeenCalledWith("seeds");
    expect(db.set).toHaveBeenCalledWith({ status: "archived", updated_at: expect.any(Date) });
    expect(db.where).toHaveBeenCalledWith("id", "=", "seed-1");
    expect(db.where).toHaveBeenCalledWith("user_id", "=", "test-user");
    expect(db.where).toHaveBeenCalledWith("status", "=", "pending");
  });

  test("対象が既に pending でない（競合で0行更新）なら ok:false を返す", async () => {
    const db = createMockDb();
    db.executeTakeFirst.mockResolvedValueOnce(undefined);

    const result = await discardSeed(asDb(db), { userId: "test-user", seedId: "seed-1" });

    expect(result).toEqual({ ok: false });
  });
});
