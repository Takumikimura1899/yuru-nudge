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
const generateMonthlyReviewMock = vi.fn();
vi.mock("./ai/nudgey", () => ({
  selectNudge: (...args: unknown[]) => selectNudgeMock(...args),
  generateCompletionReply: (...args: unknown[]) => generateCompletionReplyMock(...args),
  generateSoftenedTask: (...args: unknown[]) => generateSoftenedTaskMock(...args),
  generateMonthlyReview: (...args: unknown[]) => generateMonthlyReviewMock(...args),
}));

const { isIntervalElapsed, jstMonthRange, resolveNudgeState, reactToNudge, discardSeed } =
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
/** NOW（JST 2026-07-18 21:00）が属する月ラベル。「表示済み月」を装うテストのモック値に使う */
const CURRENT_LABEL = jstMonthRange(NOW).currentLabel;

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

describe("jstMonthRange", () => {
  test("JST基準で月末16:00Z（=翌月1日01:00 JST）を跨ぐと当月ラベルが翌月になる", () => {
    const result = jstMonthRange(new Date("2026-07-31T16:00:00Z"));
    expect(result.currentLabel).toBe("2026-08");
  });

  test("境界の直前（14:59:59Z、JST 7/31 23:59:59）はまだ当月ラベルのまま", () => {
    const result = jstMonthRange(new Date("2026-07-31T14:59:59Z"));
    expect(result.currentLabel).toBe("2026-07");
  });

  test("currStartUtc は当月1日0時JSTのUTC時刻、prevStartUtc は前月1日0時JSTのUTC時刻", () => {
    const result = jstMonthRange(new Date("2026-07-31T16:00:00Z"));
    expect(result.currStartUtc).toEqual(new Date("2026-07-31T15:00:00Z"));
    expect(result.prevStartUtc).toEqual(new Date("2026-06-30T15:00:00Z"));
  });

  test("年またぎ（1月）でも前月ラベル・開始時刻を正しく計算する", () => {
    const result = jstMonthRange(new Date("2026-01-15T00:00:00Z"));
    expect(result.currentLabel).toBe("2026-01");
    expect(result.prevStartUtc).toEqual(new Date("2025-11-30T15:00:00Z"));
  });
});

