import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { env } from "./env";
import type { DB } from "./db-types";

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});
