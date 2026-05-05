# Supabase 環境ガイド

ローカル開発と本番（Supabase Cloud）でなにが違うか、なぜそうなっているかを整理する。
`docs/implementation-notes.md` と内容を分担：こちらは「環境そのものの仕組み」。

---

## 0. mise / Docker / Supabase CLI / Supabase Cloud の役割分担

「mise を使って supabase 環境を作っている」と言うと一段階飛ばしになる。実際は 4 層に分かれていて、それぞれ別の責務を持つ：

```
                 役割                                     ゆるなっじでの位置
─────────────────────────────────────────────────────────────────────────
mise                ツールマネージャ                      mise.toml で
                    （バージョン固定の CLI を入れる）       bun と supabase を管理

  └─ 入れたバイナリ
       ├─ bun        JS ランタイム / パッケージ管理
       └─ supabase   Supabase CLI（オーケストレータ）

Supabase CLI        ローカル Supabase スタックの司令塔     supabase/config.toml に従って
                    （Docker クライアント API を叩く）      コンテナ群を起動・停止・migrate

Docker Desktop      コンテナランタイム                     Supabase が必要とする
                    （実行基盤）                           10 個ほどのコンテナを動かす

Supabase Cloud      本番ホスティング（マネージド）         Cloudflare Workers から
                    （AWS 上の PostgreSQL ＋ 周辺サービス） TLS 経由で接続
```

つまり：

- **mise は「supabase CLI のバージョンを入れる箱」でしかない**。Supabase 本体を動かすのは Docker。
- **ローカル Supabase = Docker コンテナ群**。Supabase CLI がそれを動かす指揮官。
- **本番 Supabase = Supabase 社のマネージドサービス**。CLI は migration push 等で接続するだけ。

---

## 1. ローカル環境（Supabase CLI + Docker）

### 1.1 何が立ち上がるか

`bun run db:up`（中身は `mise exec -- supabase start`）を叩くと、`supabase/config.toml` に従って Docker コンテナが約 10 個立ち上がる：

| コンテナ                       | 役割                       | ホスト側ポート |
| ------------------------------ | -------------------------- | -------------- |
| `supabase_db_yuru-nudge`       | PostgreSQL 17 本体         | `54322`        |
| `supabase_kong_yuru-nudge`     | API ゲートウェイ（Kong）   | `54321`        |
| `supabase_auth_yuru-nudge`     | GoTrue 認証サービス        | （Kong 経由）  |
| `supabase_rest_yuru-nudge`     | PostgREST（自動 REST API） | （Kong 経由）  |
| `supabase_realtime_yuru-nudge` | リアルタイムサブスク       | （Kong 経由）  |
| `supabase_storage_yuru-nudge`  | ファイルストレージ API     | （Kong 経由）  |
| `supabase_studio_yuru-nudge`   | 管理 UI                    | `54323`        |
| `supabase_pg_meta_yuru-nudge`  | スキーマ操作 API           | （内部）       |
| `supabase_edge_runtime_*`      | Edge Functions ランタイム  | （Kong 経由）  |
| `supabase_inbucket_*`          | テスト用 SMTP（Mailpit）   | `54324`        |

> ゆるなっじの MVP では実質 `supabase_db`（PostgreSQL）と `supabase_studio`（テーブル確認用）しか触らない。残りは Phase 2 以降で必要になる可能性。

### 1.2 起動・停止・リセットのライフサイクル

| やりたいこと              | コマンド                        | 影響                                                                             |
| ------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| 起動（必要なら自動 pull） | `bun run db:up`                 | コンテナ起動、データは volume に保持                                             |
| 停止                      | `bun run db:down`               | コンテナ停止、**データは Docker volume に残る**                                  |
| マイグレーション再適用    | `bun run db:reset`              | DB を作り直して `supabase/migrations/` の SQL を順に適用。**データは全部消える** |
| 新しい migration を作る   | `bun run db:migrate:new <name>` | `supabase/migrations/<timestamp>_<name>.sql` を生成                              |
| Kysely 型を再生成         | `bun run db:gen`                | DB に対して introspect → `src/server/db-types.ts` を再生成                       |

### 1.3 認証キー / 接続情報

`supabase status -o env` で全部出る。代表的なものを `.env.local` に転記する：

