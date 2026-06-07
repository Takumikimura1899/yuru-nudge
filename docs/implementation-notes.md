# 実装ノート

実装の途中で見つけた制約、判断の理由、Phase 間の引継ぎ事項を記録する。
設計書（`docs/design/detailed-design.md`）と重複する内容は書かない。

関連:

- [`./supabase-environments.md`](./supabase-environments.md) — ローカル / 本番の違い
- [`./db-access-pattern.md`](./db-access-pattern.md) — Kysely + per-request DB / マイグレーション
- [`./auth-flow.md`](./auth-flow.md) — Cookie + Bearer 二経路認証
- [`./deploy.md`](./deploy.md) — デプロイ手順 / CI/CD 戦略
- [`./testing.md`](./testing.md) — テスト方針
- [`./infra/`](./infra/) — インフラ構成図（draw.io）

---

## Phase 1（基盤構築）

### 採用した判断

- **Vite+ のパッケージ管理コマンド（`vp add` / `vp update` / `vp outdated`）は v0.1.20 時点で未実装**。`AGENTS.md` は将来仕様。実用上は `bun update` / `bun add` を使う。`vp` は `dev` / `build` / `test` / `check` / `lint` / `fmt` のラッパーとしてのみ運用。
- **テスト時は Cloudflare プラグインを無効化**。`@cloudflare/vite-plugin` 1.35.0 が `tanstackStart()` の `resolve.external`（ssr 環境）を拒否するため、`vite.config.ts` で `process.env.VITEST === "true"` の場合に cloudflare プラグインを除外。テストは jsdom で走るため Workers ランタイムは不要。
- **kysely-codegen は `--include-pattern 'public.*'` 必須**。デフォルトだと Supabase 内部の auth/storage/realtime/vault スキーマも含めて 51 テーブル拾ってしまう。`.env.local` を `--env-file` で読ませる。
- **`seeds.user_id` を冗長に持たせる判断**。設計書 §13 では `seeds.muttering_id` 経由で `mutterings.user_id` を辿れるが、ナッジ抽出（`status='pending'` などのクエリ）の効率上 `seeds` にも `user_id` を持たせた。この判断は実装時のもので、設計書には反映していない。

### 解消済みの課題

- ~~`pg` の Cloudflare Workers でのプール挙動は未検証~~ → **`postgres` (postgres.js) + `kysely-postgres-js` に切替済**。詳細は下記「DB ドライバ周り」を参照。
- ~~`vp dev --port 3000` の `--port` が効かない~~ → Phase 2 実装時（2026-06-07、Vite+ 0.1.20 のまま node_modules をクリーン再インストール後）に **3000 で起動することを確認**。再発したら node_modules の混在インストール（下記 Phase 2 ハマりどころ参照）を疑う。

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

## Phase 2（つぶやきとAI解析）

### 採用した判断

- **`mutterings.reply` カラムを追加（設計書 §13.2 からの逸脱）**。チャット履歴（直近20件）でナッジーの発言を復元する必要があるが、設計書のデータモデルにはナッジー応答の保存先がなかった。1つぶやき = 1往復（content + reply）として mutterings に持たせる判断。別テーブルにしなかったのは、応答とつぶやきが厳密に 1:1 で JOIN 不要、履歴取得が単純になるため。
- **AI SDK は v6（`ai@6.x` + `@ai-sdk/google@3.x`）**。v6 では `generateObject` が deprecated のため、`generateText` + `Output.object`（zod スキーマ）で構造化出力を取得。LLM 呼び出しは `src/server/ai/nudgey.ts` の `classifyAndReply()` 1関数に閉じており、SDK の API 変更はここだけで吸収する。
- **分類・応答・タスク整形を 1 回の LLM 呼び出しで取得**（設計書 §4.4 の MVP 方針）。スキーマは `{ category, reply, processed_task }`。`processed_task` は `.nullable()`（`.optional()` ではなく）にして Gemini がキーを常に返すようにしている。
- **LLM 失敗時は何も保存しない**。`classifyAndReply` は throw せず `{ok:false, reply: キャラ内エラー}` を返し、`processMutter` は保存をスキップ。UI は楽観表示したユーザー発言を取り消し、入力テキストをフォームに残す（再送しやすい）。
- **server fn のコアロジックは純関数として切り出し**（`processMutter` / `fetchTimeline` / `setIntensity`）。TanStack Start の `createServerFn().handler()` はテストから直接呼べないため、`Kysely<DB>` を引数に取る関数に分離し、server fn は createDb + destroy の薄いラッパーにした。
- **mood 淘汰は新規挿入と同一トランザクション**。挿入後に「直近30件の id 集合に入らない mood」を削除（`not in` サブクエリ）。
- **`createServerFn` の validator は `.inputValidator()`**。ドキュメント等で見かける `.validator()` は現バージョン（@tanstack/react-start 1.167）には存在しない。zod スキーマを直接渡せる（Standard Schema 対応）。

### ハマりどころ

- **node_modules に bun の isolated インストール（.pnpm 形式）と通常形式が混在し、React が 2 インスタンスになった**。Phase 1 時点（3月）のインストールが isolated 形式で `react@19.2.4` を抱えたまま、後から `react@19.2.5` が通常形式で入り、コンポーネントテストが `Cannot read properties of null (reading 'useState')` で全滅。`rm -rf node_modules && bun install` で解消。
- **コンポーネントテストは jsdom 環境をファイル先頭の `// @vitest-environment jsdom` で指定**。vite-plus のテストはデフォルト node 環境。jest-dom マッチャーは各テストファイルで `import "@testing-library/jest-dom/vitest"`（setup ファイルは置いていない）。

