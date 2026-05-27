-- 업무맵 Cloud MVP - Supabase 스키마
-- Supabase Dashboard > SQL Editor에서 한 번 실행하세요.

create extension if not exists pgcrypto;

-- 1) 기본 테이블
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  title text not null default '무제 보드',
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.board_members (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  role text not null default '편집 가능' check (role in ('관리자', '편집 가능', '보기 전용')),
  status text not null default 'pending' check (status in ('active', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists board_members_unique_email
  on public.board_members(board_id, lower(email));

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  title text not null default '새 업무',
  category text not null default '기타',
  parent_id uuid references public.tasks(id) on delete set null,
  status text not null default '남은 카드',
  start_date date,
  end_date date,
  assignee text,
  priority text not null default '보통',
  memo text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_board_idx on public.tasks(board_id);
create index if not exists tasks_parent_idx on public.tasks(parent_id);
create index if not exists board_members_board_idx on public.board_members(board_id);
create index if not exists board_members_user_idx on public.board_members(user_id);

-- 2) 공통 updated_at 트리거
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_boards_updated_at on public.boards;
create trigger touch_boards_updated_at
before update on public.boards
for each row execute function public.touch_updated_at();

drop trigger if exists touch_board_members_updated_at on public.board_members;
create trigger touch_board_members_updated_at
before update on public.board_members
for each row execute function public.touch_updated_at();

drop trigger if exists touch_tasks_updated_at on public.tasks;
create trigger touch_tasks_updated_at
before update on public.tasks
for each row execute function public.touch_updated_at();

-- 3) 회원가입 시 profile 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 4) 권한 확인 함수: RLS 정책에서 사용
create or replace function public.current_user_email()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_board_member(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_members bm
    where bm.board_id = p_board_id
      and (
        bm.user_id = auth.uid()
        or lower(bm.email) = public.current_user_email()
      )
  );
$$;

create or replace function public.is_board_editor(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_members bm
    where bm.board_id = p_board_id
      and (
        bm.user_id = auth.uid()
        or lower(bm.email) = public.current_user_email()
      )
      and bm.role in ('관리자', '편집 가능')
  );
$$;

create or replace function public.is_board_admin(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.board_members bm
    where bm.board_id = p_board_id
      and (
        bm.user_id = auth.uid()
        or lower(bm.email) = public.current_user_email()
      )
      and bm.role = '관리자'
  );
$$;

-- 5) 보드 생성자를 자동으로 관리자 멤버에 등록
create or replace function public.handle_new_board()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select coalesce(email, auth.jwt() ->> 'email', '') into v_email
  from auth.users
  where id = new.owner_id;

  insert into public.board_members(board_id, user_id, email, role, status)
  values (new.id, new.owner_id, v_email, '관리자', 'active')
  on conflict (board_id, lower(email)) do nothing;

  return new;
end;
$$;

drop trigger if exists on_board_created on public.boards;
create trigger on_board_created
after insert on public.boards
for each row execute function public.handle_new_board();

-- 6) 초대된 이메일로 로그인한 사용자를 멤버 row에 연결
create or replace function public.claim_board_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.board_members
  set user_id = auth.uid(), status = 'active'
  where user_id is null
    and lower(email) = public.current_user_email();
end;
$$;

-- 7) RLS 활성화
alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.board_members enable row level security;
alter table public.tasks enable row level security;

-- profiles
DROP POLICY IF EXISTS profiles_select_self ON public.profiles;
CREATE POLICY profiles_select_self ON public.profiles
FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- boards
DROP POLICY IF EXISTS boards_select_member ON public.boards;
CREATE POLICY boards_select_member ON public.boards
FOR SELECT USING (public.is_board_member(id));

DROP POLICY IF EXISTS boards_insert_authenticated ON public.boards;
CREATE POLICY boards_insert_authenticated ON public.boards
FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS boards_update_editor ON public.boards;
CREATE POLICY boards_update_editor ON public.boards
FOR UPDATE USING (public.is_board_editor(id)) WITH CHECK (public.is_board_editor(id));

DROP POLICY IF EXISTS boards_delete_admin ON public.boards;
CREATE POLICY boards_delete_admin ON public.boards
FOR DELETE USING (public.is_board_admin(id));

-- board_members
DROP POLICY IF EXISTS board_members_select_member ON public.board_members;
CREATE POLICY board_members_select_member ON public.board_members
FOR SELECT USING (public.is_board_member(board_id));

DROP POLICY IF EXISTS board_members_insert_admin ON public.board_members;
CREATE POLICY board_members_insert_admin ON public.board_members
FOR INSERT WITH CHECK (public.is_board_admin(board_id));

DROP POLICY IF EXISTS board_members_update_admin ON public.board_members;
CREATE POLICY board_members_update_admin ON public.board_members
FOR UPDATE USING (public.is_board_admin(board_id)) WITH CHECK (public.is_board_admin(board_id));

DROP POLICY IF EXISTS board_members_delete_admin ON public.board_members;
CREATE POLICY board_members_delete_admin ON public.board_members
FOR DELETE USING (public.is_board_admin(board_id));

-- tasks
DROP POLICY IF EXISTS tasks_select_member ON public.tasks;
CREATE POLICY tasks_select_member ON public.tasks
FOR SELECT USING (public.is_board_member(board_id));

DROP POLICY IF EXISTS tasks_insert_editor ON public.tasks;
CREATE POLICY tasks_insert_editor ON public.tasks
FOR INSERT WITH CHECK (public.is_board_editor(board_id));

DROP POLICY IF EXISTS tasks_update_editor ON public.tasks;
CREATE POLICY tasks_update_editor ON public.tasks
FOR UPDATE USING (public.is_board_editor(board_id)) WITH CHECK (public.is_board_editor(board_id));

DROP POLICY IF EXISTS tasks_delete_editor ON public.tasks;
CREATE POLICY tasks_delete_editor ON public.tasks
FOR DELETE USING (public.is_board_editor(board_id));

-- 8) Realtime publication에 테이블 추가
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'boards') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.boards;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'board_members') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.board_members;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
END $$;
