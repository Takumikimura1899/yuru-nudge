-- ゆるなっじ 初期スキーマ
-- 設計詳細: docs/design/detailed-design.md §13

create extension if not exists "pgcrypto";

create table profiles (
  user_id text primary key,
  intensity_level text not null default 'chill'
    check (intensity_level in ('chill', 'sharp')),
  created_at timestamptz not null default now()
);

create table mutterings (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(user_id) on delete cascade,
  content text not null check (char_length(content) <= 140),
  category text not null check (category in ('seed', 'mood')),
  created_at timestamptz not null default now()
);

create index mutterings_user_created_idx
  on mutterings (user_id, created_at desc);

create table seeds (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references profiles(user_id) on delete cascade,
  muttering_id uuid not null references mutterings(id) on delete cascade,
  processed_task text not null,
  status text not null default 'pending'
    check (status in ('pending', 'nudged', 'completed', 'softened', 'archived')),
  parent_id uuid references seeds(id) on delete set null,
  prophecy text,
  nudged_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index seeds_user_status_idx on seeds (user_id, status);
create index seeds_parent_idx on seeds (parent_id);
