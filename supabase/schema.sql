-- Supabase 프로젝트에 한 번 적용하는 설정 (SQL Editor 에 붙여넣어 실행).

create table public.docs (
  collection text not null,
  id text not null,
  data jsonb not null,
  client text,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table public.docs enable row level security;

-- 편성 담당자 목록. 정책 없이 잠가 두고 아래 함수로만 다룬다.
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = (select auth.uid())) $$;

-- 담당자가 아직 한 명도 없을 때, 처음 로그인한 사람이 담당자가 된다.
create function public.claim_admin() returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then return false; end if;
  lock table public.admins in exclusive mode;
  if not exists (select 1 from public.admins) then
    insert into public.admins (user_id) values ((select auth.uid()));
  end if;
  return exists (select 1 from public.admins where user_id = (select auth.uid()));
end $$;

-- 누구나: 공개본(public)과 날짜별 변경(changes)만 읽는다. 담당자: 전부 읽고 쓴다.
create policy "read public or admin" on public.docs for select to anon, authenticated
  using (collection in ('public', 'changes') or (select public.is_admin()));
create policy "admin insert" on public.docs for insert to authenticated
  with check ((select public.is_admin()));
create policy "admin update" on public.docs for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admin delete" on public.docs for delete to authenticated
  using ((select public.is_admin()));

-- 여러 변경을 한 번에(전부 되거나 전부 안 되게) 적용한다. 호출한 사람의 권한으로 실행된다.
create function public.apply_ops(ops jsonb, client text) returns void
language plpgsql security invoker set search_path = ''
as $$
declare op jsonb;
begin
  for op in select * from jsonb_array_elements(ops) loop
    if op->>'op' = 'put' then
      insert into public.docs (collection, id, data, client, updated_at)
      values (op->>'collection', op->'doc'->>'id', op->'doc', client, now())
      on conflict (collection, id) do update set data = excluded.data, client = excluded.client, updated_at = now();
    elsif op->>'op' = 'del' then
      delete from public.docs where collection = op->>'collection' and id = op->>'id';
    end if;
  end loop;
end $$;

revoke all on function public.is_admin() from public;
revoke all on function public.claim_admin() from public, anon;
revoke all on function public.apply_ops(jsonb, text) from public, anon;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.claim_admin() to authenticated;
grant execute on function public.apply_ops(jsonb, text) to authenticated;

alter publication supabase_realtime add table public.docs;