| 環境変数                    | 値の例（ローカル）                                        | 用途                                  |
| --------------------------- | --------------------------------------------------------- | ------------------------------------- |
| `SUPABASE_URL`              | `http://127.0.0.1:54321`                                  | Kong 経由の API ベース URL            |
| `SUPABASE_SERVICE_ROLE_KEY` | デモ用 JWT（Supabase が公開している共通値）               | サーバサイドからの管理的アクセス用    |
| `DATABASE_URL`              | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Kysely + postgres.js が直接 PG に接続 |

> **CLI が表示する「Local dev security notice」が示すとおり、ローカルのキーは全プロジェクト共通のデモ値。本番では絶対に同じ値を使わない**。

### 1.4 データの永続性

- コンテナを `down` してもデータは消えない（Docker named volume に保存）
- ボリュームを完全に消したいときは `docker volume ls --filter label=com.supabase.cli.project=yuru-nudge` で名前を確認 → `docker volume rm <name>`
- `supabase db reset` は volume を消すわけではなく、DB のスキーマとデータを SQL で初期化する

---

## 2. 本番環境（Supabase Cloud）

### 2.1 構成

- Supabase 社が AWS 上で運用するマネージドサービス
- プロジェクト URL: `https://<project-ref>.supabase.co`
- ダッシュボード URL: `https://supabase.com/dashboard/project/<project-ref>`
- 主要構成要素はローカルと同じ（PostgreSQL ／ GoTrue ／ PostgREST ／ Storage ／ Realtime ／ Studio）が、すべてマネージド

### 2.2 DB 接続経路（Cloudflare Workers から繋ぐとき重要）

PostgreSQL に到達する経路が **2 種類** ある：

| 経路               | 接続文字列                                                                        | 特徴                                     | Workers から使うか |
| ------------------ | --------------------------------------------------------------------------------- | ---------------------------------------- | ------------------ |
| 直接接続           | `postgres://postgres:<pw>@db.<ref>.supabase.co:5432/postgres`                     | 長命セッション向き、WS 開いたら維持      | ✗（不向き）        |
| Supavisor (pooler) | `postgres://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres` | Transaction mode、短命リクエストでも安心 | ✓（こっちを使う）  |

Cloudflare Workers / miniflare は **I/O オブジェクトをリクエスト境界を越えて再利用できない**（`docs/implementation-notes.md` の「DB ドライバ周り」を参照）。本番でも `pg.Pool` 相当を持ち回そうとすると同じ問題に当たるので、**必ず Supavisor の transaction mode (6543) を使う**前提で組む。

> ローカルでは pooler を立てない（過剰）。代わりに `createDb()` を per-request で作って finally で `destroy()` する戦略でローカル / 本番のコードを共通化している。

### 2.3 認証キー / 接続情報

ダッシュボードの **Project Settings → API / Database** から取得する：

| 環境変数                    | 値の取得元                                                    |
| --------------------------- | ------------------------------------------------------------- |
| `SUPABASE_URL`              | Project Settings → API → Project URL                          |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role key（秘匿）             |
| `DATABASE_URL`              | Project Settings → Database → Connection pooler (Transaction) |

**本番値はリポジトリに置かない**。`wrangler secret put <NAME>` で Cloudflare Workers の secret として登録する：

```bash
wrangler secret put DATABASE_URL
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put APP_USER_ID
wrangler secret put API_SECRET_KEY
wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY
```

### 2.4 マイグレーションの流れ

1. ローカルで `bun run db:migrate:new <name>` → SQL 編集 → `bun run db:reset` で動作確認
2. Supabase プロジェクトとリンク（初回のみ）: `supabase link --project-ref <ref>`
3. 本番に push: `supabase db push`（差分のみ適用、破壊的変更は確認プロンプトが出る）

> **`supabase db reset` を本番に絶対に向けない**。本番側では実行しても弾かれるが、URL を取り違えて開発 DB を吹き飛ばすリスクは別にある。

---

## 3. ローカル / 本番 比較表

