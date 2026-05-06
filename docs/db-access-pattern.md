# DB アクセスパターン

ゆるなっじにおける DB アクセスの設計方針と実装パターンをまとめる。
環境差分（ローカル / 本番）の話は [`./supabase-environments.md`](./supabase-environments.md) に分離。

---

## 1. 設計原則

| 原則                                     | 理由                                                                               |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| クライアントから DB に直接アクセスしない | 認証・入力検証・ログ等を一箇所で扱うため。RLS に頼らない設計を可能にする           |
| 全アクセスは Server Function 経由        | TanStack Start の `createServerFn` を唯一の入口にする                              |
| RLS は使わない                           | Server Function が唯一の窓口なので不要。代わりに Bearer / Cookie 認証で API を守る |
| 接続は **per-request** で開いて閉じる    | Cloudflare Workers の I/O 制約（後述）                                             |
| Kysely でクエリを書く                    | 型安全。kysely-codegen で DB スキーマ → TS 型を自動生成                            |
| マイグレーションは Supabase CLI で管理   | `supabase migration new` → SQL 編集 → ローカルで `db reset` → 本番に `db push`     |

---

## 2. レイヤ構造

```
ブラウザ ──HTTP──> TanStack Start (Worker)
                    ├── 1. request middleware (sessionMiddleware)
                    │     └── Set-Cookie 発行
                    ├── 2. server fn invocation
                    │     ├── authMiddleware（HTTP 境界のみ）
                    │     └── handler
                    │          ├── createDb()  ◆ per-request
                    │          ├── Kysely クエリ
                    │          └── finally db.destroy()
                    └── 3. Response
                         │
                         ▼
                    PostgreSQL（local: 127.0.0.1:54322 / prod: Supavisor 6543）
```

実体ファイル：

- `src/server/db.ts` — `createDb()` ファクトリ
- `src/server/db-types.ts` — kysely-codegen 出力（自動生成、手で編集しない）
- `src/server/profile.ts`（と将来の `mutterings.ts` / `seeds.ts`） — 各 server fn

---

## 3. なぜ per-request で接続を作るのか

Cloudflare Workers / miniflare には **「I/O オブジェクトはリクエスト境界を越えて再利用できない」** という制約がある。モジュールレベルで `pg.Pool` や `postgres()` のクライアントを作ってしまうと、最初のリクエストで使った接続を 2 回目のリクエストで使おうとした瞬間に：

```
Cannot perform I/O on behalf of a different request.
I/O objects ... created in the context of one request handler
cannot be accessed from a different request's handler.
```

で死ぬ。詳細経緯は [`./implementation-notes.md`](./implementation-notes.md) の「DB ドライバ周り」を参照。

対応として、`src/server/db.ts` は **`createDb()` を export** する：

```ts
// src/server/db.ts
import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import { env } from "./env";
import type { DB } from "./db-types";

export function createDb(): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresJSDialect({
      postgres: postgres(env.DATABASE_URL, { max: 1 }),
    }),
  });
}
```

各 server fn ハンドラの最初で呼び、`finally` で `destroy()`：

```ts
// src/server/profile.ts
.handler(async ({ context }) => {
  const db = createDb();
  try {
    // ... クエリ
    return result;
  } finally {
    await db.destroy();
  }
});
```

> プールが 1 接続しかなくても、ローカル / Workers どちらでも安定して動く。本番で性能が問題になれば **Supavisor pooler の transaction mode**（接続側のプーリングはサーバ側でまとめて行う）に頼る前提なので、アプリ側は簡単で良い。

---

## 4. Kysely の使い方

### 4.1 SELECT

```ts
const profile = await db
  .selectFrom("profiles")
  .selectAll()
  .where("user_id", "=", userId)
  .executeTakeFirst(); // 0 or 1 件 → undefined or row
```

| メソッド                    | 戻り値                | 使い分け                           |
| --------------------------- | --------------------- | ---------------------------------- |
| `executeTakeFirst()`        | `T \| undefined`      | 「あれば返す、無ければ undefined」 |
| `executeTakeFirstOrThrow()` | `T`（無ければ throw） | 「絶対あるはず」というケース       |
| `execute()`                 | `T[]`                 | リスト取得                         |

### 4.2 INSERT

```ts
const created = await db
  .insertInto("seeds")
  .values({
    user_id: userId,
    muttering_id: mutteringId,
    processed_task: "...",
    // status は default 'pending'
  })
  .returningAll()
  .executeTakeFirstOrThrow();
```

### 4.3 UPDATE

```ts
await db
  .updateTable("seeds")
  .set({ status: "completed", updated_at: new Date() })
  .where("id", "=", seedId)
  .where("user_id", "=", userId)
  .execute();
```

> **必ず `user_id` も where 条件に入れる**。MVP は固定ユーザーだが、将来 Supabase Auth に移行したとき他人のデータを誤って触らないようにするため。

### 4.4 トランザクション

