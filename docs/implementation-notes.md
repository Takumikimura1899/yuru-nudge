# 実装ノート

実装の途中で見つけた制約、判断の理由、Phase 間の引継ぎ事項を記録する。
設計書（`docs/design/detailed-design.md`）と重複する内容は書かない。

---

## Phase 1（基盤構築）

### 採用した判断

- **Vite+ のパッケージ管理コマンド（`vp add` / `vp update` / `vp outdated`）は v0.1.20 時点で未実装**。`AGENTS.md` は将来仕様。実用上は `bun update` / `bun add` を使う。`vp` は `dev` / `build` / `test` / `check` / `lint` / `fmt` のラッパーとしてのみ運用。
- **テスト時は Cloudflare プラグインを無効化**。`@cloudflare/vite-plugin` 1.35.0 が `tanstackStart()` の `resolve.external`（ssr 環境）を拒否するため、`vite.config.ts` で `process.env.VITEST === "true"` の場合に cloudflare プラグインを除外。テストは jsdom で走るため Workers ランタイムは不要。
- **kysely-codegen は `--include-pattern 'public.*'` 必須**。デフォルトだと Supabase 内部の auth/storage/realtime/vault スキーマも含めて 51 テーブル拾ってしまう。`.env.local` を `--env-file` で読ませる。
- **`seeds.user_id` を冗長に持たせる判断**。設計書 §13 では `seeds.muttering_id` 経由で `mutterings.user_id` を辿れるが、ナッジ抽出（`status='pending'` などのクエリ）の効率上 `seeds` にも `user_id` を持たせた。この判断は実装時のもので、設計書には反映していない。

### 既知の課題

- **`vp dev --port 3000` の `--port` が効かない**。Vite+ 0.1.20 の挙動で 5173 / 5177 など空きポートを勝手に取る。優先度低。
- **`pg` の Cloudflare Workers でのプール挙動は未検証**。Phase 1 では `wrangler dev` 起動までしか確認していない。複数リクエストの並行で問題が出るようなら `postgres` (postgres.js) + `kysely-postgres-js` への切替が候補。`wrangler.jsonc` の `nodejs_compat` フラグは設定済み。

---

## Phase 1.5（Cookie + Bearer 二経路認証）

### 採用した判断

- **ブラウザに `API_SECRET_KEY` を露出させない**ため、SSR 発行 HttpOnly Cookie 方式を採用した。Cookie の値は `API_SECRET_KEY` そのもの（HttpOnly なので JS からは読めない）。MVP 単一ユーザー前提。
- **auth middleware は Cookie OR Bearer のどちらか一致で通過**。
  - ブラウザ：自動送信される Cookie で通過
  - 外部 curl / dev：`Authorization: Bearer <API_SECRET_KEY>` で叩ける
- **`session` request middleware を `createStart` でグローバル登録**。SSR レスポンスに `Set-Cookie: app_session=<key>; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000` を仕込む。既に同値の Cookie が来ていたら再発行しない。値が違えば上書き。

### TanStack Start の middleware 実行モデル（重要）

- **`createServerFn().middleware([...])` で attach した middleware は HTTP 経由の呼び出し時のみ発火する**。SSR 中の loader からの直接関数呼び出しでは発火しない（同一プロセス内の信頼境界がない呼び出しと見なされる）。
  - 影響：SSR レンダリング時、loader が `getProfile()` を直接呼び出す経路では auth middleware を通らない。これは設計上意図通り（サーバ間の自分自身呼び出し）。
  - クライアント navigation 時 / 外部からの呼び出し時は HTTP server fn invocation になり、middleware が発火する。
- **request middleware（global）は SSR・server route・server function（HTTP 経由）すべてで発火する**。`session` middleware を global にしているのはこの性質を利用するため。

### 既知の制約・引継ぎ

- **curl で `/_serverFn/<id>` を直接叩くと 500 になる**。TanStack Start の framing protocol（`X-TSS-*` ヘッダ、特定の Content-Type）を満たしていないため。auth middleware の挙動とは独立した話なので、curl で auth を疎通確認したい場合はブラウザ経由（または fetch を作って正しい framing で送る）が必要。
- **クライアント navigation 経由での auth middleware 発火は実機ブラウザ未検証**。Phase 2 でチャット UI からの実呼び出しが入った段階で確認すること。失敗パターンとしては Cookie 送信失敗（同一オリジンになっていない、SameSite 設定が厳しすぎる等）が考えられる。
- **Cookie の値を `API_SECRET_KEY` 直結にしている**。理論的にはローテーションしづらい。MVP では問題ないが、将来 Supabase Auth に差し替える際にここも一緒に作り直す前提。

---

## 共通の運用ルール

- パッケージ追加 / 更新は `bun add` / `bun update`。`vitest` / `oxlint` / `oxfmt` / `tsdown` は Vite+ がラップしているので直接入れない。
- DB 型再生成は `bun run db:gen`。`supabase start` 中に実行する必要がある。
- マイグレーション追加は `bun run db:migrate:new <name>` → SQL 編集 → `bun run db:reset`。
- コミット前の自動チェックは `.vite-hooks/pre-commit` 経由で `vp check --fix` が走る。
