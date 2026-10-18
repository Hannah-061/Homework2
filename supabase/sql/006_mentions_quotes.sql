-- 006：提及（@）與引用
-- 做了三件事：
--  1) messages 表新增欄位：提到了誰、引用了哪一則（以及當時的摘要）
--  2) send_message 多兩個「可以不填」的參數（舊版前端照舊可以呼叫，不會壞）
--  3) retract_message、report_message：原訊息被收回或被遮住時，引用它的訊息裡的摘要一併清掉
-- 在 Supabase 後台 SQL Editor 貼上並執行。可以重複執行。
-- 對應 docs/architecture.md 5.4、5.5、9 節。

-- ============ 1) 新欄位 ============
alter table public.messages
  add column if not exists mentions        jsonb not null default '[]'::jsonb,
  add column if not exists reply_to        uuid,
  add column if not exists reply_sender_id uuid,
  add column if not exists reply_nickname  text,
  add column if not exists reply_preview   text,
  add column if not exists reply_kind      text check (reply_kind in ('text', 'image')),
  add column if not exists reply_state     text not null default 'normal' check (reply_state in ('normal', 'retracted', 'hidden'));
-- reply_to 刻意不設外鍵：原訊息超過 50 則被清掉後，引用它的訊息仍保留當時的摘要。

create index if not exists messages_reply_to_idx on public.messages (reply_to) where reply_to is not null;

-- ============ 2) 送訊息：多了 p_reply_to、p_mentions ============
-- 舊的 5 個參數版本先拿掉，換成 7 個參數的版本（後兩個有預設值，舊的呼叫方式照舊能用）。
drop function if exists public.send_message(text, text, text, integer, integer);

create or replace function public.send_message(
  p_kind       text,
  p_text       text    default null,
  p_image_path text    default null,
  p_width      integer default null,
  p_height     integer default null,
  p_reply_to   uuid    default null,
  p_mentions   jsonb   default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  u public.active_users;
  recent integer;
  oldest timestamptz;
  t text;
  q public.messages;
  m public.messages;
  ments jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'NOT_JOINED'; end if;

  select * into u from public.active_users where user_id = uid;
  if not found then raise exception 'NOT_JOINED'; end if;

  -- 頻率限制：10 秒內最多 5 則（含圖片）。引用與提及不會多算。
  select count(*), min(created_at) into recent, oldest
    from public.messages
   where sender_id = uid and created_at > now() - interval '10 seconds';
  if recent >= 5 then
    raise exception 'RATE_LIMITED'
      using hint = greatest(1, ceil(extract(epoch from (oldest + interval '10 seconds' - now()))))::text;
  end if;

  -- 引用：被引用的訊息必須存在、而且是正常狀態（已收回或被遮住的不能引用）
  if p_reply_to is not null then
    select * into q from public.messages where id = p_reply_to;
    if not found or q.status <> 'normal' then raise exception 'MESSAGE_NOT_FOUND'; end if;
  end if;

  if p_kind = 'text' then
    t := btrim(p_text, E' \t\r\n');
    if t is null or char_length(t) = 0 then raise exception 'TEXT_EMPTY'; end if;
    -- 精確的「500 個字」由前端檢查；這裡用 1000 個字元當作防濫用的硬上限
    if char_length(t) > 1000 then raise exception 'TEXT_TOO_LONG'; end if;

    -- 提及：最多 5 個；每個人必須「現在在線」、不是自己、而且文字裡真的有 @代號
    if p_mentions is not null and jsonb_typeof(p_mentions) = 'array' then
      if jsonb_array_length(p_mentions) > 5 then raise exception 'TOO_MANY_MENTIONS'; end if;
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'nickname', x.nickname)), '[]'::jsonb)
        into ments
        from (
          select distinct on (a.user_id) a.user_id, a.nickname
            from (
              select e ->> 'user_id' as id
                from jsonb_array_elements(p_mentions) e
               where jsonb_typeof(e) = 'object' and (e ->> 'user_id') ~ '^[0-9a-f-]{36}$'
            ) picked
            join public.active_users a on a.user_id::text = picked.id
           where a.user_id <> uid
             and position('@' || a.nickname in t) > 0
        ) x;
    end if;

    insert into public.messages
      (sender_id, nickname, kind, body, mentions,
       reply_to, reply_sender_id, reply_nickname, reply_kind, reply_preview)
    values
      (uid, u.nickname, 'text', t, ments,
       q.id, q.sender_id, q.nickname, q.kind,
       case when q.id is not null and q.kind = 'text' then left(q.body, 80) end)
    returning * into m;

  elsif p_kind = 'image' then
    -- 圖片必須是自己上傳到自己資料夾的檔案：<自己的身分>/<檔名>.jpg|png|gif|webp
    if p_image_path is null
       or p_image_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|gif|webp)$'
       or split_part(p_image_path, '/', 1) <> uid::text
       or not exists (
            select 1 from storage.objects
             where bucket_id = 'chat-images' and name = p_image_path
          )
    then
      raise exception 'IMAGE_TYPE_NOT_ALLOWED';
    end if;
    if p_width is null or p_height is null
       or p_width not between 1 and 4096 or p_height not between 1 and 4096
    then
      raise exception 'IMAGE_TOO_LARGE';
    end if;

    insert into public.messages
      (sender_id, nickname, kind, image_path, image_width, image_height,
       reply_to, reply_sender_id, reply_nickname, reply_kind, reply_preview)
    values
      (uid, u.nickname, 'image', p_image_path, p_width, p_height,
       q.id, q.sender_id, q.nickname, q.kind,
       case when q.id is not null and q.kind = 'text' then left(q.body, 80) end)
    returning * into m;

  else
    raise exception 'TEXT_EMPTY';
  end if;

  update public.active_users set last_seen = now() where user_id = uid;
  return to_jsonb(m);
