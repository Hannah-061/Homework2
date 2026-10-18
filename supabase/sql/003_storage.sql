-- 003：圖片資料夾 chat-images
-- 公開讀取（訊息裡的圖片網址誰都看得到，網址是隨機的）；上傳限制：單檔 5 MB、只收 4 種格式。
-- 瀏覽器只能把圖片上傳到「自己的身分」命名的資料夾，不能改、不能刪（舊圖片由清理程式刪除）。
-- 在 Supabase 後台 SQL Editor 貼上並執行。可以重複執行。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images',
  'chat-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "signed-in users upload to own folder" on storage.objects;
create policy "signed-in users upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