describe("resolveNudgeState", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    selectNudgeMock.mockReset();
    generateCompletionReplyMock.mockReset();
    generateSoftenedTaskMock.mockReset();
    generateMonthlyReviewMock.mockReset();
  });

  test("タイムアウトした nudged を条件付き UPDATE で一括 archive する（status 再チェックで TOCTOU を回避）", async () => {
    db.execute
      .mockResolvedValueOnce(undefined) // archive UPDATE（戻り値は不使用）
      .mockResolvedValueOnce([]); // fetchPendingSeeds
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined) // pickNudgedSeed
      .mockResolvedValueOnce(undefined) // fetchLastNudgedAt（未提案 → 経過扱い）
      .mockResolvedValueOnce({ last_review_month: CURRENT_LABEL }); // maybeResolveMonthlyReview: 表示済みとしてskip

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
    // 棚卸しはナッジ枠を先取りするため、月次振り返りの判定（profile SELECT 含む）にも到達しない
    expect(generateMonthlyReviewMock).not.toHaveBeenCalled();
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
    // 12時間ゲート未経過なら月次振り返りの判定にも到達しない
    expect(generateMonthlyReviewMock).not.toHaveBeenCalled();
  });

  test("pending が0件なら none", async () => {
    db.execute
      .mockResolvedValueOnce(undefined) // archive UPDATE
      .mockResolvedValueOnce([]); // fetchPendingSeeds
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined) // pickNudgedSeed
      .mockResolvedValueOnce(undefined) // fetchLastNudgedAt
      .mockResolvedValueOnce({ last_review_month: CURRENT_LABEL }); // maybeResolveMonthlyReview: 表示済みとしてskip

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
      .mockResolvedValueOnce({ last_review_month: CURRENT_LABEL }) // maybeResolveMonthlyReview: 表示済みとしてskip
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
      .mockResolvedValueOnce({ last_review_month: CURRENT_LABEL }) // maybeResolveMonthlyReview: 表示済みとしてskip
      .mockResolvedValueOnce({ intensity_level: "chill" });
    selectNudgeMock.mockResolvedValue({ ok: false });

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({ kind: "none" });
    expect(db.executeTakeFirst).toHaveBeenCalledTimes(4); // 最終 UPDATE は呼ばれない
  });

  test("選択後の条件付き UPDATE が0件（競合で既に処理済み）なら none", async () => {
    db.execute
      .mockResolvedValueOnce(undefined) // archive UPDATE
      .mockResolvedValueOnce([createPendingSeed()]) // fetchPendingSeeds
      .mockResolvedValueOnce([]); // fetchRecentMoods
    db.executeTakeFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ last_review_month: CURRENT_LABEL }) // maybeResolveMonthlyReview: 表示済みとしてskip
      .mockResolvedValueOnce({ intensity_level: "chill" })
      .mockResolvedValueOnce(undefined); // 最終 UPDATE が0件
    selectNudgeMock.mockResolvedValue({ ok: true, seedId: "seed-1", prophecy: "..." });

    const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

    expect(result).toEqual({ kind: "none" });
  });

  describe("月次振り返り", () => {
    test("表示済み月（last_review_month === currentLabel）は SELECT のみで、前月分の抽出や claim は行わない", async () => {
      db.execute
        .mockResolvedValueOnce(undefined) // archive UPDATE
        .mockResolvedValueOnce([]); // fetchPendingSeeds
      db.executeTakeFirst
        .mockResolvedValueOnce(undefined) // pickNudgedSeed
        .mockResolvedValueOnce(undefined) // fetchLastNudgedAt
        .mockResolvedValueOnce({ last_review_month: CURRENT_LABEL }); // profile: 表示済み

      const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

      expect(result).toEqual({ kind: "none" });
      expect(db.execute).toHaveBeenCalledTimes(2); // 前月 completed の抽出（3回目の execute）は呼ばれない
      expect(generateMonthlyReviewMock).not.toHaveBeenCalled();
    });

    test("pending が0件でも前月 completed があれば claim に成功して review を返す（棚卸し判定の後・pending 0 チェックの前に判定するため）", async () => {
      const completedRows = [
        { processed_task: "部屋を片付ける", prophecy: "片付いた部屋、気持ちいいかも" },
        { processed_task: "本を読む", prophecy: null },
      ];
      db.execute
        .mockResolvedValueOnce(undefined) // archive UPDATE
        .mockResolvedValueOnce([]) // fetchPendingSeeds（0件）
        .mockResolvedValueOnce(completedRows); // 前月 completed の抽出
      db.executeTakeFirst
        .mockResolvedValueOnce(undefined) // pickNudgedSeed
        .mockResolvedValueOnce(undefined) // fetchLastNudgedAt
        .mockResolvedValueOnce({ last_review_month: null }) // profile: 未振り返り
        .mockResolvedValueOnce({ intensity_level: "sharp" }) // fetchIntensity（claimより前）
        .mockResolvedValueOnce({ user_id: "test-user", last_review_month: CURRENT_LABEL }); // claim成功
      generateMonthlyReviewMock.mockResolvedValue("先月の予言、2つ叶ったねぇ");

      const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

      expect(result).toEqual({ kind: "review", reply: "先月の予言、2つ叶ったねぇ" });
      expect(db.set).toHaveBeenCalledWith({ last_review_month: CURRENT_LABEL });
      expect(generateMonthlyReviewMock).toHaveBeenCalledWith({
        completed: [
          { task: "部屋を片付ける", prophecy: "片付いた部屋、気持ちいいかも" },
          { task: "本を読む", prophecy: "" },
        ],
        intensity: "sharp",
      });
    });

    test("claim（条件付き UPDATE）が0行（並行 resolve が先行して既に claim 済み）なら review なし", async () => {
      db.execute
        .mockResolvedValueOnce(undefined) // archive UPDATE
        .mockResolvedValueOnce([]) // fetchPendingSeeds
        .mockResolvedValueOnce([{ processed_task: "部屋を片付ける", prophecy: "..." }]); // 前月 completed あり
      db.executeTakeFirst
        .mockResolvedValueOnce(undefined) // pickNudgedSeed
        .mockResolvedValueOnce(undefined) // fetchLastNudgedAt
        .mockResolvedValueOnce({ last_review_month: null }) // profile: 未振り返り
        .mockResolvedValueOnce({ intensity_level: "chill" }) // fetchIntensity
        .mockResolvedValueOnce(undefined); // claim UPDATE が0行

      const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

      expect(result).toEqual({ kind: "none" });
      expect(generateMonthlyReviewMock).not.toHaveBeenCalled();
    });

    test("last_review_month が currentLabel より未来ラベルのとき claim 0行（単調性回帰: `!=` ではなく `<` ガードで守る）", async () => {
      db.execute
        .mockResolvedValueOnce(undefined) // archive UPDATE
        .mockResolvedValueOnce([]) // fetchPendingSeeds
        .mockResolvedValueOnce([{ processed_task: "部屋を片付ける", prophecy: "..." }]); // 前月 completed あり
      db.executeTakeFirst
        .mockResolvedValueOnce(undefined) // pickNudgedSeed
        .mockResolvedValueOnce(undefined) // fetchLastNudgedAt
        .mockResolvedValueOnce({ last_review_month: "2026-08" }) // 未来ラベル（月境界のストラグラーが先行 claim 済み）
        .mockResolvedValueOnce({ intensity_level: "chill" }) // fetchIntensity
        .mockResolvedValueOnce(undefined); // claim UPDATE: 実DBなら `<` ガードで0行（`!=` だと誤って通ってしまう）

      const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

      expect(result).toEqual({ kind: "none" });
      expect(generateMonthlyReviewMock).not.toHaveBeenCalled();
    });

    test("前月 completed が0件なら claim だけして review なし（同月中は再チェックされない）", async () => {
      db.execute
        .mockResolvedValueOnce(undefined) // archive UPDATE
        .mockResolvedValueOnce([]) // fetchPendingSeeds
        .mockResolvedValueOnce([]); // 前月 completed 0件
      db.executeTakeFirst
        .mockResolvedValueOnce(undefined) // pickNudgedSeed
        .mockResolvedValueOnce(undefined) // fetchLastNudgedAt
        .mockResolvedValueOnce({ last_review_month: null }) // profile: 未振り返り
        .mockResolvedValueOnce({ intensity_level: "chill" }) // fetchIntensity
        .mockResolvedValueOnce({ user_id: "test-user", last_review_month: CURRENT_LABEL }); // claim成功

      const result = await resolveNudgeState(asDb(db), { userId: "test-user", now: NOW });

      expect(result).toEqual({ kind: "none" });
      expect(db.set).toHaveBeenCalledWith({ last_review_month: CURRENT_LABEL });
      expect(generateMonthlyReviewMock).not.toHaveBeenCalled();
    });
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
