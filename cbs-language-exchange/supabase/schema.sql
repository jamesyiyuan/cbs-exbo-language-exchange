-- CBS Language Exchange by ExBo — Supabase schema
-- Run once in Supabase → SQL Editor. Safe to re-run.
-- If you ran an EARLIER version of this file (with a single "role" column),
-- first run:  drop table if exists public.pairings, public.profiles cascade;

-- ---------------------------------------------------------------------------
-- 1. Only @gsb.columbia.edu addresses may create (or change to) an account.
--    This is the real gate; the check in the browser is only for convenience.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_cbs_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null or lower(new.email) not like '%@gsb.columbia.edu' then
    raise exception 'Only @gsb.columbia.edu email addresses can sign up';
  end if;
  return new;
end $$;

drop trigger if exists enforce_cbs_email on auth.users;
create trigger enforce_cbs_email
  before insert or update of email on auth.users
  for each row execute function public.enforce_cbs_email();

-- True when the signed-in user's verified email is a CBS address.
create or replace function public.is_cbs()
returns boolean language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email') like '%@gsb.columbia.edu', false)
$$;

-- ---------------------------------------------------------------------------
-- 2. Profiles (visible to every signed-in CBS student; email is NOT stored here)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text not null check (char_length(full_name) between 1 and 80),
  class_year       text check (char_length(class_year) <= 40),
  -- A person is a coach if coach_languages is non-empty, a mentee if
  -- learn_languages is non-empty, and can be both.
  coach_languages  text[] not null default '{}' check (coach_languages <@ array[
      'English','Chinese (Mandarin)','Chinese (Cantonese)','Japanese','Korean',
      'Vietnamese','Italian','German','French','Spanish',
      'Dutch','Russian','Portuguese','Hindi','Bahasa Indonesia',
      'Hebrew','Arabic','Thai'
    ]::text[]),
  learn_languages  text[] not null default '{}' check (learn_languages <@ array[
      'English','Chinese (Mandarin)','Chinese (Cantonese)','Japanese','Korean',
      'Vietnamese','Italian','German','French','Spanish',
      'Dutch','Russian','Portuguese','Hindi','Bahasa Indonesia',
      'Hebrew','Arabic','Thai'
    ]::text[]),
  bio              text check (char_length(bio) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (cardinality(coach_languages) + cardinality(learn_languages) >= 1),
  check (not (coach_languages && learn_languages))
);

alter table public.profiles enable row level security;

drop policy if exists "CBS students can view profiles" on public.profiles;
create policy "CBS students can view profiles" on public.profiles
  for select to authenticated using (public.is_cbs());

drop policy if exists "Users create their own profile" on public.profiles;
create policy "Users create their own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid() and public.is_cbs());

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Users delete their own profile" on public.profiles;
create policy "Users delete their own profile" on public.profiles
  for delete to authenticated using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Pairings: one person coaches the other in one language.
--    Two people can pair in both directions (A coaches B, B coaches A).
--    Declining / withdrawing / ending = deleting the row.
-- ---------------------------------------------------------------------------
create table if not exists public.pairings (
  id            uuid primary key default gen_random_uuid(),
  mentee_id     uuid not null references public.profiles(id) on delete cascade,
  coach_id      uuid not null references public.profiles(id) on delete cascade,
  language      text not null,
  requested_by  uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz,
  unique (mentee_id, coach_id),
  check (mentee_id <> coach_id),
  check (requested_by in (mentee_id, coach_id))
);

alter table public.pairings enable row level security;

drop policy if exists "Participants view their pairings" on public.pairings;
create policy "Participants view their pairings" on public.pairings
  for select to authenticated using (auth.uid() in (mentee_id, coach_id));

drop policy if exists "Users send pairing requests" on public.pairings;
create policy "Users send pairing requests" on public.pairings
  for insert to authenticated with check (requested_by = auth.uid() and public.is_cbs());

drop policy if exists "Participants remove pairings" on public.pairings;
create policy "Participants remove pairings" on public.pairings
  for delete to authenticated using (auth.uid() in (mentee_id, coach_id));

-- No UPDATE policy: accepting goes through accept_pairing() below.

create or replace function public.validate_pairing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m public.profiles;
  c public.profiles;
  open_requests int;
begin
  select * into m from public.profiles where id = new.mentee_id;
  select * into c from public.profiles where id = new.coach_id;
  if m.id is null or c.id is null then
    raise exception 'Both people need a profile';
  end if;
  if not (new.language = any (c.coach_languages) and new.language = any (m.learn_languages)) then
    raise exception 'The coach must offer % and the mentee must want to learn it', new.language;
  end if;
  select count(*) into open_requests from public.pairings
    where requested_by = new.requested_by and status = 'pending';
  if open_requests >= 10 then
    raise exception 'You have 10 pending requests. Wait for replies or withdraw some first.';
  end if;
  new.status := 'pending';
  new.accepted_at := null;
  new.created_at := now();
  return new;
end $$;

drop trigger if exists validate_pairing on public.pairings;
create trigger validate_pairing
  before insert on public.pairings
  for each row execute function public.validate_pairing();

-- If someone stops offering / learning a language, drop pairings that no longer fit.
create or replace function public.clear_invalid_pairings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.pairings
   where (coach_id = new.id and not (language = any (new.coach_languages)))
      or (mentee_id = new.id and not (language = any (new.learn_languages)));
  return new;
end $$;

drop trigger if exists clear_pairings_on_role_change on public.profiles;
drop function if exists public.clear_pairings_on_role_change();
drop trigger if exists clear_invalid_pairings on public.profiles;
create trigger clear_invalid_pairings
  after update of coach_languages, learn_languages on public.profiles
  for each row execute function public.clear_invalid_pairings();

-- Only the person who RECEIVED a request can accept it.
create or replace function public.accept_pairing(pairing_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.pairings
     set status = 'accepted', accepted_at = now()
   where id = pairing_id
     and status = 'pending'
     and auth.uid() in (mentee_id, coach_id)
     and auth.uid() <> requested_by;
  if not found then
    raise exception 'Request not found';
  end if;
end $$;

-- Emails are revealed only between accepted partners.
create or replace function public.partner_contacts()
returns table (partner_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email::text
    from public.pairings p
    join auth.users u
      on u.id = case when p.mentee_id = auth.uid() then p.coach_id else p.mentee_id end
   where p.status = 'accepted'
     and auth.uid() in (p.mentee_id, p.coach_id)
$$;

revoke all on function public.accept_pairing(uuid) from public, anon;
revoke all on function public.partner_contacts() from public, anon;
grant execute on function public.accept_pairing(uuid) to authenticated;
grant execute on function public.partner_contacts() to authenticated;
