# 認証フロー

ゆるなっじにおける認証・認可の仕組みを整理する。
DB アクセス側の話は [`./db-access-pattern.md`](./db-access-pattern.md) を参照。

---

## 1. 設計方針（MVP）

| 項目                    | 採った方針                                                                     |
| ----------------------- | ------------------------------------------------------------------------------ |
| ユーザー認証            | **なし**。`APP_USER_ID` を環境変数で固定（MVP は単一ユーザー前提）             |
| API 保護                | **Server Function 単位の Bearer または Cookie 検証**                           |
| ブラウザ ↔ Worker       | **HttpOnly Cookie**（ブラウザに API_SECRET_KEY を漏らさない）                  |
| 外部クライアント / curl | `Authorization: Bearer <API_SECRET_KEY>` ヘッダ                                |
| RLS                     | 使わない。Server Function が唯一の DB 窓口なので不要                           |
| 将来の認証導入          | `createMiddleware` の差し替えだけで Supabase Auth 等に移行できる構造を維持する |

---

## 2. 登場人物

### 2.1 環境変数

| 変数             | 役割                                             |
| ---------------- | ------------------------------------------------ |
| `APP_USER_ID`    | 固定ユーザー ID（DB 上の `profiles.user_id`）    |
| `API_SECRET_KEY` | Cookie 値・Bearer 値の両方に使う共有シークレット |

### 2.2 ミドルウェア

| ファイル                                  | 種類               | 役割                                                                                      |
| ----------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `src/server/middleware/session-cookie.ts` | helper             | Cookie 名の定数、parse / build ユーティリティ                                             |
| `src/server/middleware/session.ts`        | request middleware | レスポンスに `Set-Cookie` を仕込む（必要なときだけ）                                      |
| `src/server/middleware/auth.ts`           | request middleware | リクエストの Cookie / Authorization ヘッダを検証、`context.userId` を注入                 |
| `src/start.ts`                            | global config      | `createStart({ requestMiddleware: [sessionMiddleware] })` で session を全リクエストに適用 |

### 2.3 Cookie の実体

```
app_session=<API_SECRET_KEY>; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000
```

| 属性       | 値                  | 意図                                   |
| ---------- | ------------------- | -------------------------------------- |
| `HttpOnly` | あり                | JS から読めない（XSS で抜かれない）    |
| `SameSite` | `Lax`               | 同一サイト送信、外部からの CSRF を抑制 |
| `Path`     | `/`                 | サイト全体で送信                       |
| `Max-Age`  | 1 年（31536000 秒） | 都度ログイン UI が無いので長め         |

---

## 3. リクエスト経路ごとのフロー

### 3.1 初回 SSR（Cookie なし）

```
ブラウザ ──GET /──>  Worker
                    ├── sessionMiddleware (request)
                    │     ├── next() 実行
                    │     │   ├── ルートマッチ → /, loader 実行
                    │     │   │     └── getProfile() を直接呼び出し（HTTP を介さず関数として）
                    │     │   │           ├── authMiddleware (request)
                    │     │   │           │     ├── pathname が "/_serverFn/" で始まるか?
                    │     │   │           │     └── No → bypass、context.userId を注入  ◆
                    │     │   │           └── handler: createDb → SELECT/INSERT → return
                    │     │   └── レンダリング
                    │     └── result.response.headers.append("Set-Cookie", ...)  ◆
                    └── HTML を返す（profile データ込み）
```

**◆ 2 つのポイント：**

1. **auth middleware は `pathname` で「HTTP server fn 呼び出し」と「内部直接呼び出し」を判別する**。SSR loader が getProfile を呼ぶときは pathname が undefined または `/`、`/_serverFn/...` 以外。これは「同じプロセス内の信頼された呼び出し」なので Cookie/Bearer 無しで通過させる。
2. **session middleware がレスポンスに Set-Cookie を付ける**。これにより、ブラウザは次回以降 Cookie を送る。

### 3.2 2 回目以降のリクエスト（ブラウザ navigation）

ブラウザが `/some-route` に遷移するとき、TanStack Router はクライアント側で loader を実行 → `getProfile()` を **HTTP server fn として** 呼ぶ：

```
ブラウザ ──POST /_serverFn/<id>──>  Worker
       (Cookie: app_session=...)
                      ├── sessionMiddleware
                      │     ├── 既に正しい Cookie が入っている → Set-Cookie は再発行しない
                      │     └── next()
                      ├── server fn invocation
                      │     ├── authMiddleware
                      │     │     ├── pathname が "/_serverFn/" で始まる → 検証する
                      │     │     ├── Cookie 値と env.API_SECRET_KEY を比較
                      │     │     └── 一致 → context.userId 注入、通過
                      │     └── handler: createDb → クエリ → return
                      └── JSON レスポンス
```

