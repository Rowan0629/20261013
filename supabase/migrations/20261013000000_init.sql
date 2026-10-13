-- ============================================================================
-- 匿名聊天室：階段二資料庫設定
--
-- 用法：Supabase 後台 → SQL Editor → New query → 貼上整份 → Run。
-- 可以重複執行，不會把已經存在的資料弄壞。
--
-- 規則的來源是 docs/architecture.md 第 5、6 節：
--   * 前端「不能直接」新增、修改、刪除訊息，只能呼叫下面的函式（守門員）
--   * 守門員會檢查：有沒有登記代號、長度、頻率、是不是自己的訊息
-- ============================================================================


-- ---------- 0. 小工具：精確到毫秒的現在時間 ----------
-- 前端用 JavaScript 的時間（毫秒），資料庫預設到微秒。統一到毫秒，
-- 這樣「用時間往前分頁」「斷線後補資料」才不會因為四捨五入漏掉訊息。
create or replace function public.now_ms()
returns timestamptz
language sql
set search_path = ''
as $$ select date_trunc('milliseconds', clock_timestamp()) $$;


-- ---------- 1. 資料表 ----------

-- 訊息。刪除只是「標記」（deleted_at），那一列會留著，這樣別人的畫面才能顯示「此訊息已刪除」。
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,                        -- 發送者的匿名身分
  nickname    text not null,                        -- 發送當下的代號
  content     text not null default '',             -- 文字；被刪除時會清空
  image_path  text,                                 -- 圖片倉庫裡的路徑
  created_at  timestamptz not null default public.now_ms(),
  updated_at  timestamptz not null default public.now_ms(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  constraint messages_content_length check (char_length(content) <= 500),
  constraint messages_has_body check (
    deleted_at is not null or char_length(btrim(content)) > 0 or image_path is not null
  )
);

create index if not exists messages_created_idx on public.messages (created_at desc, id desc);
create index if not exists messages_updated_idx on public.messages (updated_at);

-- 代號登記。代號是「租」的：60 秒到期，前端每 20 秒續租一次。
create table if not exists public.nickname_claims (
  name_key     text primary key,                    -- 代號轉小寫，所以 Amy 與 amy 視為同一個
  display_name text not null,
  user_id      uuid not null unique,                -- 一個身分同時只能占一個代號
  expires_at   timestamptz not null
);


-- ---------- 2. 權限規則（RLS） ----------
alter table public.messages enable row level security;
alter table public.nickname_claims enable row level security;

-- 先收回所有人的直接權限，再只開放「登入過的人可以讀訊息」。
-- 匿名登入的使用者在資料庫裡就是 authenticated。
revoke all on public.messages from anon, authenticated;
revoke all on public.nickname_claims from anon, authenticated;
grant select on public.messages to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_read'
  ) then
    create policy messages_read on public.messages
      for select to authenticated using (true);
  end if;
end $$;
-- messages 沒有 insert / update / delete 規則 → 沒有人能直接寫入，只能走下面的函式。
-- nickname_claims 完全沒有規則 → 前端完全碰不到，只有函式能動它。


-- ---------- 3. 守門員（函式） ----------
-- 錯誤訊息固定是這幾個英文單字，前端會對應到中文提示：
--   not_joined / too_long / empty / invalid_image / rate_limited / not_owner

