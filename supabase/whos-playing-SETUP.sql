-- WHO'S PLAYING — backend for the partner board + pickup board. 2026-08-23.
-- Paste this WHOLE file into the Supabase SQL Editor (same btown-games
-- project as the leaderboard, rooms, party, and lake-breath) and click Run.
-- Safe to re-run. Brand-new wp_* tables and functions only — nothing here
-- touches any other app's objects.
--
-- The model: a "call" is a short public post ("Priya · Tennis 3.5 · Casual
-- · Weekday evenings · South End") made from a phone with a device token
-- that is stored only hashed. Anyone can reply; a reply carries the
-- replier's name, a note, and how to reach them, and is visible ONLY to
-- the person who posted the call (wp_mine, gated by that same token).
-- Calls go live immediately, last 14 days, and can be closed by their
-- owner ("found someone"), auto-hidden by three reports, or hidden/deleted
-- by Stephen in mod.html. Standing pickup games suggested by the public
-- wait as 'pending' until approved; approved ones are served by wp_pickup
-- and merged by the client with the curated data/pickup.json.
--
-- Honest threat model, same as the fleet: the anon key is public by
-- design, so a determined prankster can mint tokens and post junk. Rate
-- limits (3 calls/day, 5 open, 10 replies/day, 3 suggestions/day), server
-- side validation identical to js/core.js, URL stripping from public text,
-- the report threshold, and mod.html stop casual mischief; they do not stop
-- a determined Sybil. Nothing here is presented as integrity-protected.
--
-- >>> BEFORE YOU RUN THIS: put a bcrypt HASH of your moderator secret into
-- >>> wp_mod_hash() below (instructions on the function). Until you do,
-- >>> mod.html opens nothing — the gate fails closed on the placeholder.
--
-- OPTIONAL: deploy supabase/functions/wp-notify (needs a RESEND_API_KEY
-- secret) and posters who left an email get a plain "someone replied"
-- email. Without it, replies simply wait in Mine, exactly as described.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

create table if not exists public.wp_posts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  name text not null check (length(name) between 1 and 24),
  sport text not null check (sport ~ '^[a-z0-9-]{1,24}$'),
  level int not null check (level between 0 and 9),
  intent text not null check (intent in ('casual','compete','practice','company')),
  times text[] not null check (cardinality(times) between 1 and 4),
  place text not null check (length(place) between 1 and 40),
  note text not null default '' check (length(note) <= 140),
  women_only boolean not null default false,
  email text not null default '' check (length(email) <= 120),  -- PRIVATE: never in a public payload
  status text not null default 'open' check (status in ('open','closed','hidden')),
  reports int not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists wp_posts_board on public.wp_posts (status, created_at desc);
create index if not exists wp_posts_owner on public.wp_posts (token_hash, created_at desc);

create table if not exists public.wp_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.wp_posts(id) on delete cascade,
  token_hash text not null,
  name text not null check (length(name) between 1 and 24),
  note text not null check (length(note) between 1 and 280),
  contact text not null check (length(contact) between 3 and 120),   -- PRIVATE: poster only
  created_at timestamptz not null default now(),
  seen boolean not null default false,
  notified boolean not null default false,
  unique (post_id, token_hash)
);
create index if not exists wp_replies_post on public.wp_replies (post_id, created_at desc);
create index if not exists wp_replies_owner on public.wp_replies (token_hash, created_at desc);

create table if not exists public.wp_reports (
  post_id uuid not null references public.wp_posts(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, token_hash)
);

create table if not exists public.wp_suggestions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  name text not null check (length(name) between 2 and 60),
  sport text not null check (sport ~ '^[a-z0-9-]{1,24}$'),
  venue text not null check (length(venue) between 2 and 80),
  schedule text not null check (length(schedule) between 2 and 120),
  door text not null check (door in ('open','ask','members','full')),
  link text not null default '' check (length(link) <= 200),
  note text not null default '' check (length(note) <= 200),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create index if not exists wp_suggestions_status on public.wp_suggestions (status, created_at desc);

alter table public.wp_posts enable row level security;
alter table public.wp_replies enable row level security;
alter table public.wp_reports enable row level security;
alter table public.wp_suggestions enable row level security;
revoke all on table public.wp_posts from anon, authenticated;
revoke all on table public.wp_replies from anon, authenticated;
revoke all on table public.wp_reports from anon, authenticated;
revoke all on table public.wp_suggestions from anon, authenticated;

