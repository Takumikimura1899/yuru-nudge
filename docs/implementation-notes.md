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

## Phase 3（ナッジ機能）

### 採用した判断

- **棚卸しも 12 時間ゲートの内側**（設計書 §9.1）。`resolveNudgeState` の順序は ① タイムアウト一括 archive → ② nudged 再表示 → ③ 12 時間未経過なら kind:none → ④ 経過していれば pending≥15 で棚卸し、未満で新規ナッジ生成。棚卸しは `nudged_at` を更新しないため、間隔経過後は seed が 15 件未満に減るまで毎起動で表示される（MVP の許容仕様）。
- **ナッジの一意性を仮定しない設計**。並行 `resolveNudge` で nudged が 2 件以上になる理論的余地（READ COMMITTED では条件付き UPDATE の NOT EXISTS 相当チェックがすり抜ける）があるため、再表示は `ORDER BY nudged_at DESC, id ASC LIMIT 1` で決定的に 1 件選ぶ重複耐性方式。余った nudged は 7 日タイムアウト（NUDGE_TIMEOUT_DAYS）で自己回復。恒久対策（`seeds(user_id) WHERE status='nudged'` の部分ユニークインデックス）は多ユーザー化時に追加。
- **状態遷移は全て条件付き UPDATE + 行数確認で冪等化**。`WHERE id=? AND user_id=? AND status='nudged'`（等）でチェックし、`returningAll()` で 0 行なら `alreadyReacted` 扱い。`discardSeed` も 0 行更新なら `ok:false` を返し UI が行を復元。「難しい」（softened）のみ LLM 先行 → 成功時にトランザクションで親 UPDATE + 子 seed INSERT、親が 0 行ならロールバック（orphan の子を作らない）。タイムアウト archive は SELECT せず単一の条件付き UPDATE で、並行する完了反応を上書きしない。
- **`updated_at` は全 UPDATE で明示 set**。`init.sql` に ON UPDATE トリガーがないため、`updated_at: new Date()` で毎回明示している。
- **反応トリガーはボタンのみ**（やったよ/難しい/いらない）。つぶやき文からの完了検出は「どのナッジ宛か」の曖昧性と LLM 誤分類リスクで見送り。将来 `classifyAndReply` に active nudge の文脈を渡す拡張点だけ残した。ラベル文言は `src/components/chat/reactions.ts` に単一ソース化。
- **反応後のナッジー応答（答え合わせ等）はライブ表示のみで DB 保存しない**（設計書 §11.2「ナッジへの反応も履歴に含む」からの意図的な簡略化。リロードで消える。履歴再構成が必要になったら `seeds.reaction_reply` カラム追加 + タイムラインの時刻マージで対応する将来案）。このため **Phase 3 は DB マイグレーション不要**（既存 seeds カラムで完結）。
- **LLM は 3 関数追加**。`selectNudge`（pending 候補から 1 つ選択、未来予言を生成）/ `generateCompletionReply`（完了時の答え合わせ）/ `generateSoftenedTask`（難しい時の緩和版生成）いずれも `generateText` + `Output.object` で構造化出力。`selectNudge` は返ってきた seed_id が候補集合に含まれるか事後検証し、外れていれば ok:false（ハルシネーション対策。その起動はナッジなし、次回再試行）。新規 LLM 関数は fallback 前に必ず `console.error` でログ（既存 `classifyAndReply` の握り潰しと異なる点）。
- **`resolveNudge` は loader ではなくクライアント mount 時の POST server fn**。loader に載せると SSR 描画のたびに副作用（archive・LLM 呼び出し）が走り、SSR-direct 呼び出しは auth middleware を bypass する経路になるため。`useRef` の単発ガード（`nudgeResolvedRef`）で StrictMode の二重 mount でも 1 回だけ呼ぶ。初回描画後にナッジカードが後から出る（1 往復分）のは許容コスト。

### ハマりどころ

- **useChat の失敗時巻き戻しが「末尾要素削除」（`slice(0,-1)`）前提だったのが Phase 3 で破綻**。`react()` / `resolveNudge()` / `discard()` が同じ messages 配列に非同期 append するため、`postMutter` の in-flight 中に反応ボタンが押されると別のバブルを誤削除する。楽観バブルに `optimisticId` を持たせて `filter` で除去する方式に変更（Phase 3 レビューで検出）。`useChat.ts` の `send()` は `optimisticId` 付きでメッセージを push し、失敗時に `pushNudgeyErrorInsteadOfUserMessage()` で filter で該当 id を除去。
- **lint-staged（pre-commit）は部分ステージング + 未追跡ファイル混在で stash に失敗する**（「Entry not uptodate. Cannot merge」）。Phase 3 のように `src/server/nudges.ts` / `src/server/ai/nudgey.ts`（新規）等ファイルが多い場合は全ステージングの単一コミットが安全。

### 実機検証結果（2026-07-18）

- **mount 時に resolveNudge の POST が 1 回だけ発火**（StrictMode 下でも `nudgeResolvedRef` ガードが機能）。
- **seed なし → kind:"none"** で通常チャット画面。
- **ナッジ表示 → 「やったよ」ボタン** で nudged→completed 遷移・答え合わせ応答表示・ボタン disable を確認。
- **pending 15 件以上でリロード → 棚卸しカード表示**。「もういいや」で pending→archived・DB 更新、「気になってる」はサーバー呼び出しなしで行が消え DB は pending 維持。全行処理後に締めメッセージ（`HOUSEKEEPING_DONE_REPLY`）へ置き換わることを確認。
- **「難しい」反応 → LLM で緩和版タスク生成** → 親を softened に、子（緩和版）を pending で插入。親が既に completed の場合は ALREADY_REACTED で fail over（失敗時 UI は行を復元可能）。
- **テスト: 12 ファイル / 128 件全緑**（`bun run test`）、`bun run check` 通過。
- **設計書 §9.4 の「タイムアウト archive」も動作確認**。nudged のまま 7 日放置 → リロード時に自動 archive（ナッジカード消滅）。

