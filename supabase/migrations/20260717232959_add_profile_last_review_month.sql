-- 月次振り返りの表示済み管理カラムを追加
-- 'YYYY-MM'（JST基準の月ラベル）。claim-then-generate の冪等化キーとして使う
-- 詳細: docs/implementation-notes.md の Phase 4 セクションを参照
alter table profiles
  add column last_review_month text
  check (last_review_month ~ '^\d{4}-\d{2}$');