-- --------------------------------------------------------------- helpers

create or replace function public.wp_hash(p text) returns text
language sql immutable as $$
  select encode(extensions.digest(coalesce(p, ''), 'sha256'), 'hex');
$$;

create or replace function public.wp_check_token(p_token text) returns void
language plpgsql immutable as $$
begin
  if coalesce(p_token, '') !~ '^[a-f0-9]{32}$' then
    raise exception using message = 'bad_token';
  end if;
end $$;

-- Mirrors core.js cleanText: control chars → space, whitespace collapsed,
-- trimmed, URLs stripped (public text must never carry links), clipped.
create or replace function public.wp_clean(p text, p_max int) returns text
language sql immutable as $$
  select left(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'),
             '\m(https?://|www\.)\S+', '', 'gi'),
           '\s+', ' ', 'g')), p_max);
$$;
-- Contact is private and MAY carry a link/handle; only control chars go.
create or replace function public.wp_clean_contact(p text) returns text
language sql immutable as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), 120);
$$;

create or replace function public.wp_valid_sport(p text) returns boolean
language sql immutable as $$
  select p in ('tennis','pickleball','running','climbing','golf','disc-golf','cycling',
               'swimming','paddling','squash','racquetball','table-tennis','basketball',
               'skiing','backcountry','xc-ski','skating','hiking','other');
$$;
-- level count per sport — keep in lock-step with SPORTS in js/core.js
create or replace function public.wp_level_count(p text) returns int
language sql immutable as $$
  select case p
    when 'tennis' then 5 when 'pickleball' then 5 when 'running' then 4
    when 'climbing' then 6 when 'golf' then 4 when 'disc-golf' then 4
    when 'cycling' then 4 when 'swimming' then 3 when 'paddling' then 2
    when 'squash' then 4 when 'racquetball' then 4 when 'table-tennis' then 4
    when 'basketball' then 4 when 'skiing' then 4 when 'backcountry' then 3
    when 'xc-ski' then 3 when 'skating' then 3 when 'hiking' then 3
    when 'other' then 3 else 0 end;
$$;
create or replace function public.wp_valid_pickup_sport(p text) returns boolean
language sql immutable as $$
  select p in ('basketball','soccer','ultimate','volleyball','hockey','skating','pickleball',
               'tennis','squash','racquetball','running','cycling','disc-golf','climbing',
               'table-tennis','xc-ski','other');
$$;
create or replace function public.wp_valid_place(p text) returns boolean
language sql immutable as $$
  select p in ('Downtown / Hill','Old North End','New North End','South End','Winooski',
               'South Burlington','Essex','Williston','Colchester','Shelburne','Anywhere nearby');
$$;

-- Opportunistic sweep, rides along on writes. Open calls expire after 14
-- days; closed/hidden ones are pruned after 30 (replies cascade).
create or replace function public.wp_sweep() returns void
language plpgsql security definer set search_path = public as $$
begin
  update wp_posts set status = 'closed', closed_at = now()
   where status = 'open' and created_at < now() - interval '14 days';
  delete from wp_posts where status <> 'open' and created_at < now() - interval '30 days';
end $$;

create or replace function public.wp_public(p wp_posts) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'sport', p.sport, 'level', p.level, 'intent', p.intent,
    'times', to_jsonb(p.times), 'place', p.place, 'note', p.note, 'women_only', p.women_only,
    'status', p.status, 'created_at', p.created_at,
    'reply_count', (select count(*) from wp_replies r where r.post_id = p.id));
$$;

-- ---------------------------------------------------------------- public

create or replace function public.wp_board() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform wp_sweep();
  return coalesce((select jsonb_agg(wp_public(p) order by p.created_at desc)
                     from wp_posts p where p.status = 'open'), '[]'::jsonb);
end $$;