### 実機検証結果（2026-06-07）

- **auth middleware のクライアント経由発火を実機確認（Phase 1.5 の引継ぎ事項を解消）**。ブラウザからのつぶやき送信で `POST /_serverFn/...`（postMutter）が発火し、HttpOnly Cookie（app_session）認証で 200 が返ることを確認。SameSite=Lax / 同一オリジンで問題なし。
- E2E フロー一式を確認: seed つぶやき → mutterings + seeds（pending）保存・ナッジー応答表示 / mood つぶやき → 共感応答・seeds 保存なし / intensity 切替 → profiles 更新・応答トーン変化 / リロード → 履歴20件復元（reply カラムからナッジー発言も復元）・intensity 状態復元。

---

## ローカル環境の起動 / DB ドライバ周り

### `bun run dev` は Supabase を自動起動する

`package.json` の `dev` script は `bun run db:up && vp dev --port 3000` にしてある。`db:up` は `mise exec -- supabase start` のエイリアス。`supabase start` は冪等なので、起動済みなら状態を出力するだけ。

**docker-compose.yml はあえて置いていない**。Supabase CLI が独自にコンテナを管理しているため、別建てで docker-compose.yml を持つと二重管理になる。CLI を一次窓口にする運用。

### DB は per-request で作る

最初は `pg`（node-postgres）でモジュールレベルに `Pool` を持たせていたが、Vite+ の cloudflare plugin（miniflare）下で **2 回目のリクエストが必ず失敗する**現象が出た。

- エラー: `Cannot perform I/O on behalf of a different request. I/O objects ... created in the context of one request handler cannot be accessed from a different request's handler.`
- 理由: Cloudflare Workers の制約で、I/O オブジェクト（DB 接続を含む）はリクエスト境界を越えて共有できない。モジュールレベルで作った接続は最初のリクエストの I/O context に紐付き、次のリクエストでは使えない。

**対応:**

1. ドライバを `pg` → `postgres` (postgres.js) + `kysely-postgres-js` に変更（Workers 互換が良い）。
2. `src/server/db.ts` は `createDb()` 関数のみ export。**ハンドラ側でリクエスト毎にインスタンスを作り、`finally` で `destroy()` する**。

```ts
// src/server/profile.ts
.handler(async ({ context }) => {
  const db = createDb();
  try {
    // ... query
  } finally {
    await db.destroy();
  }
});
```

将来的に多くの server fn が DB を使うなら、function middleware で `context.db` を注入＋自動 `destroy` するパターンへリファクタの余地あり。

### TanStack DevTools パネルは外した

TanStack Router DevTools パネル（`<TanStackDevtools>` + `@tanstack/react-router-devtools` + `@tanstack/devtools-vite`）は **画面ちらつきの原因** だったため取り外した。

- 症状: dev で常時、画面隅にあるトグルボタン付近が 2 秒周期で `scale + rotate` のアニメで脈打ち、ちらつきとして体感される
- 原因: パネル内の H3（`plugin-title-container-tanstack-router-0`）に goober 生成の無限 keyframe（`scale(1)→scale(1.1) rotate(10deg)`）が掛かっていて、`iterations: Infinity` でずっと走っていた
- 対応: ライブラリと vite plugin を削除（`bun remove @tanstack/react-router-devtools @tanstack/react-devtools @tanstack/devtools-vite`）、`__root.tsx` の `<TanStackDevtools>` を撤去
- 検証: Playwright + `document.getAnimations()` / `MutationObserver` で「実行中の無限アニメ 0、DOM mutation 8 秒で 0」を確認

ルーター state を覗きたくなったら：

- ブラウザの React DevTools で components / props を辿る
- 一時的に `<TanStackDevtools>` を再追加するか、`@tanstack/react-router-devtools` の `TanStackRouterDevtools` を別ルートで条件付き有効化する

### auth middleware は SSR loader 直接呼び出しを bypass する

`src/server/middleware/auth.ts` は `pathname?.startsWith("/_serverFn/")` をチェックし、HTTP server fn 呼び出し以外（SSR ページ描画 / loader からの直接呼び出し）は **Cookie/Bearer なしで通過**させる。

- 理由: 初回訪問時は Cookie がまだ無いため、loader が getProfile を呼ぶと auth 失敗で profile が空になり、画面が空欄でレンダリングされてしまう（ニワトリ・卵問題）。
- TanStack Start の SSR-direct 呼び出しでは `pathname` が undefined になることがあるため、安全側で「`/_serverFn/` で始まる pathname のみ auth を強制」と扱う。
- HTTP 経由（クライアントナビゲーションや外部 curl）では `pathname` が `/_serverFn/...` になるので、Cookie か Bearer が必須のまま。

---

## 共通の運用ルール

- パッケージ追加 / 更新は `bun add` / `bun update`。`vitest` / `oxlint` / `oxfmt` / `tsdown` は Vite+ がラップしているので直接入れない。
- DB 型再生成は `bun run db:gen`。`supabase start` 中に実行する必要がある。
- マイグレーション追加は `bun run db:migrate:new <name>` → SQL 編集 → `bun run db:reset`。
- コミット前の自動チェックは `.vite-hooks/pre-commit` 経由で `vp check --fix` が走る。
