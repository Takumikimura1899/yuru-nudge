import { createServerFn } from "@tanstack/react-start";
import type { Kysely } from "kysely";
import { z } from "zod";
import {
  ARCHIVED_REPLY,
  HOUSEKEEPING_THRESHOLD,
  MOOD_LOG_LIMIT,
  normalizeIntensity,
  NUDGE_INTERVAL_HOURS,
  NUDGE_TIMEOUT_DAYS,
  PARENT_REVIVED_REPLY,
  TALLY_MENTION_MIN_COUNT,
  TALLY_MENTION_PROBABILITY,
} from "./ai/constants";
import {
  generateCompletionReply,
  generateMonthlyReview,
  generateSoftenedTask,
  selectNudge,
} from "./ai/nudgey";
import { createDb } from "./db";
import type { DB } from "./db-types";
import { authMiddleware } from "./middleware/auth";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;

export type NudgeSeed = { seedId: string; task: string; prophecy: string };
export type HousekeepingItem = { seedId: string; task: string };
export type NudgeResolution =
  | { kind: "none" }
  | { kind: "empty" }
  | { kind: "nudge"; seed: NudgeSeed }
  | { kind: "housekeeping"; items: HousekeepingItem[] }
  | { kind: "review"; reply: string };

/** 新規ナッジの提案間隔（NUDGE_INTERVAL_HOURS）が経過しているか。未提案（null）なら常に経過扱い（設計書 §9.1） */
export function isIntervalElapsed(lastNudgedAt: Date | null, now: Date): boolean {
  if (lastNudgedAt === null) return true;
  return lastNudgedAt.getTime() + NUDGE_INTERVAL_HOURS * HOUR_MS <= now.getTime();
}

/**
 * 起動時のナッジ状態を解決する（設計書 §9.1, §9.4）。以下の順序を厳守する:
 * 1. タイムアウトした nudged を一括 archive
 * 2. 残った nudged があれば決定的に1件選んで再表示（重複耐性: 複数あっても壊れない）
 * 3. 新規提案間隔が未経過なら kind:none（棚卸しもこの枠を使うため間隔判定の内側にある）。
 *    手動ナッジ（skipInterval: true）はこの判定だけを飛ばし、他の順序・分岐は自動と同一に保つ
 * 4. 間隔経過済みなら: pending が閾値以上なら棚卸し、未満なら LLM で新規ナッジを選択。
 *    pending が0件のときは none と区別して kind:empty を返す（手動ナッジの「タネがない」応答に使う。
 *    none は間隔未経過・LLM 失敗・競合も含むため区別が必要）
 */
export async function resolveNudgeState(
  db: Kysely<DB>,
  args: { userId: string; now?: Date; skipInterval?: boolean },
): Promise<NudgeResolution> {
  const now = args.now ?? new Date();
  const { userId } = args;

  await archiveTimedOutNudges(db, userId, now);

  const redisplay = await pickNudgedSeed(db, userId);
  if (redisplay) {
    return { kind: "nudge", seed: redisplay };
  }

  if (!args.skipInterval) {
    const lastNudgedAt = await fetchLastNudgedAt(db, userId);
    if (!isIntervalElapsed(lastNudgedAt, now)) {
      return { kind: "none" };
    }
  }

  const pending = await fetchPendingSeeds(db, userId);
  if (pending.length >= HOUSEKEEPING_THRESHOLD) {
    return {
      kind: "housekeeping",
      items: pending.map((p) => ({ seedId: p.id, task: p.processed_task })),
    };
  }

  const review = await maybeResolveMonthlyReview(db, { userId, now });
  if (review) {
    return review;
  }

  if (pending.length === 0) {
    return { kind: "empty" };
  }

  return await generateNewNudge(db, userId, now, pending);
}