create or replace function public.wp_post(p_token text, p_post jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h text; v_name text; v_sport text; v_level int; v_intent text; v_place text;
  v_note text; v_email text; v_times text[]; v_id uuid;
begin
  perform wp_check_token(p_token);
  h := wp_hash(p_token);
  v_sport := p_post->>'sport';
  v_level := coalesce((p_post->>'level')::int, -1);
  v_intent := p_post->>'intent';
  v_place := p_post->>'place';
  v_name := wp_clean(p_post->>'name', 24);
  v_note := wp_clean(p_post->>'note', 140);
  v_email := lower(btrim(coalesce(p_post->>'email', '')));
  select coalesce(array_agg(distinct t), '{}') into v_times
    from jsonb_array_elements_text(coalesce(p_post->'times', '[]'::jsonb)) t
   where t in ('wk-am','wk-day','wk-pm','weekend');
  if not wp_valid_sport(v_sport) or v_level < 0 or v_level >= wp_level_count(v_sport)
     or v_intent not in ('casual','compete','practice','company')
     or not wp_valid_place(v_place) or cardinality(v_times) = 0
     or length(v_name) < 1
     or (v_email <> '' and (length(v_email) > 120 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$')) then
    raise exception using message = 'bad_post';
  end if;
  perform wp_sweep();
  perform pg_advisory_xact_lock(hashtext('wp|' || h));
  if (select count(*) from wp_posts where token_hash = h and created_at > now() - interval '24 hours') >= 3 then
    raise exception using message = 'slow_down';
  end if;
  if (select count(*) from wp_posts where token_hash = h and status = 'open') >= 5 then
    raise exception using message = 'too_many_open';
  end if;
  insert into wp_posts (token_hash, name, sport, level, intent, times, place, note, women_only, email)
  values (h, v_name, v_sport, v_level, v_intent, v_times, v_place, v_note,
          coalesce((p_post->>'women_only')::boolean, false), v_email)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function public.wp_reply(p_post uuid, p_token text, p_reply jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h text; p wp_posts%rowtype; v_name text; v_note text; v_contact text; v_id uuid;
begin
  perform wp_check_token(p_token);
  h := wp_hash(p_token);
  v_name := wp_clean(p_reply->>'name', 24);
  v_note := wp_clean(p_reply->>'note', 280);
  v_contact := wp_clean_contact(p_reply->>'contact');
  if length(v_name) < 1 or length(v_note) < 1 or length(v_contact) < 3 then
    raise exception using message = 'bad_reply';
  end if;
  perform wp_sweep();
  select * into p from wp_posts where id = p_post;
  if not found or p.status <> 'open' then
    raise exception using message = 'not_found';
  end if;
  if p.token_hash = h then
    raise exception using message = 'own_post';
  end if;
  perform pg_advisory_xact_lock(hashtext('wpr|' || h));
  if not exists (select 1 from wp_replies where post_id = p_post and token_hash = h)
     and (select count(*) from wp_replies where token_hash = h and created_at > now() - interval '24 hours') >= 10 then
    raise exception using message = 'slow_down';
  end if;
  insert into wp_replies (post_id, token_hash, name, note, contact)
  values (p_post, h, v_name, v_note, v_contact)
  on conflict (post_id, token_hash) do update
    set name = excluded.name, note = excluded.note, contact = excluded.contact,
        created_at = now(), seen = false, notified = false
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'has_email', p.email <> '');
end $$;

-- Everything this device owns: its calls with their replies (the only
-- place contact info is ever returned), what it has sent, its suggestions.
create or replace function public.wp_mine(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h text; v_posts jsonb; v_sent jsonb; v_sugg jsonb;
begin
  perform wp_check_token(p_token);
  h := wp_hash(p_token);
  perform wp_sweep();
  select coalesce(jsonb_agg(
    wp_public(p) || jsonb_build_object(
      'email', p.email,
      'replies', coalesce((select jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.name, 'note', r.note, 'contact', r.contact,
          'created_at', r.created_at, 'seen', r.seen) order by r.created_at desc)
        from wp_replies r where r.post_id = p.id), '[]'::jsonb))
    order by p.created_at desc), '[]'::jsonb)
  into v_posts from wp_posts p where p.token_hash = h;
  update wp_replies r set seen = true
    from wp_posts p where r.post_id = p.id and p.token_hash = h and r.seen = false;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'post_id', r.post_id, 'to', p.name, 'sport', p.sport, 'note', r.note,
      'created_at', r.created_at, 'open', p.status = 'open') order by r.created_at desc), '[]'::jsonb)
  into v_sent from wp_replies r join wp_posts p on p.id = r.post_id where r.token_hash = h;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'sport', s.sport, 'venue', s.venue, 'schedule', s.schedule,
      'door', s.door, 'status', s.status, 'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
  into v_sugg from wp_suggestions s where s.token_hash = h;
  return jsonb_build_object('posts', v_posts, 'sent', v_sent, 'suggestions', v_sugg);
