-- Tables
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  duration_sec int,
  level_label text,
  goal text,
  client_id text
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  name text,
  email text,
  rating int check (rating between 1 and 5),
  text text
);

-- RLS
alter table public.sessions  enable row level security;
alter table public.feedback  enable row level security;

create policy "sessions_read_all" on public.sessions
for select to anon, authenticated using (true);

create policy "sessions_insert_self_or_anon" on public.sessions
for insert to anon, authenticated
with check (user_id is null or auth.uid() = user_id);

create policy "feedback_insert_own" on public.feedback
for insert to anon, authenticated
with check (auth.uid() = user_id or auth.uid() is null);

-- Simple leaderboard helper
create or replace function public.top_users_by_sessions()
returns table (user_id uuid, email text, display_text text, sessions bigint)
language sql stable as $$
  select
    coalesce(s.user_id, '00000000-0000-0000-0000-000000000000') as user_id,
    u.email,
    coalesce(p.display_name, u.email, 'Anonymous') as display_text,
    count(*) as sessions
  from public.sessions s
  left join auth.users u on u.id = s.user_id
  left join public.profiles p on p.id = s.user_id  -- if you have one
  where s.user_id is not null
  group by 1,2,3
  order by sessions desc
$$;
