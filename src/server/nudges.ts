import { createServerFn } from "@tanstack/react-start";
import type { Kysely } from "kysely";
import { z } from "zod";
import {
  ARCHIVED_REPLY,
  HOUSEKEEPING_THRESHOLD,
  MOOD_LOG_LIMIT,
  NUDGE_INTERVAL_HOURS,
  NUDGE_TIMEOUT_DAYS,
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
  | { kind: "nudge"; seed: NudgeSeed }
  | { kind: "housekeeping"; items: HousekeepingItem[] }
  | { kind: "review"; reply: string };

/** 新規ナッジの提案間隔（12時間）が経過しているか。未提案（null）なら常に経過扱い（設計書 §9.1） */
export function isIntervalElapsed(lastNudgedAt: Date | null, now: Date): boolean {
  if (lastNudgedAt === null) return true;
  return lastNudgedAt.getTime() + NUDGE_INTERVAL_HOURS * HOUR_MS <= now.getTime();
}

/**
 * 起動時のナッジ状態を解決する（設計書 §9.1, §9.4）。以下の順序を厳守する:
 * 1. タイムアウトした nudged を一括 archive
 * 2. 残った nudged があれば決定的に1件選んで再表示（重複耐性: 複数あっても壊れない）
 * 3. 新規提案間隔（12時間）が未経過なら kind:none（棚卸しもこの枠を使うため間隔判定の内側にある）
 * 4. 間隔経過済みなら: pending が閾値以上なら棚卸し、未満なら LLM で新規ナッジを選択
 */
export async function resolveNudgeState(
  db: Kysely<DB>,
  args: { userId: string; now?: Date },
): Promise<NudgeResolution> {
  const now = args.now ?? new Date();
  const { userId } = args;

  await archiveTimedOutNudges(db, userId, now);

  const redisplay = await pickNudgedSeed(db, userId);
  if (redisplay) {
    return { kind: "nudge", seed: redisplay };
  }

  const lastNudgedAt = await fetchLastNudgedAt(db, userId);
  if (!isIntervalElapsed(lastNudgedAt, now)) {
    return { kind: "none" };
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
    return { kind: "none" };
  }

  return await generateNewNudge(db, userId, now, pending);
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

  const completed = await db
    .selectFrom("seeds")
    .select(["processed_task", "prophecy"])
    .where("user_id", "=", userId)
    .where("status", "=", "completed")
    .where("updated_at", ">=", prevStartUtc)
    .where("updated_at", "<", currStartUtc)
    .orderBy("updated_at", "asc")
    .execute();

  // LLM 呼び出しに使う intensity は claim（書き込み）の前に取得する。claim 後に throw しうる
  // 処理を置くと、claim だけ成功して振り返りが失われるケースが生まれるため
  const intensity = await fetchIntensity(db, userId);

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
  // SEED_LIMIT（20件）による絞り込みは不要（常に閾値未満件数しか渡ってこない）
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

export type ReactionResult =
  | { ok: true; reply: string; alreadyReacted?: boolean }
  | { ok: false; reply: string };

/**
 * nudged 状態への反応を処理する（設計書 §3.3）。
 * completed / archived / softened いずれも `WHERE id=? AND user_id=? AND status='nudged'` の
 * 条件付き UPDATE で冪等に扱う。
 */
export async function reactToNudge(
  db: Kysely<DB>,
  args: { userId: string; seedId: string; reaction: ReactionKind },
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
  args: { userId: string; seedId: string },
): Promise<ReactionResult> {
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

  const intensity = await fetchIntensity(db, args.userId);
  const reply = await generateCompletionReply({
    task: updated.processed_task,
    prophecy: updated.prophecy,
    intensity,
  });

  return { ok: true, reply };
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
  return { ok: true, reply: ARCHIVED_REPLY[intensity === "sharp" ? "sharp" : "chill"] };
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