end $$;

-- Cheap badge check: how many replies to this device's open calls are unseen.
create or replace function public.wp_mine_peek(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('unseen', (
    select count(*) from wp_replies r join wp_posts p on p.id = r.post_id
     where p.token_hash = wp_hash(p_token) and r.seen = false));
$$;

create or replace function public.wp_close(p_post uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h text;
begin
  perform wp_check_token(p_token);
  h := wp_hash(p_token);
  if not exists (select 1 from wp_posts where id = p_post and token_hash = h) then
    raise exception using message = 'not_found';
  end if;
  update wp_posts set status = 'closed', closed_at = now()
   where id = p_post and token_hash = h and status = 'open';
  return '{}'::jsonb;
end $$;

create or replace function public.wp_report(p_post uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h text; p wp_posts%rowtype;
begin
  perform wp_check_token(p_token);
  h := wp_hash(p_token);
  select * into p from wp_posts where id = p_post;
  if not found or p.status <> 'open' then
    raise exception using message = 'not_found';
  end if;
  if p.token_hash = h then
    raise exception using message = 'own_post';
  end if;
  insert into wp_reports (post_id, token_hash) values (p_post, h) on conflict do nothing;
  if found then
    update wp_posts set reports = reports + 1 where id = p_post;
    update wp_posts set status = 'hidden' where id = p_post and reports >= 3;
  end if;
  return '{}'::jsonb;
end $$;

create or replace function public.wp_suggest(p_token text, p_suggestion jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  h text; v_name text; v_sport text; v_venue text; v_schedule text; v_door text;
  v_link text; v_note text; v_id uuid;
begin
  perform wp_check_token(p_token);
  h := wp_hash(p_token);
  v_name := wp_clean(p_suggestion->>'name', 60);
  v_sport := p_suggestion->>'sport';
  v_venue := wp_clean(p_suggestion->>'venue', 80);
  v_schedule := wp_clean(p_suggestion->>'schedule', 120);
  v_door := p_suggestion->>'door';
  v_link := left(btrim(coalesce(p_suggestion->>'link', '')), 200);
  v_note := wp_clean(p_suggestion->>'note', 200);
  if length(v_name) < 2 or not wp_valid_pickup_sport(v_sport) or length(v_venue) < 2
     or length(v_schedule) < 2 or v_door not in ('open','ask','members','full')
     or (v_link <> '' and v_link !~* '^https?://\S+$') then
    raise exception using message = 'bad_suggestion';
  end if;
  perform pg_advisory_xact_lock(hashtext('wps|' || h));
  if (select count(*) from wp_suggestions where token_hash = h and created_at > now() - interval '24 hours') >= 3 then
    raise exception using message = 'slow_down';
  end if;
  insert into wp_suggestions (token_hash, name, sport, venue, schedule, door, link, note)
  values (h, v_name, v_sport, v_venue, v_schedule, v_door, v_link, v_note)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- Approved community games. The client merges these with data/pickup.json.
create or replace function public.wp_pickup() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'sport', s.sport, 'venue', s.venue, 'schedule', s.schedule,
    'door', s.door, 'link', s.link, 'note', s.note, 'source', 'community',
    'last_checked', to_char(s.created_at, 'YYYY-MM-DD')) order by s.created_at desc), '[]'::jsonb)
  from wp_suggestions s where s.status = 'approved';
$$;

-- ------------------------------------------------------------ moderation
-- mod.html is the back room. The secret never enters the repo: only its
-- bcrypt hash does, and you make that hash yourself.
-- 1. Pick a long random string (a password manager's "generate" is perfect).
-- 2. In the Supabase SQL editor run:
--      select extensions.crypt('YOUR-SECRET-HERE', extensions.gen_salt('bf', 10));
--    and copy the result (it starts with $2a$10$).
-- 3. Paste that result between the quotes below, then run this whole file.
-- 4. Keep the plaintext in your password manager; mod.html asks for it.
create or replace function public.wp_mod_hash() returns text
language sql immutable as $$ select 'CHANGE-ME-PASTE-A-BCRYPT-HASH-HERE'::text; $$;
revoke all on function public.wp_mod_hash() from public, anon, authenticated;

create or replace function public.wp_mod_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_secret, '') <> ''
     and wp_mod_hash() like '$2%'     -- an unedited placeholder opens nothing
     and extensions.crypt(p_secret, wp_mod_hash()) = wp_mod_hash();
$$;
revoke all on function public.wp_mod_ok(text) from public, anon, authenticated;

create or replace function public.wp_mod_queue(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_posts jsonb; v_pending jsonb; v_approved jsonb;
begin
  if not wp_mod_ok(p_secret) then raise exception using message = 'bad_secret'; end if;
  perform wp_sweep();
  select coalesce(jsonb_agg(wp_public(p) || jsonb_build_object('reports', p.reports, 'email', p.email)
                            order by p.reports desc, p.created_at desc), '[]'::jsonb)
    into v_posts from wp_posts p where p.status <> 'closed';
  select coalesce(jsonb_agg(to_jsonb(s) - 'token_hash' order by s.created_at desc), '[]'::jsonb)
    into v_pending from wp_suggestions s where s.status = 'pending';
  select coalesce(jsonb_agg(to_jsonb(s) - 'token_hash' order by s.created_at desc), '[]'::jsonb)
    into v_approved from wp_suggestions s where s.status = 'approved';
  return jsonb_build_object('posts', v_posts, 'suggestions', v_pending, 'approved', v_approved);
end $$;

create or replace function public.wp_mod_post(p_secret text, p_post uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not wp_mod_ok(p_secret) then raise exception using message = 'bad_secret'; end if;
  if not exists (select 1 from wp_posts where id = p_post) then raise exception using message = 'not_found'; end if;
  if p_action = 'delete' then
    delete from wp_posts where id = p_post;
  elsif p_action = 'hide' then
    update wp_posts set status = 'hidden' where id = p_post;
  elsif p_action = 'restore' then
    delete from wp_reports where post_id = p_post;
    update wp_posts set status = 'open', reports = 0, closed_at = null where id = p_post;
  else
    raise exception using message = 'bad_action';
  end if;
  return '{}'::jsonb;
end $$;

create or replace function public.wp_mod_suggest(p_secret text, p_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not wp_mod_ok(p_secret) then raise exception using message = 'bad_secret'; end if;
  if not exists (select 1 from wp_suggestions where id = p_id) then raise exception using message = 'not_found'; end if;
  if p_action = 'approve' then update wp_suggestions set status = 'approved' where id = p_id;
  elsif p_action = 'reject' then update wp_suggestions set status = 'rejected' where id = p_id;
  elsif p_action = 'delete' then delete from wp_suggestions where id = p_id;
  else raise exception using message = 'bad_action';
  end if;
  return '{}'::jsonb;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.wp_board() from public;
revoke all on function public.wp_post(text, jsonb) from public;
revoke all on function public.wp_reply(uuid, text, jsonb) from public;
revoke all on function public.wp_mine(text) from public;
revoke all on function public.wp_mine_peek(text) from public;
revoke all on function public.wp_close(uuid, text) from public;
revoke all on function public.wp_report(uuid, text) from public;
revoke all on function public.wp_suggest(text, jsonb) from public;
revoke all on function public.wp_pickup() from public;
revoke all on function public.wp_mod_queue(text) from public;
revoke all on function public.wp_mod_post(text, uuid, text) from public;
revoke all on function public.wp_mod_suggest(text, uuid, text) from public;
revoke all on function public.wp_sweep() from public, anon, authenticated;
revoke all on function public.wp_public(wp_posts) from public, anon, authenticated;
grant execute on function public.wp_board() to anon;
grant execute on function public.wp_post(text, jsonb) to anon;
grant execute on function public.wp_reply(uuid, text, jsonb) to anon;
grant execute on function public.wp_mine(text) to anon;
grant execute on function public.wp_mine_peek(text) to anon;
grant execute on function public.wp_close(uuid, text) to anon;
grant execute on function public.wp_report(uuid, text) to anon;
grant execute on function public.wp_suggest(text, jsonb) to anon;
grant execute on function public.wp_pickup() to anon;
-- the hashed secret is the gate on these three, not the grant
grant execute on function public.wp_mod_queue(text) to anon;
grant execute on function public.wp_mod_post(text, uuid, text) to anon;
grant execute on function public.wp_mod_suggest(text, uuid, text) to anon;