-- 3.1 登記（或續約）代號。回傳 'ok'、'taken'（被別人占用）、'invalid'（格式不合）
create or replace function public.claim_nickname(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := lower(p_name);
begin
  if v_uid is null then
    raise exception 'not_joined';
  end if;
  if p_name is null or p_name !~ '^[一-鿿A-Za-z0-9]{1,12}$' then
    return 'invalid';
  end if;

  -- 順手清掉已經到期的租約
  delete from public.nickname_claims where expires_at < now();
  -- 同一個身分換代號時，放掉舊的
  delete from public.nickname_claims where user_id = v_uid and name_key <> v_key;

  -- 沒人占用就登記；是自己的就續約；是別人的就什麼都不做（0 列）
  insert into public.nickname_claims (name_key, display_name, user_id, expires_at)
  values (v_key, p_name, v_uid, now() + interval '60 seconds')
  on conflict (name_key) do update
    set display_name = excluded.display_name,
        expires_at   = excluded.expires_at
    where public.nickname_claims.user_id = v_uid;

  if not found then
    return 'taken';
  end if;
  return 'ok';
end $$;

-- 3.2 釋放自己的代號
create or replace function public.release_nickname()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.nickname_claims where user_id = auth.uid();
$$;

-- 3.3 送出訊息
create or replace function public.send_message(p_text text, p_image_path text default null)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_nick   text;
  v_text   text := coalesce(btrim(p_text), '');
  v_recent int;
  v_row    public.messages;
begin
  if v_uid is null then
    raise exception 'not_joined';
  end if;

  -- 同一個人同時只處理一筆，頻率限制才算得準
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- 代號從登記資料讀，不接受前端傳入 → 沒辦法冒用別人的代號
  select display_name into v_nick
  from public.nickname_claims
  where user_id = v_uid and expires_at >= now();
  if v_nick is null then
    raise exception 'not_joined';
  end if;

  if char_length(v_text) > 500 then
    raise exception 'too_long';
  end if;
  if v_text = '' and p_image_path is null then
    raise exception 'empty';
  end if;
  -- 圖片只能是「自己資料夾」裡、隨機檔名的圖片檔
  if p_image_path is not null
     and p_image_path !~ ('^' || v_uid::text || '/[0-9a-f-]{36}\.(jpg|png|gif|webp)$') then
    raise exception 'invalid_image';
  end if;

  -- 頻率限制：10 秒內最多 5 則（被刪除的也算）
  select count(*) into v_recent
  from public.messages
  where user_id = v_uid and created_at > public.now_ms() - interval '10 seconds';
  if v_recent >= 5 then
    raise exception 'rate_limited';
  end if;

  insert into public.messages (user_id, nickname, content, image_path)
  values (v_uid, v_nick, v_text, p_image_path)
  returning * into v_row;
  return v_row;
end $$;

-- 3.4 編輯自己的訊息
create or replace function public.edit_message(p_id uuid, p_text text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_text text := coalesce(btrim(p_text), '');
  v_row  public.messages;
begin
  if v_uid is null then
    raise exception 'not_joined';
  end if;

  select * into v_row from public.messages where id = p_id for update;
  if not found or v_row.user_id <> v_uid or v_row.deleted_at is not null then
    raise exception 'not_owner';
  end if;

  if char_length(v_text) > 500 then
    raise exception 'too_long';
  end if;
  if v_text = '' and v_row.image_path is null then
    raise exception 'empty';
  end if;

  update public.messages
  set content    = v_text,
      edited_at  = public.now_ms(),
      updated_at = public.now_ms()
  where id = p_id
  returning * into v_row;
  return v_row;
end $$;

-- 3.5 刪除自己的訊息（標記刪除，並清空內容與圖片位置）
create or replace function public.delete_message(p_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.messages;
begin
  if v_uid is null then
    raise exception 'not_joined';
  end if;

  select * into v_row from public.messages where id = p_id for update;
  if not found or v_row.user_id <> v_uid then
    raise exception 'not_owner';
  end if;
  if v_row.deleted_at is not null then
    return v_row; -- 已經刪過了，當作成功
  end if;

  update public.messages
  set content    = '',
      image_path = null,
      deleted_at = public.now_ms(),
      updated_at = public.now_ms()
  where id = p_id
  returning * into v_row;
  return v_row;
end $$;

-- 只有登入過的人（含匿名）能呼叫這些函式，沒登入的不行
revoke execute on function public.claim_nickname(text)            from public, anon;
revoke execute on function public.release_nickname()              from public, anon;
revoke execute on function public.send_message(text, text)        from public, anon;
revoke execute on function public.edit_message(uuid, text)        from public, anon;
revoke execute on function public.delete_message(uuid)            from public, anon;
grant  execute on function public.claim_nickname(text)            to authenticated;
grant  execute on function public.release_nickname()              to authenticated;
grant  execute on function public.send_message(text, text)        to authenticated;
grant  execute on function public.edit_message(uuid, text)        to authenticated;
grant  execute on function public.delete_message(uuid)            to authenticated;


-- ---------- 4. 即時推送 ----------
-- 把 messages 加進即時推送名單，其他人才會在訊息寫入的瞬間收到。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;


-- ---------- 5. 圖片倉庫 ----------
-- 公開倉庫（有網址就能看，網址含不可猜的隨機檔名）。
-- 單檔上限 5 MB，只收 JPG、PNG、GIF、WebP（由 Supabase 伺服器強制執行）。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images', 'chat-images', true, 5242880,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 只能上傳到「自己的資料夾」（資料夾名稱 = 自己的匿名身分），也只能刪自己資料夾裡的檔案
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'chat_images_upload_own'
  ) then
    create policy chat_images_upload_own on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'chat-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'chat_images_delete_own'
  ) then
    create policy chat_images_delete_own on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'chat-images'
        and (storage.foldername(name))[1] = auth.uid()::text
      );
  end if;
end $$;
