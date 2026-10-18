-- 004：清理用的函式（只有後台的清理程式 cleanup 能呼叫）
--  - prune_messages()：只保留最新 50 則訊息，其餘刪除，回傳被刪訊息的圖片檔名
--  - orphan_images()：找出「沒有被任何訊息引用」且已上傳超過 5 分鐘的圖片
--    （被收回的圖片、送出失敗留下的圖片都會變成這種）
-- 圖片檔案本身要透過 Storage 的正式功能刪，直接用 SQL 刪只會刪掉紀錄、空間不會釋放，
-- 所以實際刪檔案的是 Edge Function cleanup（見 supabase/functions/cleanup）。
-- 在 Supabase 後台 SQL Editor 貼上並執行。可以重複執行。

create or replace function public.prune_messages()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  paths text[];
begin
  with keep as (
    select id from public.messages order by created_at desc limit 50
  ),
  del as (
    delete from public.messages m
     where m.id not in (select id from keep)
    returning m.image_path
  )
  select coalesce(array_agg(image_path) filter (where image_path is not null), '{}')
    into paths
    from del;
  return paths;
end
$$;

create or replace function public.orphan_images()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(o.name), '{}')
    from storage.objects o
   where o.bucket_id = 'chat-images'
     and o.created_at < now() - interval '5 minutes'
     and not exists (select 1 from public.messages m where m.image_path = o.name);
$$;

revoke execute on function public.prune_messages() from public, anon, authenticated;
revoke execute on function public.orphan_images()  from public, anon, authenticated;
grant  execute on function public.prune_messages() to service_role;
grant  execute on function public.orphan_images()  to service_role;