---

## Phase 4（振り返りと演出）

### 採用した判断

- **月次振り返りは「前月分」の completed seeds を引用**。設計書 §9.3 は「当月分」だが、月初表示では当月がほぼ空になる矛盾があり、ユーザー決定で前月分に変更（設計書からの意図的な逸脱）。
- **claim-then-generate 方式**: `profiles.last_review_month` ('YYYY-MM') を LLM 呼び出し前に条件付き UPDATE で claim。WHERE は `IS NULL OR last_review_month < currentLabel` の**単調ガード**（`!=` だと月境界のストラグラーリクエストがラベルを巻き戻す ABA 反例がある。'YYYY-MM' はゼロ埋め固定長で辞書順=時系列順、check 制約で保証）。fetchIntensity は claim より前に取得（claim 後に throw しうる処理を排除）。
- **review 分岐は 12 時間ゲートの内側**。順序は ① 棚卸し → ② 月次振り返り → ③ pending 0 チェック → ④ 新規ナッジ。review は `nudged_at` を更新しない。nudged 再表示が残っている限り review は出ない（再表示優先）。
- **振り返りは直前月のみ・スキップ月は永久に対象外**。未起動期間や棚卸し優先で月をまたぐと、claim が最新月ラベルへ一気に進むため間の月は振り返られない。ゆるいアプリの思想上許容。
- **claim 後のプロセス断で当月分の振り返りが飛ぶ at-most-once を許容**。LLM 失敗はフォールバック文が返るので表示される。exactly-once 化は MVP に過剰。
- **月判定は JST 固定**。UTC+9 オフセット計算のみ、ライブラリ不要。`jstMonthRange()` 純関数。
- **累計セリフ**: サーバー側で確率ロール（`TALLY_MENTION_PROBABILITY=0.3`）→ 当たったときだけ completed 総数 COUNT → `TALLY_MENTION_MIN_COUNT=3` 件以上なら `generateCompletionReply()` に渡す。`random` は `now` と同じ流儀でテスト用に注入可能。
- **親子再提案**: 子 completed 時に親が softened ならカード表示。「やってみる」は `postReviveParent()`（softened→pending の条件付き UPDATE、静的応答、即時ナッジなし）。**「今はいいや」はクライアント完結**（server fn 呼ばず DB 不変）。UI のカード状態更新は messageId スコープ・server 呼び出しは parentSeedId（parentSeedId スコープだと消費済みカード再活性の恐れ）。別タブ経由の ABA（古いカードから新しい softened エピソードへの revive）は合法遷移の範囲で無害（余剰 pending は棚卸しで自己回復）。
- **SVG 羊（NudgeySheep）**: 単一 SVG + 条件付き `<g>` で3状態（chill / sharp=メガネ / happy=笑い目+頬）。fill は既存 CSS 変数でテーマ追従。**固定 div は island-shell の外（main の兄弟）に配置**（island-shell の backdrop-filter が position:fixed の containing block を確立し、section 内に置くと真の固定にならないため）。
- **celebrating は debounce-reset 方式**: completed 成功時のみ発火（archived/softened/alreadyReacted では発火しない）、トリガ冒頭で clearTimeout → 再セット 2500ms。連続完了で早期打ち切りされない。
- **アニメーションは motion パッケージ**（framer-motion の現行名。import は `motion/react`。motion@12）。カード3種（Nudge/Housekeeping/ParentSuggestion）の登場は motion.li の spring、羊は motion.g + variants + AnimatePresence（メガネ fade+drop、happy 小ジャンプ）。**テキストバブルと island-shell は既存 CSS .rise-in のまま**（SSR 初期描画は CSS が確実、という棲み分け）。motion は src/server/ 配下に import しない（Workers SSR ビルド対策）。
- **reduced-motion は2層対応**: `__root.tsx` の `<MotionConfig reducedMotion="user">` + styles.css の `@media (prefers-reduced-motion: reduce) { .rise-in { animation: none; } }`。ChatTimeline の scrollIntoView も reduce 時は "auto"。
- **反応後のナッジー応答は引き続き DB 非保存**（Phase 3 の方針踏襲。月次振り返り・親子再提案カード・累計セリフもリロードで消える）。

### 検証結果（2026-07-18）

- **月次振り返りの server ロジックはローカル Supabase に対する検証スクリプトで4ケース確認済み**: ① 未振り返り・completed 0件で claim して none、② 同月内再訪問は SELECT のみ、③ 未来ラベルからの単調ガード（claim 0行で巻き戻らない）、④ 前月 completed ありで実 LLM 呼び出しによる review 生成。
- **テスト: 14 ファイル 192 件全緑**（`bun run test`）、`bun run check` 通過、`bun run build`（Workers）通過。
- **ブラウザでの実機フロー検証（親子再提案カード操作・羊の状態切替とアニメーション・reduced-motion 動作）は未実施**。実施したら本節を更新すること。

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