```ts
await db.transaction().execute(async (trx) => {
  const muttering = await trx
    .insertInto("mutterings")
    .values(...)
    .returningAll()
    .executeTakeFirstOrThrow();

  await trx
    .insertInto("seeds")
    .values({ muttering_id: muttering.id, ... })
    .execute();
});
```

つぶやき保存と seed 作成のように、**「全部成功か全部失敗」が必要なときに使う**。

---

## 5. 型自動生成のフロー

`bun run db:gen` が以下を実行：

```
kysely-codegen \
  --dialect postgres \
  --include-pattern 'public.*' \   ← Supabase 内部スキーマ（auth/storage 等）を除外
  --env-file=.env.local \
  --out-file src/server/db-types.ts
```

タイミング：

1. **マイグレーションを追加・変更したら必ず実行**（テーブル定義と TS 型のズレを防ぐ）
2. 別ブランチから取り込んだ後（誰かが migration を増やしている可能性）

> 出力ファイル `src/server/db-types.ts` は oxfmt の対象外。手書き編集禁止。

---

## 6. マイグレーション運用

### 6.1 新しいスキーマ変更を入れる

```bash
bun run db:migrate:new add_some_column
# → supabase/migrations/<timestamp>_add_some_column.sql が生成される
```

生成された SQL を編集（CREATE / ALTER / CREATE INDEX 等）。

### 6.2 ローカルで適用

```bash
bun run db:reset
```

> `db:reset` は **DB を作り直して** `migrations/` 配下の SQL を順に適用する。**ローカルのデータは消える**。本番には適用しない（弾かれる）。

### 6.3 Kysely 型を更新

```bash
bun run db:gen
```

`src/server/db-types.ts` が更新される。差分を確認してコミット。

### 6.4 本番に push

詳細は [`./supabase-environments.md`](./supabase-environments.md) §2.4。要点：

```bash
supabase link --project-ref <ref>   # 初回のみ
supabase db push                    # 差分のみ適用、確認プロンプトあり
```

---

## 7. データモデル不変条件（コードで担保するルール）

[`docs/design/detailed-design.md`](./design/detailed-design.md) §13 の補足として、**実装側で守る不変条件**：

| ルール                                                | どこで担保                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `mutterings.content` は 140 文字まで                  | DB の CHECK 制約 + 入力 form の maxLength + zod                        |
| `mutterings.category` は `seed` か `mood` のみ        | DB の CHECK 制約                                                       |
| `seeds.status` は 5 値のみ                            | DB の CHECK 制約                                                       |
| `seeds.parent_id` は同じ user_id の seed しか指さない | アプリケーション側で `where user_id` を必ず付けて担保（DB 制約は無し） |
| mood ログ（category='mood' な muttering）は 30 件まで | アプリケーション側で保存時に古いものを delete                          |
| seed 上限 20 件（MVP では一時超過許容）               | アプリケーション側でカウント / 棚卸し                                  |

DB 制約で担保できないものはアプリケーション層のテストで網羅する（[`./testing.md`](./testing.md) を参照）。

---

## 8. アンチパターン（やらないこと）

| やらないこと                                              | 理由                                                    |
| --------------------------------------------------------- | ------------------------------------------------------- |
| クライアントから `@supabase/supabase-js` で直接クエリする | 認証・検証を集約できなくなる。MVP は server fn 経由のみ |
| `db` をモジュールレベルで singleton にする                | Workers の I/O 制約で 2 回目のリクエストが死ぬ          |
| `db.destroy()` を `try/catch` の `try` 側に入れる         | 例外時に接続が leak する。必ず `finally`                |
| `where("user_id", ...)` を省略して全ユーザー横断クエリ    | 将来の認証導入で他人のデータを触る事故になる            |
| migration を直接 SQL Editor で本番 DB に流す              | `migrations/` と本番 DB がズレる。`db push` 経由にする  |
| `db-types.ts` を手で編集                                  | `db:gen` で上書きされる                                 |

---

## 9. クイックレシピ集

### 「特定ユーザーのアクティブな seed を取る」

```ts
const activeSeeds = await db
  .selectFrom("seeds")
  .selectAll()
  .where("user_id", "=", userId)
  .where("status", "in", ["pending", "nudged"])
  .orderBy("updated_at", "desc")
  .execute();
```

### 「moodログ 30 件超過分を削除」

```ts
await db
  .deleteFrom("mutterings")
  .where("user_id", "=", userId)
  .where("category", "=", "mood")
  .where(
    "id",
    "not in",
    db
      .selectFrom("mutterings")
      .select("id")
      .where("user_id", "=", userId)
      .where("category", "=", "mood")
      .orderBy("created_at", "desc")
      .limit(30),
  )
  .execute();
```

### 「つぶやきと seed を 1 トランザクションで保存」

```ts
const result = await db.transaction().execute(async (trx) => {
  const muttering = await trx
    .insertInto("mutterings")
    .values({ user_id, content, category: "seed" })
    .returningAll()
    .executeTakeFirstOrThrow();

  const seed = await trx
    .insertInto("seeds")
    .values({ user_id, muttering_id: muttering.id, processed_task })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { muttering, seed };
});
```
