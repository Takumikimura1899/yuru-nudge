# ゆるなっじ（Yuru-Nudge）

「管理しない」TODOアプリ。AIキャラクター（羊のナッジー）がユーザーの「つぶやき」を記憶し、
最適なタイミングでタスクを 1 つだけ提案するゆるい体験を提供する。

設計詳細: [`docs/design/detailed-design.md`](docs/design/detailed-design.md)

## 技術スタック

- Bun / TanStack Start (Vite+) / Tailwind CSS / Supabase (PostgreSQL)
- Kysely + kysely-codegen
- `@t3-oss/env-core` で環境変数バリデーション
- Vercel AI SDK (Phase 2 以降) / Framer Motion (Phase 4 以降)
- Cloudflare Workers / Pages にデプロイ

## セットアップ

### 1. 依存インストール

```bash
bun install
```

### 2. Supabase をローカル起動（要 Docker）

```bash
bun run db:reset      # マイグレーション適用
```

`supabase status` で得られる `API URL` / `service_role key` / `DB URL` を `.env.local` に転記する。

### 3. 環境変数

`.env.example` をコピーして `.env.local` を作成し、値を埋める。

```bash
cp .env.example .env.local
```

### 4. 開発サーバ

```bash
bun run dev
```

## 主要なスクリプト

| コマンド                        | 内容                                            |
| ------------------------------- | ----------------------------------------------- |
| `bun run dev`                   | Vite 開発サーバ                                 |
| `bun run build`                 | 本番ビルド                                      |
| `bun run preview`               | 本番プレビュー                                  |
| `bun run test`                  | Vitest                                          |
| `bun run check`                 | fmt + lint + tsc（自動修正あり）                |
| `bun run db:reset`              | Supabase ローカル DB をマイグレーション再適用   |
| `bun run db:gen`                | DB スキーマから TypeScript 型を再生成（Kysely） |
| `bun run db:migrate:new <name>` | 新しいマイグレーションを生成                    |
| `bun run deploy`                | Cloudflare Workers にデプロイ                   |

## 開発メモ

- Vite+ ルール: vitest / oxlint / oxfmt / tsdown を直接インストールしない。詳細は `AGENTS.md`
- DB は Server Function 経由でのみアクセス。クライアントから直接 Supabase に繋がない（RLS は使わない方針）
- 認証は MVP では Bearer トークンのみ。`API_SECRET_KEY` をミドルウェアで検証
