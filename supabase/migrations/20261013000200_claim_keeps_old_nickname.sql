-- ============================================================================
-- 補丁：換代號時，新代號被占用，舊代號不能因此被放掉
--
-- 原本 claim_nickname 的順序是「先刪掉自己的舊代號，再登記新代號」。
-- 新代號如果被別人占用，回傳 taken，但舊代號已經刪掉了，可能被別人搶走。
--
-- 新順序：
--   1. 先用「代號鎖」讓同一個代號同一時間只有一個人在處理
--   2. 確認新代號可用（沒人占用，或是自己的）
--   3. 確認可用之後，才放掉自己的舊代號，再登記新代號
-- 可重複執行。
-- ============================================================================
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

  -- 同一個代號同一時間只讓一個人處理，這樣「檢查 → 登記」之間不會被別人插隊
  perform pg_advisory_xact_lock(hashtextextended('nickname:' || v_key, 0));

  -- 順手清掉已經到期的租約
  delete from public.nickname_claims where expires_at < now();

  -- 先確認新代號可用：被別人占用就直接回 taken，什麼都不動（舊代號保留）
  if exists (
    select 1 from public.nickname_claims
    where name_key = v_key and user_id <> v_uid
  ) then
    return 'taken';
  end if;

  -- 可用了，才放掉自己的舊代號（一個人同時只占一個代號）
  delete from public.nickname_claims where user_id = v_uid and name_key <> v_key;

  -- 登記（或續約）
  insert into public.nickname_claims (name_key, display_name, user_id, expires_at)
  values (v_key, p_name, v_uid, now() + interval '60 seconds')
  on conflict (name_key) do update
    set display_name = excluded.display_name,
        expires_at   = excluded.expires_at
    where public.nickname_claims.user_id = v_uid;

  return 'ok';
end $$;

-- 權限維持不變：只有登入過的人（含匿名）能呼叫
revoke execute on function public.claim_nickname(text) from public, anon;
grant  execute on function public.claim_nickname(text) to authenticated;
