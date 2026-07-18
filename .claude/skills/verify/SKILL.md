---
name: verify
description: ゆるなっじの実機検証手順。ブラウザ（Playwright MCP）でチャットフロー・ナッジ・月次振り返り・羊アニメーションを end-to-end で確認するときに読む。
---

# ゆるなっじ 実機検証レシピ（2026-07-18 実績）

## 起動

```bash
bun run dev   # バックグラウンド実行推奨。Supabase 起動込みで ~30-60秒
# 起動待ち: curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ が 200 になるまで
```

- DB 直結: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`
- 固定ユーザー: `APP_USER_ID=local-user`（.env.local）
- LLM は実 Gemini（GOOGLE_GENERATIVE_AI_API_KEY）。応答は 2〜10 秒揺れる

## テストデータの注意（ハマった）

- **seeds/mutterings の手作り UUID は RFC 4122 v4 準拠にすること**（第3グループ先頭=バージョン `4`、第4グループ先頭=バリアント `8/9/a/b`。例: `cccccccc-3333-4333-8333-333333333333`）。
  zod の `z.string().uuid()` は variant ビットまで検証するため、`dddddddd-4444-4444-4444-...` のような雑な UUID は server fn 入口で「Invalid UUID」拒否される（DB の uuid 型は通ってしまうので気づきにくい）
- seeds は mutterings への FK 必須。親子入替時は FK 順序に注意（parent_id を一旦 null に）

## 主要フローの作り方（DB 直接投入）

- **月次振り返り**: completed seed の `updated_at` を前月に、`profiles.last_review_month` を null に → リロードで振り返りバブル。再リロードで出ないこと（claim 冪等）も見る
- **ナッジ再表示**: seed を `status='nudged'`, `nudged_at` を直近（7日以内）に → リロードでカード
- **親子再提案**: 親 seed を `softened`、子 seed（`parent_id`=親）を `nudged` に → 子に「やったよ」→ 再提案カード →「やってみる」で親が pending になるのを DB で確認
- **新規ナッジ生成**: pending seed あり + 最終 `nudged_at` から12時間経過で LLM 選択が走る

## 羊（NudgeySheep）の状態検証

- メガネ: Sharp トグルで `[data-testid="glasses"]` が出る。要素スクリーンショットは `[aria-label="ナッジー"]`
- **喜び（celebrating 2.5秒）はツール往復では捕捉できない**。クリック**前**に browser_evaluate で MutationObserver を仕込み、`[data-testid="happy-face"]` の出現/消滅を timestamps 付きで window 変数に記録 → 後から読む。スクリーンショットでの捕捉は LLM 応答タイミング依存で運任せになる

## 後始末

検証データは `delete from seeds where user_id='local-user'; delete from mutterings where ...;`、`profiles.last_review_month` を null に戻す。撮ったスクリーンショットはリポジトリ直下に落ちるので削除。
