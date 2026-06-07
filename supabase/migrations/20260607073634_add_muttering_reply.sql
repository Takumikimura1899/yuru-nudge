-- mutterings にナッジー応答を永続化する reply カラムを追加
-- 設計逸脱: チャット履歴（直近20件）でナッジーの発言を復元するため、
-- 1つぶやき = 1往復（content + reply）として保存する判断。
-- 詳細は docs/implementation-notes.md の Phase 2 セクションを参照。
alter table mutterings
  add column reply text;
