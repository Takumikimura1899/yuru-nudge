# PWA 運用ノート

フェーズ5（2026-07、Issue #5）で実施した軽量 PWA 化の運用ノート。設計判断・スコープの背景は
[`./design/detailed-design.md`](./design/detailed-design.md) §12.5 を参照。
Cloudflare Access による前段保護の詳細は [`./auth-flow.md`](./auth-flow.md) §6.4 を参照。

> **軽量版であることに注意**: マニフェスト・アイコン・静的アセットキャッシュのみ実装している。
> オフライン対応・プッシュ通知はスコープ外（詳細設計書 §15 の未決定事項一覧のまま）。

---

## 1. 構成要素

| 要素             | ファイル               | 内容                                                                          |
| ---------------- | ---------------------- | ----------------------------------------------------------------------------- |
| Web App Manifest | `public/manifest.json` | `name`「ゆるなっじ」、`display: standalone`、`theme_color #e7f3ec`            |
| アイコン         | `public/icon.svg` ほか | 羊のシルエットSVGを元に192/512/maskable/apple-touch-iconを生成                |
| Service Worker   | `public/sw.js`         | `/assets/` 配下のハッシュ付き静的アセットのみ cache-first。オフライン対応なし |

## 2. Service Worker のキャッシュ戦略

`public/sw.js` は以下の三重のガードで「意図しないキャッシュ」を防ぐ設計になっている。

1. **対象は `/assets/` 配下のハッシュ付き静的アセットのみ**。それ以外のリクエストはキャッシュ対象にせず素通しする
2. **ナビゲーションリクエスト（HTMLページ遷移）には一切介入しない**。SSRの都度最新のHTMLを返す必要があるため
3. **Cloudflare Access の 302 リダイレクトやログイン画面HTMLをキャッシュしない**。Access 前段保護（[`./auth-flow.md`](./auth-flow.md) §6.4）により未認証時は `cloudflareaccess.com` へ 302 されるが、この応答やログインHTMLがハッシュ付きアセットの皮を被って誤ってキャッシュされることは、上記1・2のガードに加えてこの三点目の防御で避けている

## 3. sw.js を変更したときの運用ルール

**`public/sw.js` の中身を変更したら、必ず `CACHE_NAME`（現在 `yuru-nudge-static-v1`）をバンプすること。**

- Service Worker はブラウザに永続化され、更新の検知はスクリプトのバイト差分で行われる。`CACHE_NAME` を変えずにキャッシュ対象や戦略だけ変更すると、新しい SW がインストールされても `caches.open(CACHE_NAME)` が同じキャッシュストアを指し続け、古いキャッシュが使い回されて変更が反映されないことがある
- バンプの命名は `yuru-nudge-static-v2`, `v3` ... と連番でよい

## 4. iOS スタンドアロン起動時の Cloudflare Access ログイン

Cloudflare Access の認可は Cookie ベース（[`./auth-flow.md`](./auth-flow.md) §6.4）。iOS で PWA をホーム画面に追加してスタンドアロンモードで起動すると、Safari とはクッキーコンテナが分離される。

- そのため **Safari で Access ログイン済みでも、スタンドアロン PWA の初回起動時は必ず Access のログイン画面（One-time PIN）が表示される**
- OTP を受け取ったら、**メール内のリンクは踏まない**。リンクを踏むと Safari アプリ側でページが開いてしまい、スタンドアロン PWA 側のセッションとしては認証されない
- 代わりに、**メールに記載されたコード（数字）を読み取り、スタンドアロン PWA 内のログイン画面に手入力する**
- 一度ログインすればセッションは 730h（約1ヶ月、[`./auth-flow.md`](./auth-flow.md) §6.4）保持されるため、以降はスタンドアロン起動のたびにログインを求められることはない

> iOS 実機での動作確認は未実施（今後実施予定）。

## 5. Android Chrome で PWA インストールできない問題（manifest 取得と Cookie）

Cloudflare Access 前段保護下（[`./auth-flow.md`](./auth-flow.md) §6.4）で、Android Chrome にインストールメニュー（「アプリをインストール」）が表示されない問題があった。

- Chrome は `<link rel="manifest">` の取得を、**同一オリジンであっても credentials 省略（Cookie を送らない）モードで行う仕様**になっている
- 本番は Cloudflare Access が Cookie（`CF_Authorization`）ベースで前段保護しているため、Cookie なしの manifest リクエストは `cloudflareaccess.com` への 302 リダイレクトになる（2026-07-21 に curl で確認済み）
- その結果 Chrome は「有効な manifest を取得できない」と判定し、Android Chrome にインストールメニューが出なかった

**対処**: `src/routes/__root.tsx` の manifest リンクに `crossOrigin: "use-credentials"` を追加し、manifest 取得時に Cookie を送るようにした。これにより Access ログイン済みのブラウザでは manifest が 200 で返る。

> 残る注意点
>
> - Access 未ログイン状態では、この対処後も Cookie 自体が無いためインストール判定は通らない
> - Access セッションが失効しかけのタイミングでは、manifest 取得が `cloudflareaccess.com` への
>   リダイレクトを挟むことで CORS モードの取得として失敗し、インストール判定が通らないことがある
>   （修正前と同じ挙動に縮退するだけで劣化ではない。再ログイン後は回復する）
> - manifest が参照するアイコンも Access 配下にある。将来インストール判定が再び失敗する場合は、Access 側に `/manifest.json` とアイコンパスのみ Bypass ポリシーを追加する選択肢がある（機密情報を含まないため実害はない）

## 6. アイコンの再生成手順

アイコンの元データは `public/icon.svg`（羊のシルエット）。編集後は以下のコマンドで各サイズを再生成する。

```bash
bun run icons
```

`scripts/generate-icons.ts` が `public/icon.svg` から 192x192 / 512x512 / maskable / apple-touch-icon を書き出す。
