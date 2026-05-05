# インフラ構成図

開発者がシステム構成を把握するための draw.io 図を置く場所。

## ファイル

| ファイル             | 内容                                                              | 状態               |
| -------------------- | ----------------------------------------------------------------- | ------------------ |
| `development.drawio` | 開発環境（macOS + mise + Vite+ + Docker Supabase + wrangler dev） | Phase 1 / 1.5 時点 |
| `production.drawio`  | 本番環境（Cloudflare Workers + Supabase Cloud + Gemini）          | 想定設計           |

## 開き方

- VS Code: 拡張 [Draw.io Integration (hediet.vscode-drawio)](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) を入れると `.drawio` を直接プレビュー・編集できる
- Web: <https://app.diagrams.net/> で「Open Existing Diagram」から開く
- Desktop: [drawio-desktop](https://github.com/jgraph/drawio-desktop) で開く

## 編集ルール

- **uncompressed XML 形式で保存**する（git diff を読めるようにするため）。draw.io の保存ダイアログで「Compressed」のチェックを外す
- 図に大きな変更を入れたら、必要に応じて `docs/implementation-notes.md` の対応セクションを更新する
- フェーズが進んで構成が変わったら、その時点の図を新規ファイル（`production-phase2.drawio` 等）として残すか、上書きで更新するかは運用で判断
- スタイルの一貫性のため、**凡例の配色は両図で揃える**：
  - 青 = ユーザ / クライアント / ランタイム
  - 緑 = サーバプロセス
  - 橙 = データストア
  - 紫 = ツール / 外部 SaaS
  - 黄 = ファイル / 機密情報
  - 破線 = オプション / 未着手 / Phase 2 以降