/**
 * 起動時以外のトリガーによるナッジ解決（設計書 §9.1）。
 * - manual: タネ袋の「なにか提案して」。間隔ゲートだけをスキップし、他は自動と同一フロー
 *   （nudged 再表示・棚卸し・月次振り返りも自動と同じ優先順位で発生しうる）
 * - firstSeed: タネ化直後の初回提案。一度でもナッジ済み（nudged_at が存在する）なら何もしない。
 *   未経験なら通常フローに委ねる（lastNudgedAt が null のため間隔は自然に経過扱いになる）
 */
export async function resolveRequestedNudge(
  db: Kysely<DB>,
  args: { userId: string; trigger: "manual" | "firstSeed"; now?: Date },
): Promise<NudgeResolution> {
  const { userId, now } = args;

  if (args.trigger === "firstSeed") {
    const lastNudgedAt = await fetchLastNudgedAt(db, userId);
    if (lastNudgedAt !== null) {
      return { kind: "none" };
    }
    return await resolveNudgeState(db, { userId, now });
  }

  return await resolveNudgeState(db, { userId, now, skipInterval: true });
}

/** JST基準の月ラベルと、前月/当月の開始UTC時刻を返す純関数（設計書 §9.3 の月次振り返り判定に使用） */
export function jstMonthRange(now: Date): {
  currentLabel: string;
  prevStartUtc: Date;
  currStartUtc: Date;
} {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  const currentLabel = `${year}-${String(month + 1).padStart(2, "0")}`;

  return {
    currentLabel,
    prevStartUtc: new Date(Date.UTC(year, month - 1, 1) - JST_OFFSET_MS),
    currStartUtc: new Date(Date.UTC(year, month, 1) - JST_OFFSET_MS),
  };
}

/**
 * 月次振り返り（設計書 §9.3 からの逸脱: 「当月分」ではなく「前月分」の completed seeds を引用する。
 * 月初表示時点では当月の completed が必ず空になる矛盾を避けるための判断。詳細は
 * docs/implementation-notes.md 参照）。
 * claim-then-generate で冪等化する: LLM 呼び出し前に last_review_month を条件付き UPDATE で確保し、
 * 0行（並行 resolve が先行して既に claim 済み）なら null を返す。
 */
async function maybeResolveMonthlyReview(
  db: Kysely<DB>,
  args: { userId: string; now: Date },
): Promise<NudgeResolution | null> {
  const { userId, now } = args;
  const { currentLabel, prevStartUtc, currStartUtc } = jstMonthRange(now);

  const profile = await db
    .selectFrom("profiles")
    .select("last_review_month")
    .where("user_id", "=", userId)
    .executeTakeFirst();

  if (profile?.last_review_month === currentLabel) {
    return null;
  }

  // 前月 completed の抽出と LLM 用 intensity の取得は互いに独立なので並列化する。
  // どちらも claim（書き込み）より前に実行する: claim 後に throw しうる処理を置くと、
  // claim だけ成功して振り返りが失われるケースが生まれるため
  const [completed, intensity] = await Promise.all([
    db
      .selectFrom("seeds")
      .select(["processed_task", "prophecy"])
      .where("user_id", "=", userId)
      .where("status", "=", "completed")
      .where("updated_at", ">=", prevStartUtc)
      .where("updated_at", "<", currStartUtc)
      .orderBy("updated_at", "asc")
      .execute(),
    fetchIntensity(db, userId),
  ]);

  // 単調ガード: `!=` ではなく `<` にする。'YYYY-MM' はゼロ埋め固定長で辞書順=時系列順（DB check制約で保証）。
  // 月境界のストラグラーが未来ラベルで claim した後に、正規タイミングのリクエストがラベルを
  // 巻き戻す ABA を防ぐ
  const claimed = await db
    .updateTable("profiles")
    .set({ last_review_month: currentLabel })
    .where("user_id", "=", userId)
    .where((eb) =>
      eb.or([eb("last_review_month", "is", null), eb("last_review_month", "<", currentLabel)]),
    )
    .returningAll()
    .executeTakeFirst();

  if (!claimed) {
    return null;
  }

  if (completed.length === 0) {
    return null;
  }

  const reply = await generateMonthlyReview({
    completed: completed.map((c) => ({ task: c.processed_task, prophecy: c.prophecy ?? "" })),
    intensity,
  });

  return { kind: "review", reply };
}

