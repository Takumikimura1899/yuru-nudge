import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { env } from "./env";
import type { DB } from "./db-types";

// Cloudflare Workers / miniflare は I/O オブジェクト（DB 接続を含む）を
// リクエスト境界を越えて再利用できないため、リクエスト毎に新しい Kysely を作る。
// ハンドラ側は使い終わったら `db.destroy()` を呼ぶ。
export function createDb(): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresJSDialect({
      postgres: postgres(env.DATABASE_URL, { max: 1 }),
    }),
  });
}