| 観点                      | ローカル                                         | 本番                                                 |
| ------------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| 実体                      | 開発者マシン上の Docker コンテナ                 | AWS 上のマネージド PostgreSQL ＋ 周辺                |
| 起動方法                  | `bun run db:up`（= `supabase start`）            | 既に動いている前提（プロビジョニング済み）           |
| API URL                   | `http://127.0.0.1:54321`                         | `https://<ref>.supabase.co`                          |
| DB エンドポイント         | `127.0.0.1:54322`                                | `aws-0-<region>.pooler.supabase.com:6543`（Workers） |
| TLS                       | 不要                                             | 必須                                                 |
| anon / publishable key    | 共通のデモ JWT                                   | プロジェクト固有                                     |
| service_role / secret key | 共通のデモ JWT                                   | プロジェクト固有                                     |
| データ永続性              | Docker volume（手動削除可、`db reset` で初期化） | マネージド（自動バックアップ、PITR は plan 依存）    |
| マイグレーション適用      | `bun run db:reset`（全削除→再適用）              | `supabase db push`（差分適用）                       |
| Studio                    | `http://127.0.0.1:54323`                         | `https://supabase.com/dashboard/project/<ref>`       |
| メール                    | Mailpit / Inbucket（実送信なし）                 | 実 SMTP / OTP                                        |
| ストレージ                | MinIO 互換（ローカル）                           | S3 backed                                            |
| Edge Functions            | Edge Runtime コンテナ                            | Deno Deploy 上                                       |
| シークレット保存先        | `.env.local`（gitignored）                       | Cloudflare Worker Secrets（`wrangler secret put`）   |

---

## 4. ゆるなっじの環境変数マッピング

`.env.example` をベースに、**ローカル / 本番で値だけ差し替える**。スキーマは共通。

```
# 共通スキーマ
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
GOOGLE_GENERATIVE_AI_API_KEY=
APP_USER_ID=
API_SECRET_KEY=
```

| 変数                           | ローカル                                                  | 本番                                        |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------- |
| `SUPABASE_URL`                 | `http://127.0.0.1:54321`                                  | `https://<ref>.supabase.co`                 |
| `SUPABASE_SERVICE_ROLE_KEY`    | デモ JWT                                                  | dashboard の service_role                   |
| `DATABASE_URL`                 | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Supavisor の transaction mode 接続文字列    |
| `GOOGLE_GENERATIVE_AI_API_KEY` | （任意）開発用 Gemini API キー                            | 本番用 Gemini API キー                      |
| `APP_USER_ID`                  | 開発で識別したい固定値（例: `local-user`）                | 本番で識別したい固定値                      |
| `API_SECRET_KEY`               | ローカル内だけで使う適当な文字列                          | 強い乱数（≥ 32 文字）。リポジトリに置かない |

---

## 5. なぜ `docker-compose.yml` を置いていないのか

Supabase 公式が **CLI で完結する開発フロー**を提供しているため、独自に `docker-compose.yml` を持つと二重管理になる：

- どのコンテナイメージ・タグを使うかは Supabase CLI が把握している
- `supabase/config.toml` で API ポート・JWT secret・ストレージ設定などを宣言的に書ける
- マイグレーション適用 (`db reset` / `db push`)・型生成 (`gen types`) も CLI 前提

`bun run db:up` が `supabase start` を呼ぶことで CLI を一次窓口にしているので、**コンテナ管理のことを考える必要が出る前に CLI コマンドを使う**運用にしてある。

> Supabase 自体は self-hosted 用に `docker-compose.yml` を [github.com/supabase/supabase/tree/master/docker](https://github.com/supabase/supabase/tree/master/docker) で公開している。Supabase Cloud をやめて自分でホスティングするタイミングが来たら、それを取り込めば良い。

---

## 6. よくある詰まり・対処

| 症状                                                | 原因                                   | 対処                                                                          |
| --------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `bun run dev` が Postgres に繋がらない              | `supabase start` がまだ走っていない    | `dev` script は自動的に `db:up` を呼ぶ。Docker Desktop が止まっていないか確認 |
| Worker で `Cannot perform I/O on behalf of...`      | モジュールレベルで DB 接続を持っている | `createDb()` を per-request にする（実装済）                                  |
| `supabase status` が `Stopped services: ...` と出る | imgproxy / pooler はデフォルト無効     | 動作には影響しない、無視して OK                                               |
| キーをローカル値のまま push してしまった            | `.env.local` が gitignore にあるか確認 | `git ls-files                                                                 | grep env` で確認、含まれていたら history から削除 |