/**
 * nudged のままタイムアウト（7日）した seed を一括 archive する（設計書 §9.4）。
 * status='nudged' を UPDATE の WHERE 句自体で再チェックする単一の条件付き UPDATE にすることで、
 * SELECT→JSフィルタ→UPDATE の二往復と、その間に割り込む並行反応（例: completed）による
 * TOCTOU（上書き競合）を避ける。
 */
async function archiveTimedOutNudges(db: Kysely<DB>, userId: string, now: Date): Promise<void> {
  const timeoutCutoff = new Date(now.getTime() - NUDGE_TIMEOUT_DAYS * DAY_MS);

  await db
    .updateTable("seeds")
    .set({ status: "archived", updated_at: now })
    .where("user_id", "=", userId)
    .where("status", "=", "nudged")
    .where("nudged_at", "<", timeoutCutoff)
    .execute();
}

/** nudged が複数残っていても（一意性を仮定せず）決定的に1件を選ぶ */
async function pickNudgedSeed(db: Kysely<DB>, userId: string): Promise<NudgeSeed | null> {
  const row = await db
    .selectFrom("seeds")
    .select(["id", "processed_task", "prophecy"])
    .where("user_id", "=", userId)
    .where("status", "=", "nudged")
    .orderBy("nudged_at", "desc")
    .orderBy("id", "asc")
    .limit(1)
    .executeTakeFirst();

  if (!row) return null;

  return { seedId: row.id, task: row.processed_task, prophecy: row.prophecy ?? "" };
}

async function fetchPendingSeeds(
  db: Kysely<DB>,
  userId: string,
): Promise<{ id: string; processed_task: string }[]> {
  return await db
    .selectFrom("seeds")
    .select(["id", "processed_task"])
    .where("user_id", "=", userId)
    .where("status", "=", "pending")
    .orderBy("created_at", "asc")
    .execute();
}

export type PouchSeed = { seedId: string; task: string; status: "pending" | "nudged" };

/**
 * タネ袋（ヘッダー🌱ボタン）に表示する蓄積タネ（pending/nudged）一覧を取得する。
 * 並びは決定的に status（nudged→pending）→ created_at asc → id asc。created_at は並びにのみ使い、
 * 返り値には含めない（経過時間の可視化はプレッシャーになるため非表示方針）。
 */
export async function fetchPouchSeeds(db: Kysely<DB>, userId: string): Promise<PouchSeed[]> {
  const rows = await db
    .selectFrom("seeds")
    .select(["id", "processed_task", "status"])
    .where("user_id", "=", userId)
    .where("status", "in", ["pending", "nudged"])
    .orderBy((eb) => eb.case().when("status", "=", "nudged").then(0).else(1).end())
    .orderBy("created_at", "asc")
    .orderBy("id", "asc")
    .execute();

  return rows.map((row) => ({
    seedId: row.id,
    task: row.processed_task,
    status: row.status as PouchSeed["status"],
  }));
}

/** 全 status 横断で最後にナッジした日時（設計書 §9.1 の間隔判定に使う） */
async function fetchLastNudgedAt(db: Kysely<DB>, userId: string): Promise<Date | null> {
  const row = await db
    .selectFrom("seeds")
    .select("nudged_at")
    .where("user_id", "=", userId)
    .where("nudged_at", "is not", null)
    .orderBy("nudged_at", "desc")
    .limit(1)
    .executeTakeFirst();

  return row?.nudged_at ?? null;
}

async function fetchIntensity(db: Kysely<DB>, userId: string): Promise<string> {
  const profile = await db
    .selectFrom("profiles")
    .select("intensity_level")
    .where("user_id", "=", userId)
    .executeTakeFirst();

  return profile?.intensity_level ?? "chill";
}