### 3.3 外部クライアント / curl から叩く

```bash
curl -H "Authorization: Bearer $API_SECRET_KEY" https://your-app.workers.dev/_serverFn/<id>
```

```
外部 ──POST /_serverFn/<id>──>  Worker
     (Authorization: Bearer ...)
                      ├── sessionMiddleware
                      │     └── Cookie 無しなので Set-Cookie 発行（無害）
                      ├── authMiddleware
                      │     ├── pathname OK
                      │     ├── Cookie ない → fail
                      │     ├── Authorization ヘッダ確認 → "Bearer <env.API_SECRET_KEY>" と一致
                      │     └── 通過
                      └── handler 実行
```

### 3.4 認証情報なしで叩いた場合

```
外部 ──POST /_serverFn/<id>──>  Worker
                      ├── authMiddleware
                      │     ├── pathname OK
                      │     ├── Cookie / Authorization どちらも一致せず
                      │     └── return new Response("Unauthorized", { status: 401 })
                      └── 401
```

---

## 4. なぜこの設計にしたか（記憶喪失対策）

### 4.1 Bearer をブラウザに露出しないため

「Bearer 認証」と書くと普通は `Authorization: Bearer <token>` をクライアントから送る形。しかし MVP は **API_SECRET_KEY を環境変数として持つ単一の値**。ブラウザに渡すと：

- JS で読める → XSS で漏洩
- DevTools で素人でも見られる
- 流出すると外部から API を叩き放題

→ ブラウザ用には HttpOnly Cookie（JS から読めない）として配り、curl 等の外部用には Authorization ヘッダで受け付ける、という二経路にした。

### 4.2 SSR loader の HTTP 境界 bypass

Cookie が無い状態の **初回 SSR** でも `getProfile()` の loader を成功させたい。しかし auth middleware が一律で Cookie/Bearer を要求すると、初回はまだ Cookie が発行されていないので 401 になり、画面が空欄でレンダリングされる（ニワトリ・卵問題）。

解決：**auth middleware に到達するときの `pathname`** を見て、HTTP リクエストとして来ている場合だけ検証する。SSR loader からの直接呼び出しは「同じプロセス内の信頼された呼び出し」として bypass する。

```ts
// auth.ts 抜粋
export const authMiddleware = createMiddleware().server(async ({ next, request, pathname }) => {
  const isHttpServerFnCall = pathname?.startsWith("/_serverFn/") ?? false;
  if (!isHttpServerFnCall) {
    return next({ context: { userId: env.APP_USER_ID } });
  }
  // ... Cookie / Bearer 検証
});
```

### 4.3 session middleware を global にした理由

各 server fn に attach すると **ブラウザの最初の SSR ページ描画**で Cookie が発行されない（その時点では server fn を呼んでいないか、または auth bypass パスで sessionMiddleware は走らない）。Set-Cookie はあくまで **ページの応答ヘッダ**として付けたい。

→ `createStart` の `requestMiddleware` に登録し、**全リクエスト共通**で動かす（`src/start.ts`）。

---

## 5. テストでの担保

`src/server/middleware/auth.test.ts` と `session.test.ts` で 17 ケースを担保している（[`./testing.md`](./testing.md) も参照）。代表ケース：

| ケース                                                  | 期待動作                                |
| ------------------------------------------------------- | --------------------------------------- |
| Authorization も Cookie も無し（pathname=/\_serverFn/） | 401                                     |
| Cookie が一致                                           | 通過、context.userId 注入               |
| Bearer が一致                                           | 通過                                    |
| Cookie 不一致だが Bearer 一致                           | 通過（OR 判定）                         |
| pathname が `/`（SSR）                                  | Cookie/Bearer 無しでも通過              |
| pathname が undefined（TanStack Start の SSR-direct）   | Cookie/Bearer 無しでも通過              |
| Cookie 無くてレスポンスに送られた場合                   | session middleware が Set-Cookie を発行 |
| 既に正しい Cookie がある                                | session middleware は再発行しない       |

---

## 6. 本番運用

### 6.1 シークレットの登録

ローカル `.env.local` で使ったのと別の **強い乱数（≥32 文字）** を本番用に生成する：

```bash
# 例
openssl rand -hex 32
# → 64 文字の hex 文字列
```

それを Cloudflare Workers の secret として登録：

```bash
wrangler secret put API_SECRET_KEY    # 上で作った値を貼る
wrangler secret put APP_USER_ID       # 本番で識別したい値
```

### 6.2 ローテーション

API_SECRET_KEY を変えたいとき：

