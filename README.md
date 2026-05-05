# ゆるなっじ（Yuru-Nudge）

「管理しない」TODOアプリ。AIキャラクター（羊のナッジー）がユーザーの「つぶやき」を記憶し、
最適なタイミングでタスクを 1 つだけ提案するゆるい体験を提供する。

設計詳細: [`docs/design/detailed-design.md`](docs/design/detailed-design.md)
実装ノート（判断・引継ぎ）: [`docs/implementation-notes.md`](docs/implementation-notes.md)
インフラ図: [`docs/infra/`](docs/infra/)

## 技術スタック

- Bun / TanStack Start (Vite+) / Tailwind CSS / Supabase (PostgreSQL)
- Kysely + kysely-postgres-js (`postgres` ドライバ) + kysely-codegen
- `@t3-oss/env-core` で環境変数バリデーション
- Vercel AI SDK (Phase 2 以降) / Framer Motion (Phase 4 以降)
- Cloudflare Workers / Pages にデプロイ

## ローカル環境の前提

- **Docker Desktop が起動していること**（Supabase ローカルスタックが Docker 上で動く）
- **mise が PATH に通っていること**（`bun` と `supabase` CLI を管理）

> **docker-compose.yml は意図的に置いていない**。Supabase CLI（`supabase start`）が必要なコンテナを直接管理するため、独自の `docker-compose.yml` は不要。`bun run dev` を実行すると内部で `supabase start` を呼び、必要なコンテナ群（PostgreSQL / PostgREST / Studio など）を起動する。

## セットアップ（初回）

```bash
# 1. ツールと依存をインストール
mise install        # bun と supabase CLI を入れる
bun install         # JS 依存をインストール

# 2. 環境変数ファイルを作成
cp .env.example .env.local
# .env.local を編集して値を埋める。
# ローカル開発の値は `bun run db:up` 後に `supabase status -o env` で取得できる。
```

## 開発サーバ

```bash
bun run dev
```

これだけで以下を順番に実行する：

1. `supabase start`（Supabase ローカルスタックを起動 / 起動済みなら何もしない）
2. `vp dev`（Vite+ 開発サーバ）

Supabase の起動が完了するまで `vp dev` は待つので、初回起動は 30〜60 秒かかる。
2 回目以降はコンテナが残っていれば数秒で立ち上がる。

ブラウザで `http://localhost:3000` を開けば動く。
（Vite+ 0.1.20 のバグでポートが他のプロセスに取られていると `:3001` 以降にフォールバックする。ターミナルの起動メッセージで確認）

## 主要なスクリプト

| コマンド                        | 内容                                            |
| ------------------------------- | ----------------------------------------------- |
| `bun run dev`                   | Supabase 起動 + Vite+ 開発サーバ                |
| `bun run db:up`                 | Supabase ローカルスタックを起動                 |
| `bun run db:down`               | Supabase ローカルスタックを停止                 |
| `bun run build`                 | 本番ビルド                                      |
| `bun run preview`               | 本番ビルドのプレビュー                          |
| `bun run test`                  | Vitest                                          |
| `bun run check`                 | fmt + lint + tsc（自動修正あり）                |
| `bun run db:reset`              | Supabase ローカル DB をマイグレーション再適用   |
| `bun run db:gen`                | DB スキーマから TypeScript 型を再生成（Kysely） |
| `bun run db:migrate:new <name>` | 新しいマイグレーションを生成                    |
| `bun run deploy`                | Cloudflare Workers にデプロイ                   |

## 開発メモ

- Vite+ ルール: vitest / oxlint / oxfmt / tsdown を直接インストールしない。詳細は `AGENTS.md`
- DB は Server Function 経由でのみアクセス。クライアントから直接 Supabase に繋がない（RLS は使わない方針）
- 認証は MVP では Cookie OR Bearer の二経路。詳細は `docs/implementation-notes.md`
- ハマりポイント・引継ぎ事項は `docs/implementation-notes.md` を参照