async function fetchRecentMoods(db: Kysely<DB>, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("mutterings")
    .select("content")
    .where("user_id", "=", userId)
    .where("category", "=", "mood")
    .orderBy("created_at", "desc")
    .limit(MOOD_LOG_LIMIT)
    .execute();

  return rows.map((r) => r.content);
}

async function generateNewNudge(
  db: Kysely<DB>,
  userId: string,
  now: Date,
  pending: { id: string; processed_task: string }[],
): Promise<NudgeResolution> {
  // 呼び出し元で pending.length < HOUSEKEEPING_THRESHOLD を保証済みのため
  // 件数上限による絞り込みは不要（常に閾値未満件数しか渡ってこない）
  const candidates = pending.map((p) => ({ seedId: p.id, task: p.processed_task }));

  const [intensity, moods] = await Promise.all([
    fetchIntensity(db, userId),
    fetchRecentMoods(db, userId),
  ]);

  const selected = await selectNudge({ candidates, moods, intensity });
  if (!selected.ok) {
    return { kind: "none" };
  }

  const updated = await db
    .updateTable("seeds")
    .set({ status: "nudged", prophecy: selected.prophecy, nudged_at: now, updated_at: now })
    .where("id", "=", selected.seedId)
    .where("status", "=", "pending")
    .returningAll()
    .executeTakeFirst();

  if (!updated) {
    return { kind: "none" };
  }

  return {
    kind: "nudge",
    seed: {
      seedId: updated.id,
      task: updated.processed_task,
      prophecy: updated.prophecy ?? selected.prophecy,
    },
  };
}

export type ReactionKind = "completed" | "softened" | "archived";

export type ParentSuggestion = { parentSeedId: string; parentTask: string };

export type ReactionResult =
  | { ok: true; reply: string; alreadyReacted?: boolean; parentSuggestion?: ParentSuggestion }
  | { ok: false; reply: string };

/**
 * nudged 状態への反応を処理する（設計書 §3.3）。
 * completed / archived / softened いずれも `WHERE id=? AND user_id=? AND status='nudged'` の
 * 条件付き UPDATE で冪等に扱う。
 */
export async function reactToNudge(
  db: Kysely<DB>,
  args: { userId: string; seedId: string; reaction: ReactionKind; random?: () => number },
): Promise<ReactionResult> {
  switch (args.reaction) {
    case "completed":
      return await reactCompleted(db, args);
    case "archived":
      return await reactArchived(db, args);
    case "softened":
      return await reactSoftened(db, args);
  }
}

const ALREADY_REACTED: ReactionResult = { ok: true, alreadyReacted: true, reply: "" };

async function reactCompleted(
  db: Kysely<DB>,
  args: { userId: string; seedId: string; random?: () => number },
): Promise<ReactionResult> {
  const random = args.random ?? Math.random;

  const updated = await db
    .updateTable("seeds")
    .set({ status: "completed", updated_at: new Date() })
    .where("id", "=", args.seedId)
    .where("user_id", "=", args.userId)
    .where("status", "=", "nudged")
    .returningAll()
    .executeTakeFirst();

  if (!updated) {
    return ALREADY_REACTED;
  }

  // fetchIntensity / maybeFetchCompletedCount / maybeFetchParentSuggestion は互いに独立なので並列化する。
  // generateCompletionReply は intensity と completedCount に依存するためその後に呼ぶ
  const [intensity, completedCount, parentSuggestion] = await Promise.all([
    fetchIntensity(db, args.userId),
    maybeFetchCompletedCount(db, args.userId, random),
    maybeFetchParentSuggestion(db, args.userId, updated.parent_id),
  ]);
  const reply = await generateCompletionReply({
    task: updated.processed_task,
    prophecy: updated.prophecy,
    intensity,
    completedCount,
  });

  return { ok: true, reply, ...(parentSuggestion ? { parentSuggestion } : {}) };
}

