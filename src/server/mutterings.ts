import { createServerFn } from "@tanstack/react-start";
import type { Kysely } from "kysely";
import { z } from "zod";
import { MAX_CONTENT_LENGTH, MOOD_LOG_LIMIT, TIMELINE_LIMIT } from "./ai/constants";
import { classifyAndReply } from "./ai/nudgey";
import { createDb } from "./db";
import type { DB } from "./db-types";
import { authMiddleware } from "./middleware/auth";

export const postMutterInput = z.object({
  content: z.string().trim().min(1).max(MAX_CONTENT_LENGTH),
});

export type PostMutterResult =
  | {
      ok: true;
      muttering: Awaited<ReturnType<typeof insertMuttering>>;
      processedTask: string | null;
    }
  | { ok: false; reply: string };

/**
 * つぶやき投稿のコアロジック。LLM で seed/mood 分類 + ナッジー応答を生成し、
 * mutterings（+ seed なら seeds）へ保存する。mood は直近 30 件のみ保持。
 * LLM 失敗時は何も保存せず、キャラ内エラー応答だけを返す（設計書 §4.5）。
 */
export async function processMutter(
  db: Kysely<DB>,
  args: { userId: string; content: string },
): Promise<PostMutterResult> {
  const profile = await db
    .selectFrom("profiles")
    .select("intensity_level")
    .where("user_id", "=", args.userId)
    .executeTakeFirst();

  // LLM 呼び出しはトランザクション外（ネットワーク I/O を tx に巻き込まない）
  const result = await classifyAndReply({
    content: args.content,
    intensity: profile?.intensity_level ?? "chill",
  });

  if (!result.ok) {
    return { ok: false, reply: result.reply };
  }

  const muttering = await db.transaction().execute(async (trx) => {
    const saved = await insertMuttering(trx, {
      userId: args.userId,
      content: args.content,
      category: result.data.category,
      reply: result.data.reply,
    });

    if (result.data.category === "seed" && result.data.processed_task) {
      await trx
        .insertInto("seeds")
        .values({
          user_id: args.userId,
          muttering_id: saved.id,
          processed_task: result.data.processed_task,
        })
        .execute();
    }

    if (result.data.category === "mood") {
      // 直近 MOOD_LOG_LIMIT 件に入らない古い mood を削除（設計書 §6.1）
      await trx
        .deleteFrom("mutterings")
        .where("user_id", "=", args.userId)
        .where("category", "=", "mood")
        .where("id", "not in", (eb) =>
          eb
            .selectFrom("mutterings")
            .select("id")
            .where("user_id", "=", args.userId)
            .where("category", "=", "mood")
            .orderBy("created_at", "desc")
            .limit(MOOD_LOG_LIMIT),
        )
        .execute();
    }

    return saved;
  });

  return {
    ok: true,
    muttering,
    processedTask: result.data.category === "seed" ? result.data.processed_task : null,
  };
}

function insertMuttering(
  db: Kysely<DB>,
  args: { userId: string; content: string; category: string; reply: string },
) {
  return db
    .insertInto("mutterings")
    .values({
      user_id: args.userId,
      content: args.content,
      category: args.category,
      reply: args.reply,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** チャットタイムライン用に直近 20 件のつぶやき（1件 = 1往復）を古い順で返す */
export async function fetchTimeline(db: Kysely<DB>, userId: string) {
  const rows = await db
    .selectFrom("mutterings")
    .select((eb) => [
      "id",
      "content",
      "category",
      "reply",
      "created_at",
      // 原本 seed（parent_id が null）の processed_task を返す。leftJoin ではなくスカラサブクエリ
      // にしているのは、緩和版の子 seed が親と同じ muttering_id を継承するため join だと行が
      // 重複増殖するのを避けるため（原本に限定すれば高々1行）
      eb
        .selectFrom("seeds")
        .select("processed_task")
        .whereRef("seeds.muttering_id", "=", "mutterings.id")
        .where("seeds.parent_id", "is", null)
        .as("processed_task"),
    ])
    .where("user_id", "=", userId)
    .orderBy("created_at", "desc")
    .limit(TIMELINE_LIMIT)
    .execute();
  return rows.reverse();
}

export const postMutter = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(postMutterInput)
  .handler(async ({ data, context }) => {
    const db = createDb();
    try {
      return await processMutter(db, {
        userId: context.userId,
        content: data.content,
      });
    } finally {
      await db.destroy();
    }
  });

export const getTimeline = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const db = createDb();
    try {
      return await fetchTimeline(db, context.userId);
    } finally {
      await db.destroy();
    }
  });
