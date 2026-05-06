# デプロイ手順 / CI/CD 戦略

ゆるなっじを Cloudflare Workers にデプロイする手順と、将来の CI/CD 構想を整理する。

> **現状（Phase 1.5 時点）**: 手動デプロイのみ。GitHub Actions 等の CI/CD は未導入。

---

## 1. 構成の前提

| 要素           | 値                                                         |
| -------------- | ---------------------------------------------------------- |
| ホスティング   | Cloudflare Workers                                         |
| ビルド         | `vp build`（TanStack Start + Cloudflare Vite plugin）      |
| デプロイツール | `wrangler`（Cloudflare 公式 CLI、devDep）                  |
| Worker 名      | `yuru-nudge`（`wrangler.jsonc` の `name`）                 |
| DB             | Supabase Cloud（Supavisor pooler 経由で Workers から繋ぐ） |
| AI API         | Google Gemini（Phase 2 以降、Vercel AI SDK 経由）          |
| 環境           | **本番のみ**（dev / staging は分けない MVP 方針）          |

---

## 2. 初回セットアップ（一度だけ）

### 2.1 Cloudflare アカウント

1. [Cloudflare Workers](https://workers.cloudflare.com/) でアカウント作成（無料枠で MVP は十分）
2. ローカルで `wrangler login` → ブラウザ認証
3. `wrangler whoami` で確認

### 2.2 Supabase Cloud プロジェクト

[`./supabase-environments.md`](./supabase-environments.md) §2 を参照。要点：

1. Supabase ダッシュボードで新規プロジェクト作成
2. ローカルで `supabase link --project-ref <ref>`
3. `supabase db push` で `supabase/migrations/` の SQL を本番に反映
4. ダッシュボードから以下を控える：
   - Project URL（`https://<ref>.supabase.co`）
   - service_role key（Project Settings → API）
   - Connection pooler の Transaction mode 接続文字列（Project Settings → Database）

### 2.3 シークレットを Worker に登録

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put DATABASE_URL
wrangler secret put APP_USER_ID
wrangler secret put API_SECRET_KEY
wrangler secret put GOOGLE_GENERATIVE_AI_API_KEY   # Phase 2 以降
```

実行すると対話的に値を聞かれる。**ターミナル履歴に値を残さないよう貼り付けで入力する**。

### 2.4 初回デプロイ

```bash
bun run deploy
# = vp build && wrangler deploy
```

成功すると `https://yuru-nudge.<account>.workers.dev` で公開される。

---

## 3. 通常のデプロイフロー（手動）

```bash
# 1. ローカルで動作確認
bun run dev
# http://localhost:3000 で挙動を確認

# 2. 静的検査
bun run check    # fmt + lint + tsc
bun run test     # vitest

# 3. ビルドが通るか
bun run build

# 4. 本番デプロイ
bun run deploy
```

`wrangler deploy` の出力にデプロイ URL とバージョン ID が表示される。

---

## 4. マイグレーションとデプロイの順序

スキーマ変更がある場合、**マイグレーション → コードデプロイ** の順に流す。

```
ローカル：
  1. bun run db:migrate:new <name>
  2. SQL を編集
  3. bun run db:reset     ← ローカル DB に適用
  4. bun run db:gen       ← Kysely 型再生成
  5. アプリケーションコード更新
  6. bun run check && bun run test
  7. PR をレビュー（CI 導入後はここで自動チェック）

本番：
  8. supabase db push     ← 本番 DB に migration 適用
  9. bun run deploy       ← Worker をデプロイ
```

> **逆順にすると「新カラム前提のコードが旧 DB を叩いて落ちる」が発生する**。テーブル削除・カラム削除のような破壊的変更は、コード側を先に「使わない」状態にしてから DB を変更する 2 段階デプロイにする。

---

## 5. ロールバック

### 5.1 コードを戻す

```bash
git revert <commit>
bun run deploy
```

または Cloudflare ダッシュボードの **Deployments** タブから旧バージョンに切り戻し（GUI で 1 クリック）。

### 5.2 マイグレーションを戻す

Supabase は migration の自動 down / revert を持たない。**逆向きの SQL を新しい migration として書く**：

```bash
bun run db:migrate:new revert_add_some_column
# 中で ALTER TABLE ... DROP COLUMN ... を書く
```

→ ローカルで動作確認 → `supabase db push`。

> 破壊的変更（カラム削除等）は本番で迂闊にやらない。一度 deploy が固まってから、データバックアップ取ってから流す。

---

## 6. 監視・ログ

### 6.1 リアルタイムログ

```bash
wrangler tail
# 本番 Worker の console.log / error を流し見できる
```

### 6.2 メトリクス

Cloudflare ダッシュボード → Workers & Pages → 該当 Worker：

- リクエスト数 / エラー率
- CPU 時間（無料枠は 1 リクエスト 10ms まで、有料枠で拡張）
- Subrequest 数（Supabase / Gemini への外部 fetch）

### 6.3 Supabase 側

Supabase ダッシュボード → Logs / Reports：

- Postgres logs（slow query 等）
- API logs

---

## 7. 環境分離（現状なし、将来構想）

MVP は単一の本番環境のみ。本格運用が見えてきたら以下を検討：

| 環境       | 用途              | Worker 名                  | DB                                               |
| ---------- | ----------------- | -------------------------- | ------------------------------------------------ |
| local      | 開発者の手元      | （vp dev）                 | Supabase ローカル（Docker）                      |
| preview    | PR ごとの動作確認 | `yuru-nudge-preview-<sha>` | 本番 DB のスキーマだけクローンした別プロジェクト |
| production | 本番              | `yuru-nudge`               | Supabase Cloud 本番プロジェクト                  |

`wrangler.jsonc` の `env` キーで切り分けるのが Cloudflare 流：

```jsonc
{
  "name": "yuru-nudge",
  "env": {
    "preview": { "name": "yuru-nudge-preview" },
    "production": { "name": "yuru-nudge" },
  },
}
```

→ `wrangler deploy --env preview` のように指定できる。

---

## 8. CI/CD 戦略（未導入、想定設計）

### 8.1 候補ツール

GitHub Actions が第一候補（リポジトリが GitHub 前提、Cloudflare 公式 Action がある）。

### 8.2 想定するワークフロー

```
PR 作成
  └── .github/workflows/ci.yml
        ├── bun install
        ├── mise install （bun + supabase）
        ├── supabase start （CI 上で local DB 起動）
        ├── bun run db:reset
        ├── bun run check
        ├── bun run test
        └── bun run build （SSR ビルドが通るか）

main にマージ
  └── .github/workflows/deploy.yml
        ├── ↑と同じ静的検査
        ├── supabase db push --project-ref ${{ secrets.SUPABASE_PROD_REF }}
        └── wrangler deploy （CLOUDFLARE_API_TOKEN を使う）
```

### 8.3 GitHub Secrets に入れる値

| 名前                    | 用途                                             |
| ----------------------- | ------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | wrangler deploy 用（Edit Worker 権限のトークン） |
| `CLOUDFLARE_ACCOUNT_ID` | wrangler deploy 用                               |
| `SUPABASE_ACCESS_TOKEN` | supabase CLI が本番に push するため              |
| `SUPABASE_PROD_REF`     | 本番プロジェクトの ref                           |
| `SUPABASE_DB_PASSWORD`  | `supabase db push` の認証                        |

> Worker の **アプリケーション側 secrets** は Cloudflare 側に既に登録済（`wrangler secret put`）なので、GitHub Secrets には入れる必要がない。GitHub Secrets は「デプロイの認証用」だけに留める。

### 8.4 Migration の扱い

CI で `supabase db push` を自動実行することは可能だが、**MVP 段階では手動を推奨**：

- スキーマ変更は破壊的になりやすい
- 自動 push で誤って本番を壊すリスクが大きい
- 単一ユーザー前提なので「人間がレビューしてから push」で十分

CI で自動化するのは Phase 4 以降、運用が安定してから。

### 8.5 一旦は手動でも回る理由

- 開発者が 1 人〜少数
- デプロイ頻度は週 1〜数回程度の見込み
- 本番障害があっても影響範囲は自分（と将来の少数ユーザー）

CI/CD 導入の効果が手間を上回るのは、**チーム化** または **デプロイ頻度が日次以上** になってから。

---

## 9. デプロイ前チェックリスト

```
□ bun run check が通る
□ bun run test が通る
□ bun run build が通る（dist/server/ が生成される）
□ bun run dev でローカル動作確認
□ DB マイグレーションがあれば supabase db push 済
□ 新規環境変数があれば wrangler secret put 済
□ wrangler.jsonc の compatibility_date を最近のものにしている
□ 破壊的変更があれば README / implementation-notes に記録
```

デプロイ後：

```
□ デプロイ URL で SSR が表示される
□ 主要な server fn が 200 を返す（curl + Bearer で確認）
□ wrangler tail でエラーが流れていない
□ Supabase ダッシュボード で予期しないクエリが走っていない
```

---

## 10. アンチパターン

| やらないこと                                     | 理由                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `wrangler.jsonc` に secret を直書きする          | リポジトリに漏れる。`wrangler secret put` を使う                     |
| `--no-verify` で pre-commit を skip して deploy  | 静的検査が落ちている可能性、デプロイ後に発覚すると面倒               |
| migration 適用前にコードを deploy                | 新コードが旧スキーマを叩いて 500 連発                                |
| 開発 DB と本番 DB の `DATABASE_URL` を取り違える | `supabase db reset` 等で本番が吹き飛ぶ。ターミナルセッション分離推奨 |
| `wrangler deploy --force` を癖でつける           | エラーの原因を握りつぶしてデプロイしてしまう                         |
