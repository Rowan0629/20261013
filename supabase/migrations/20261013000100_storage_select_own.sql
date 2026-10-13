-- ============================================================================
-- 補丁：讓使用者能刪除「自己資料夾」裡的圖片
--
-- 原因：Supabase 圖片倉庫刪檔案之前，要先能「讀到」那個檔案。
-- 第一份 SQL 只給了上傳與刪除，沒給讀取，所以刪除會回 Access denied。
--
-- 這條規則只開放讀「自己資料夾」。別人的檔案仍然看不到、列不出來。
-- 圖片的公開網址（顯示在聊天室裡）不受影響，因為倉庫本身是公開的。
-- 可重複執行。
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'chat_images_read_own'
  ) then
    create policy chat_images_read_own on storage.objects
      for select to authenticated
      using (
        bucket_id = 'chat-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
