-- 001：資料表、存取規則（RLS）、即時通知
-- 在 Supabase 後台 SQL Editor 貼上並執行。可以重複執行，不會重複建立。
-- 對應 docs/architecture.md 3.2、5.5、9 節。

-- ============ 資料表 ============

-- 訊息。瀏覽器只能「讀」，寫入一律走 002 裡的函式（在那裡檢查字數、頻率…）。
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null,
  nickname     text not null,
  kind         text not null check (kind in ('text', 'image')),
  body         text,
  image_path   text,
  image_width  integer,
  image_height integer,
  status       text not null default 'normal' check (status in ('normal', 'retracted', 'hidden')),
  created_at   timestamptz not null default now()
);
create index if not exists messages_created_at_idx on public.messages (created_at desc);
create index if not exists messages_sender_created_idx on public.messages (sender_id, created_at desc);

-- 檢舉：每人每則只能一筆（主鍵就是這個限制）
create table if not exists public.message_reports (
  message_id  uuid not null references public.messages (id) on delete cascade,
  reporter_id uuid not null,
  created_at  timestamptz not null default now(),
  primary key (message_id, reporter_id)
);

-- 目前佔用代號的人。nickname_key 是「忽略大小寫、全形半形」之後的代號，唯一，
-- 所以兩個人同時搶同一個代號時，資料庫會讓其中一個失敗。
create table if not exists public.active_users (
  user_id      uuid primary key,
  nickname     text not null,
  nickname_key text not null unique,
  joined_at    timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);

-- 翻譯與連結預覽的快取（階段二後半才會用到；先建好）
create table if not exists public.translations (
  message_id  uuid not null references public.messages (id) on delete cascade,
  target_lang text not null check (target_lang in ('zh', 'en')),
  result      text not null,
  created_at  timestamptz not null default now(),
  primary key (message_id, target_lang)
);

create table if not exists public.link_previews (
  url        text primary key,
  data       jsonb not null,
  created_at timestamptz not null default now()
);

-- 翻譯的每日額度計數（全站每天上限）與每人頻率限制用
create table if not exists public.translate_usage (
  day   date primary key,
  count integer not null default 0
);
create table if not exists public.translate_calls (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists translate_calls_idx on public.translate_calls (user_id, at desc);

-- ============ 存取規則（RLS） ============
-- 全部打開 RLS。沒有寫「允許」的規則，就是不允許。

alter table public.messages         enable row level security;
alter table public.message_reports  enable row level security;
alter table public.active_users     enable row level security;
alter table public.translations     enable row level security;
alter table public.link_previews    enable row level security;
alter table public.translate_usage  enable row level security;
alter table public.translate_calls  enable row level security;

-- 已經取得匿名身分的人（role = authenticated）可以讀訊息；其他一律不行。
-- 沒有 insert / update / delete 規則 → 瀏覽器直接寫入會被拒絕。
drop policy if exists "signed-in users can read messages" on public.messages;
create policy "signed-in users can read messages"
  on public.messages for select
  to authenticated
  using (true);

-- 收回所有表對「沒登入的人」與一般使用者的直接存取權（資料表權限的第二道鎖）
revoke all on public.messages         from anon, authenticated;
revoke all on public.message_reports  from anon, authenticated;
revoke all on public.active_users     from anon, authenticated;
revoke all on public.translations     from anon, authenticated;
revoke all on public.link_previews    from anon, authenticated;
revoke all on public.translate_usage  from anon, authenticated;
revoke all on public.translate_calls  from anon, authenticated;
grant select on public.messages to authenticated;

-- ============ 即時通知 ============
-- 讓訊息表的新增、更新（收回、被遮住）即時推給所有連線中的人
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end
$$;