end
$$;

revoke execute on function public.send_message(text, text, text, integer, integer, uuid, jsonb) from public, anon;
grant  execute on function public.send_message(text, text, text, integer, integer, uuid, jsonb) to authenticated;

-- ============ 3) 收回、檢舉：引用它的訊息一併處理 ============
create or replace function public.retract_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.messages;
begin
  if uid is null then raise exception 'NOT_JOINED'; end if;
  select * into m from public.messages where id = p_id;
  if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if m.sender_id <> uid then raise exception 'NOT_OWNER'; end if;

  -- 內容清掉（包含它自己的引用與提及），所有人只會看到「這則訊息已被收回」
  update public.messages
     set status = 'retracted', body = null, image_path = null, image_width = null, image_height = null,
         mentions = '[]'::jsonb,
         reply_to = null, reply_sender_id = null, reply_nickname = null, reply_preview = null, reply_kind = null,
         reply_state = 'normal'
   where id = p_id;
  -- 引用了它的訊息：摘要清掉，改顯示「這則訊息已被收回」
  update public.messages set reply_preview = null, reply_state = 'retracted' where reply_to = p_id;
  delete from public.translations where message_id = p_id;
end
$$;

create or replace function public.report_message(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  m public.messages;
  inserted integer;
  cnt integer;
begin
  if uid is null then raise exception 'NOT_JOINED'; end if;
  select * into m from public.messages where id = p_id;
  if not found then raise exception 'MESSAGE_NOT_FOUND'; end if;
  if m.sender_id = uid then raise exception 'CANNOT_REPORT_OWN'; end if;

  insert into public.message_reports (message_id, reporter_id)
  values (p_id, uid)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then raise exception 'ALREADY_REPORTED'; end if;

  -- 累積 3 人檢舉就遮住；引用它的訊息裡的摘要也一併遮住
  select count(*) into cnt from public.message_reports where message_id = p_id;
  if cnt >= 3 then
    update public.messages set status = 'hidden' where id = p_id and status = 'normal';
    update public.messages set reply_preview = null, reply_state = 'hidden' where reply_to = p_id;
  end if;
end
$$;

-- create or replace 不會動到原本的權限，這裡再確認一次
revoke execute on function public.retract_message(uuid) from public, anon;
revoke execute on function public.report_message(uuid)  from public, anon;
grant  execute on function public.retract_message(uuid) to authenticated;
grant  execute on function public.report_message(uuid)  to authenticated;
