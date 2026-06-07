import { createServerFn } from "@tanstack/react-start";
import type { Kysely } from "kysely";
import { z } from "zod";
import { createDb } from "./db";
import type { DB } from "./db-types";
import { authMiddleware } from "./middleware/auth";

export const getProfile = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const db = createDb();
    try {
      const existing = await db
        .selectFrom("profiles")
        .selectAll()
        .where("user_id", "=", context.userId)
        .executeTakeFirst();

      if (existing) return existing;

      return await db
        .insertInto("profiles")
        .values({ user_id: context.userId })
        .returningAll()
        .executeTakeFirstOrThrow();
    } finally {
      await db.destroy();
    }
  });

export const updateIntensityInput = z.object({
  intensity: z.enum(["chill", "sharp"]),
});

/** 熱度切り替えのコアロジック（設計書 §7） */
export async function setIntensity(
  db: Kysely<DB>,
  args: { userId: string; intensity: "chill" | "sharp" },
) {
  return await db
    .updateTable("profiles")
    .set({ intensity_level: args.intensity })
    .where("user_id", "=", args.userId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** ナッジーの熱度（Chill / Sharp）を切り替える */
export const updateIntensity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(updateIntensityInput)
  .handler(async ({ data, context }) => {
    const db = createDb();
    try {
      return await setIntensity(db, {
        userId: context.userId,
        intensity: data.intensity,
      });
    } finally {
      await db.destroy();
    }
  });