/**
 * 完了した seed に親（softened で再提案待ち）がいれば、再提案カードに使う材料を返す（設計書 §3.4）。
 * `status='softened'` 条件の SELECT でヒットしたときのみ返すため、親が既に archived 等になっていれば
 * 自然に suggestion なしになる（子の完了後に親が別経路で状態遷移していても壊れない）。
 */
async function maybeFetchParentSuggestion(
  db: Kysely<DB>,
  userId: string,
  parentId: string | null,
): Promise<ParentSuggestion | null> {
  if (!parentId) return null;

  const parent = await db
    .selectFrom("seeds")
    .select(["id", "processed_task"])
    .where("id", "=", parentId)
    .where("user_id", "=", userId)
    .where("status", "=", "softened")
    .executeTakeFirst();

  if (!parent) return null;

  return { parentSeedId: parent.id, parentTask: parent.processed_task };
}

/**
 * 累計セリフ織り込み（設計書 §8.2, §10.2）の対象件数を確率的に取得する。
 * ロールに外れた場合は COUNT クエリ自体を打たない（不要なDB往復を避ける）。
 * postgres.js は COUNT を string で返すため Number() cast が必須。
 */
async function maybeFetchCompletedCount(
  db: Kysely<DB>,
  userId: string,
  random: () => number,
): Promise<number | null> {
  if (random() >= TALLY_MENTION_PROBABILITY) {
    return null;
  }

  const row = await db
    .selectFrom("seeds")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("user_id", "=", userId)
    .where("status", "=", "completed")
    .executeTakeFirst();

  const count = Number(row?.count ?? 0);
  return count >= TALLY_MENTION_MIN_COUNT ? count : null;
}

async function reactArchived(
  db: Kysely<DB>,
  args: { userId: string; seedId: string },
): Promise<ReactionResult> {
  const updated = await db
    .updateTable("seeds")
    .set({ status: "archived", updated_at: new Date() })
    .where("id", "=", args.seedId)
    .where("user_id", "=", args.userId)
    .where("status", "=", "nudged")
    .returningAll()
    .executeTakeFirst();

  if (!updated) {
    return ALREADY_REACTED;
  }

  const intensity = await fetchIntensity(db, args.userId);
  return { ok: true, reply: ARCHIVED_REPLY[normalizeIntensity(intensity)] };
}

async function reactSoftened(
  db: Kysely<DB>,
  args: { userId: string; seedId: string },
): Promise<ReactionResult> {
  // LLM 呼び出しに使うタスク文言を先に取得する。対象が nudged でなければ LLM を呼ばず即座に返す
  const current = await db
    .selectFrom("seeds")
    .select(["id", "processed_task", "muttering_id"])
    .where("id", "=", args.seedId)
    .where("user_id", "=", args.userId)
    .where("status", "=", "nudged")
    .executeTakeFirst();

  if (!current) {
    return ALREADY_REACTED;
  }

  const intensity = await fetchIntensity(db, args.userId);
  const softened = await generateSoftenedTask({ task: current.processed_task, intensity });

  if (!softened.ok) {
    return { ok: false, reply: softened.reply };
  }

  return await db.transaction().execute(async (trx) => {
    const updatedParent = await trx
      .updateTable("seeds")
      .set({ status: "softened", updated_at: new Date() })
      .where("id", "=", args.seedId)
      .where("user_id", "=", args.userId)
      .where("status", "=", "nudged")
      .returningAll()
      .executeTakeFirst();

    if (!updatedParent) {
      return ALREADY_REACTED;
    }

    await trx
      .insertInto("seeds")
      .values({
        user_id: args.userId,
        muttering_id: updatedParent.muttering_id,
        parent_id: updatedParent.id,
        processed_task: softened.softenedTask,
        status: "pending",
      })
      .execute();

    return { ok: true, reply: softened.reply };
  });
}

/**
 * 棚卸しで「もういいや」と判断された pending seed を破棄する（設計書 §5.2）。keep はこの fn を呼ばない no-op。
 * 条件付き UPDATE の影響行数を確認し、対象が既に pending でなかった（並行操作で nudged 化等）場合は
 * ok:false を返す（UI 側は行を消さず操作可能な状態に戻す）。
 */
