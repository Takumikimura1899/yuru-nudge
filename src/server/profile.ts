import { createServerFn } from "@tanstack/react-start";
import { createDb } from "./db";
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
