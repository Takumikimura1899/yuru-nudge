# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

「ゆるなっじ（Yuru-Nudge）」— PWAベースのゆるいTODOアプリ。AIキャラクター（羊のナッジー）がユーザーの「つぶやき」を記憶し、最適なタイミングでタスクを1つだけ提案（ナッジ）する。タスク管理を強制せず、罰の要素を完全に排除するのがコンセプト。

## 技術スタック

- **Runtime/Package Manager**: Bun
- **Framework**: TanStack Start（Viteベース、フルスタックReact）
- **Toolchain**: Vite+（Vite, Vitest, Oxlint, Oxfmt を統合管理）
- **Styling**: Tailwind CSS (Rounded, Pastel tone)
- **Animation**: Framer Motion
- **PWA**: フェーズ5で軽量PWA化済み（manifest + アイコン + 静的アセットキャッシュのみのSW。詳細は docs/pwa.md）
- **Database**: Supabase (PostgreSQL)、Server Function経由のみ（クライアント直接アクセス不可、RLS不要）
- **DB Migration**: Supabase CLI
- **DB Client**: Kysely（タイプセーフなSQLクエリビルダー）
- **環境変数管理**: `.env.local` + `.env.example` + `@t3-oss/env-core`（型安全バリデーション）
- **AI**: Gemini API (Vercel AI SDK経由)
- **State管理**: React標準（useState）。useContextは使わない。グローバルステートが必要になった場合は別途検討
- **Test**: Vitest + Testing Library（Vite+統合）
- **VRT**: Storybook + reg-suit
- **LLM評価**: LLM-as-judge
- **Deploy**: Cloudflare (Workers / Pages)、Nitroプラグイン経由

## アーキテクチャ方針

- **データアクセス**: クライアント → TanStack Start Server Function → Supabase (server-side client)。認証はcreateMiddlewareで制御
- **MVP認証**: 認証なし。環境変数で固定ユーザーID。API保護はBearerトークンチェック
- **PWA**: オンライン必須。オフライン対応なし。静的アセットのみキャッシュ
- **LLM呼び出し**: つぶやき入力のたびにLLM呼び出し（分類＋応答）。失敗時はナッジーのキャラ内でエラー表現

## データモデル（3テーブル）

- **profiles**: user_id(PK, text), intensity_level(`chill`/`sharp`)
- **mutterings**: つぶやき原文。category(`seed`/`mood`)で分類
- **seeds**: タスク管理。status(`pending`/`nudged`/`completed`/`softened`/`archived`)。`parent_id`で親子関係（ステップアップ型ナッジ）

## コアロジック

- つぶやきはLLMが `seed`（アクション可能）と `mood`（共感のみ）に分類
- ナッジは起動時に判定: nudged状態のseedがあれば再表示、なければ12時間経過後に新規提案
- seed 15件以上で棚卸し優先、上限20件（一時超過許容）
- moodログは直近30件保持、超過時は古いものから削除
- 月初起動時に月次振り返りを表示

## 設計ドキュメント

詳細設計書: `docs/design/detailed-design.md`

## 実装フェーズ

1. **基盤構築**: Vite+ + TanStack Start + Tailwind、Supabaseスキーマ、Server Function基盤、Cloudflareデプロイ
2. **つぶやきとAI解析**: チャットUI、入力フォーム、Vercel AI SDKでの分類・応答
3. **ナッジ機能**: seed選択、ナッジ表示、状態遷移、緩和版生成、タイムアウト、棚卸し
4. **振り返りと演出**: 月次振り返り、SVG羊コンポーネント（3状態）、アニメーション