export async function discardSeed(
  db: Kysely<DB>,
  args: { userId: string; seedId: string },
): Promise<{ ok: true } | { ok: false }> {
  const updated = await db
    .updateTable("seeds")
    .set({ status: "archived", updated_at: new Date() })
    .where("id", "=", args.seedId)
    .where("user_id", "=", args.userId)
    .where("status", "=", "pending")
    .returningAll()
    .executeTakeFirst();

  return updated ? { ok: true } : { ok: false };
}

/**
 * 親タスクの再提案カードで「やってみる」が選ばれたとき、親 seed を softened から pending に戻す
 * （設計書 §3.4）。`status='softened'` 条件付き UPDATE で冪等化し、0行なら既に処理済み（別タブ操作等）
 * として alreadyReacted を返す。即時ナッジはしない（自動復帰ではない）ため LLM は呼ばず静的応答を返す。
 */
export async function reviveParent(
  db: Kysely<DB>,
  args: { userId: string; seedId: string },
): Promise<ReactionResult> {
  const updated = await db
    .updateTable("seeds")
    .set({ status: "pending", updated_at: new Date() })
    .where("id", "=", args.seedId)
    .where("user_id", "=", args.userId)
    .where("status", "=", "softened")
    .returningAll()
    .executeTakeFirst();

  if (!updated) {
    return ALREADY_REACTED;
  }

  const intensity = await fetchIntensity(db, args.userId);
  return { ok: true, reply: PARENT_REVIVED_REPLY[normalizeIntensity(intensity)] };
}

/** アプリ起動時のナッジ状態解決（タイムアウト archive を含む） */
export const resolveNudge = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const db = createDb();
    try {
      return await resolveNudgeState(db, { userId: context.userId });
    } finally {
      await db.destroy();
    }
  });

export const requestNudgeInput = z.object({
  trigger: z.enum(["manual", "firstSeed"]),
});

/** 起動時以外のナッジ解決リクエスト（タネ袋の手動ナッジ / タネ化直後の初回提案） */
export const requestNudge = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(requestNudgeInput)
  .handler(async ({ data, context }) => {
    const db = createDb();
    try {
      return await resolveRequestedNudge(db, { userId: context.userId, trigger: data.trigger });
    } finally {
      await db.destroy();
    }
  });

export const postReactionInput = z.object({
  seedId: z.string().uuid(),
  reaction: z.enum(["completed", "softened", "archived"]),
});

/** nudged タスクへの反応（やったよ / 難しい / いらない）を送信する */
export const postReaction = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(postReactionInput)
  .handler(async ({ data, context }) => {
    const db = createDb();
    try {
      return await reactToNudge(db, {
        userId: context.userId,
        seedId: data.seedId,
        reaction: data.reaction,
      });
    } finally {
      await db.destroy();
    }
  });

export const postDiscardInput = z.object({
  seedId: z.string().uuid(),
});

/** 棚卸しで pending seed を破棄する（「もういいや」） */
export const postDiscard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(postDiscardInput)
  .handler(async ({ data, context }) => {
    const db = createDb();
    try {
      return await discardSeed(db, { userId: context.userId, seedId: data.seedId });
    } finally {
      await db.destroy();
    }
  });

export const postReviveParentInput = z.object({
  parentSeedId: z.string().uuid(),
});

/** 親タスクの再提案カードで「やってみる」を選んだときに送信する */
export const postReviveParent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(postReviveParentInput)
  .handler(async ({ data, context }) => {
    const db = createDb();
    try {
      return await reviveParent(db, { userId: context.userId, seedId: data.parentSeedId });
    } finally {
      await db.destroy();
    }
  });

/** タネ袋（ヘッダー🌱ボタン）を開いたときに蓄積タネ一覧を取得する */
export const getSeedPouch = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const db = createDb();
    try {
      return await fetchPouchSeeds(db, context.userId);
    } finally {
      await db.destroy();
    }
  });
