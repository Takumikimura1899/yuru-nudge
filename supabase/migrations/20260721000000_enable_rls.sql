-- Supabase Security Advisor の "RLS Disabled in Public" 警告への対応。
-- アプリの DB アクセスは Server Function → Kysely（postgres ロール＝テーブルオーナー）のみで
-- RLS の影響を受けない。ポリシーを作らないことで Data API (PostgREST) 経由の
-- anon / authenticated アクセスを全面拒否する。

alter table profiles enable row level security;
alter table mutterings enable row level security;
alter table seeds enable row level security;
