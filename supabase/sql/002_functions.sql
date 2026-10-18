-- 002：資料庫函式。瀏覽器要做的事（進入、送訊息、收回、檢舉）全部走這裡，
-- 所有檢查（代號規則、字數、頻率限制、是不是本人）都在這裡做，不信任瀏覽器。
-- 錯誤用「錯誤碼」回報（例如 NICKNAME_TAKEN），前端再轉成中英文說明。
-- 在 Supabase 後台 SQL Editor 貼上並執行。可以重複執行。
-- 對應 docs/architecture.md 5.2、5.5、9 節。

-- ---------- 進入：登記代號 ----------
create or replace function public.claim_nickname(p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  n text := btrim(p_nickname);
  k text;
  cnt integer;
  rec public.active_users;
begin
  if uid is null then raise exception 'NOT_JOINED'; end if;

  -- 代號規則：1 到 12 個字（這裡用寬鬆的 48 個字元上限，因為一個 emoji 可能由好幾個字元組成；
  -- 精確的「12 個字」由前端檢查），不可含控制字元與看不見的字元（零寬空白、文字方向控制字元…）
  if n is null or char_length(n) = 0 or char_length(n) > 48
     or n ~ E'[\\u0001-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]'
  then
    raise exception 'NICKNAME_INVALID';
  end if;

  -- 比對重複時，忽略大小寫、全形半形
  k := lower(normalize(n, NFKC));

  -- 超過 60 秒沒回報「我還在」的人，視為已離開，釋放他的代號
  delete from public.active_users where last_seen < now() - interval '60 seconds';

  -- 聊天室已滿：180 人（Supabase 免費方案的即時連線上限是 200，留 20 個緩衝）
  if not exists (select 1 from public.active_users where user_id = uid) then
    select count(*) into cnt from public.active_users;
    if cnt >= 180 then raise exception 'ROOM_FULL'; end if;
  end if;

  begin
    insert into public.active_users (user_id, nickname, nickname_key)
    values (uid, n, k)
    on conflict (user_id) do update
      set nickname     = excluded.nickname,
          nickname_key = excluded.nickname_key,
          last_seen    = now(),
          joined_at    = case when public.active_users.nickname_key = excluded.nickname_key
                              then public.active_users.joined_at else now() end
    returning * into rec;
  exception when unique_violation then
    -- 別人已經在用這個代號
    raise exception 'NICKNAME_TAKEN';
  end;

  return jsonb_build_object('user_id', rec.user_id, 'nickname', rec.nickname, 'joined_at', rec.joined_at);
end
$$;

-- ---------- 在線期間：每 20 秒回報一次「我還在」 ----------
create or replace function public.heartbeat()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.active_users set last_seen = now() where user_id = auth.uid();
  if not found then raise exception 'NOT_JOINED'; end if;
end
$$;

-- ---------- 離開：釋放代號 ----------
create or replace function public.release_nickname()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.active_users where user_id = auth.uid();
$$;

-- ---------- 送訊息（文字或圖片） ----------
create or replace function public.send_message(
  p_kind       text,
  p_text       text    default null,
  p_image_path text    default null,
  p_width      integer default null,
  p_height     integer default null
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
  m public.messages;
begin
  if uid is null then raise exception 'NOT_JOINED'; end if;

  select * into u from public.active_users where user_id = uid;
  if not found then raise exception 'NOT_JOINED'; end if;

  -- 頻率限制：10 秒內最多 5 則（含圖片）
  select count(*), min(created_at) into recent, oldest
    from public.messages
   where sender_id = uid and created_at > now() - interval '10 seconds';
  if recent >= 5 then
    raise exception 'RATE_LIMITED'
      using hint = greatest(1, ceil(extract(epoch from (oldest + interval '10 seconds' - now()))))::text;
  end if;

  if p_kind = 'text' then
    t := btrim(p_text, E' \t\r\n');
    if t is null or char_length(t) = 0 then raise exception 'TEXT_EMPTY'; end if;
    -- 精確的「500 個字」由前端檢查；這裡用 1000 個字元當作防濫用的硬上限
    if char_length(t) > 1000 then raise exception 'TEXT_TOO_LONG'; end if;

    insert into public.messages (sender_id, nickname, kind, body)
    values (uid, u.nickname, 'text', t)
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

    insert into public.messages (sender_id, nickname, kind, image_path, image_width, image_height)
    values (uid, u.nickname, 'image', p_image_path, p_width, p_height)
    returning * into m;

  else
    raise exception 'TEXT_EMPTY';
  end if;

  update public.active_users set last_seen = now() where user_id = uid;
  return to_jsonb(m);
end
$$;

-- ---------- 收回自己的訊息 ----------
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

  -- 內容清掉，所有人只會看到「這則訊息已被收回」。圖片檔案之後由清理程式刪除。
  update public.messages
     set status = 'retracted', body = null, image_path = null, image_width = null, image_height = null
   where id = p_id;
  delete from public.translations where message_id = p_id;
end
$$;

-- ---------- 檢舉別人的訊息 ----------
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

  -- 累積 3 人檢舉就遮住
  select count(*) into cnt from public.message_reports where message_id = p_id;
  if cnt >= 3 then
    update public.messages set status = 'hidden' where id = p_id and status = 'normal';
  end if;
end
$$;

-- ---------- 誰可以呼叫這些函式：只有已取得匿名身分的人 ----------
revoke execute on function public.claim_nickname(text)                               from public, anon;
revoke execute on function public.heartbeat()                                        from public, anon;
revoke execute on function public.release_nickname()                                 from public, anon;
revoke execute on function public.send_message(text, text, text, integer, integer)  from public, anon;
revoke execute on function public.retract_message(uuid)                              from public, anon;
revoke execute on function public.report_message(uuid)                               from public, anon;

grant execute on function public.claim_nickname(text)                                to authenticated;
grant execute on function public.heartbeat()                                         to authenticated;
grant execute on function public.release_nickname()                                  to authenticated;
grant execute on function public.send_message(text, text, text, integer, integer)   to authenticated;
grant execute on function public.retract_message(uuid)                               to authenticated;
grant execute on function public.report_message(uuid)                                to authenticated;