1. `wrangler secret put API_SECRET_KEY` で新しい値を登録
2. デプロイ
3. **ブラウザの古い Cookie は次回アクセス時に「値が違う」と判定され、session middleware が新しい値で上書き発行する**（実装済）
4. 外部 curl 等は Authorization ヘッダを新しい値に差し替える必要がある

### 6.3 漏洩時の対応

API_SECRET_KEY が外部に流出した想定：

1. 直ちに `wrangler secret put API_SECRET_KEY` で新しい値に差し替え（上書きされる）
2. デプロイ
3. 旧シークレットを使う curl / 外部スクリプトは即無効化される
4. Cloudflare Workers のログで不審なアクセスを確認（`wrangler tail`）

### 6.4 Cloudflare Access による前段保護（フェーズ5〜）

§3.1 のとおり session middleware は**アクセスしてきた全リクエストに API_SECRET_KEY 入り Cookie を配布する**ため、URL に到達した人は誰でも全 Server Function（Gemini 呼び出し含む）を実行できてしまう。`*.workers.dev` はスキャナに発見され得るので、アプリのコード変更ゼロで防御できる **Cloudflare Access** を前段に置いている（2026-07-19 設定、Issue #2）。

| 項目           | 値                                                                               |
| -------------- | -------------------------------------------------------------------------------- |
| チームドメイン | `kimura141899.cloudflareaccess.com`                                              |
| Access アプリ  | `yuru-nudge - Cloudflare Workers`（self_hosted）                                 |
| 保護対象       | `yuru-nudge.kimura141899.workers.dev` と `*-yuru-nudge.…`（プレビュー URL 含む） |
| ポリシー       | kimura141899@gmail.com のみ許可（One-time PIN ログイン）                         |
| セッション期間 | 730h（約 1 ヶ月。iOS スタンドアロン PWA でのログイン画面遷移を減らすため）       |

- リクエストは **Worker がロードされる前に** Access で評価される。未認証は `cloudflareaccess.com` のログイン画面へ 302
- Worker 側では Access JWT（`Cf-Access-Jwt-Assertion`）の検証はしていない。単一ユーザー MVP であり、Access 突破後も §3 の Cookie/Bearer 検証が第二層として残るため
- 設定変更はダッシュボード（Workers & Pages → yuru-nudge → Settings → Domains & Routes）または Access API で行う
- **将来アプリ内に本認証（§7）を入れた時点で、この Access 前段は外す方針**（多人数利用と両立しないため）

> iOS スタンドアロン PWA（ホーム画面追加）で起動した場合、Safari とクッキーコンテナが分離されるため初回起動時は必ずこの Access ログインが走る。OTP の受け取り方を含む運用は [`./pwa.md`](./pwa.md) §4 を参照。

---

## 7. 将来の認証導入（MVP 後）

[`docs/design/detailed-design.md`](./design/detailed-design.md) §15 で「Supabase Auth 等を追加。`createMiddleware` として差し込む」と決めてある。差し替えが効くように現在の構造を選んだ。

| 段階                     | 差し替えポイント                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Supabase Auth 導入       | `auth.ts` の中身を「Supabase の access token を verify → user_id 抽出」に置き換え     |
| ブラウザ側 Cookie の扱い | `session.ts` を撤去し、Supabase Auth の発行する `sb-access-token` Cookie に乗り換える |
| RLS                      | 必要に応じて DB 側で `(select auth.uid()) = user_id` の RLS ポリシーを追加            |
| 環境変数                 | `APP_USER_ID`, `API_SECRET_KEY` を撤去、Supabase の anon/service role キーに切り替え  |
| Cloudflare Access        | 前段保護（§6.4）を撤去。Access アプリを削除し、アプリ内認証に一本化する               |

API レイヤ（`createServerFn().middleware([authMiddleware])`）と DB レイヤ（Kysely）はそのまま使い続けられる。

---

## 8. アンチパターン（やらないこと）

| やらないこと                                                        | 理由                                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| クライアント側 .client middleware で `Authorization` ヘッダを付ける | API_SECRET_KEY をクライアントバンドルに含める必要があり漏洩する            |
| Cookie に `HttpOnly` を付け忘れる                                   | JS 経由で漏洩可能になる                                                    |
| `SameSite=None` にする                                              | クロスサイトに送られて CSRF 被害が広がる                                   |
| pathname を見ないで一律検証                                         | SSR 初回ロードで loader が必ず 401 になる                                  |
| API_SECRET_KEY をリポジトリにコミット                               | `.env.local` は gitignore 必須。`.env.example` には空のキー名のみ書く      |
| 「ローカル用の API_SECRET_KEY」を本番でも使う                       | ローカル値は弱い文字列（例: `local-dev-secret-change-me`）。本番は強い乱数 |
