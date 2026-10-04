-- Notes on jobs, with @mentions that arrive on the bell.
-- A note belongs to a booking (and so to its invoice). Notes cannot be edited or deleted: a mistake is fixed with a new note.
-- Anyone who can see the booking can read its notes; people with "Write notes on jobs" can add them.
insert into permissions (key, group_name, label, description, sort) values
  ('notes.write', 'Bookings', 'Write notes on jobs', 'Add notes to a booking or invoice and mention colleagues', 26)
on conflict (key) do nothing;
insert into role_permissions (role, permission) values
  ('super_admin', 'notes.write'), ('manager', 'notes.write'), ('staff', 'notes.write'),
  ('warehouse', 'notes.write'), ('driver', 'notes.write')
on conflict do nothing;

create table booking_notes (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings (id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users (id),
  author_name text not null default '',
  body        text not null check (length(btrim(body)) between 1 and 2000),
  mentions    uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index booking_notes_booking_idx on booking_notes (booking_id, created_at desc);

alter table booking_notes enable row level security;
create policy booking_notes_select on booking_notes for select to authenticated
  using (exists (select 1 from bookings b where b.id = booking_id)); -- visibility follows the booking
create policy booking_notes_insert on booking_notes for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (select has_perm('notes.write'))
    and exists (select 1 from bookings b where b.id = booking_id)
  );
revoke all on booking_notes from anon;
revoke update, delete on booking_notes from authenticated;
grant select, insert on booking_notes to authenticated;

-- Can this person open this booking? The same rule as the bookings table policy, for any user. Internal use only.
create or replace function can_user_see_booking(p_user uuid, p_booking uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profiles pr
    join role_permissions rp on rp.role = pr.role
    join bookings b on b.id = p_booking
    where pr.id = p_user and pr.active
      and (rp.permission in ('bookings.view', 'pickups.view_all', 'warehouse.view')
           or (rp.permission = 'pickups.view_own'
               and b.driver_id = (select d.id from drivers d where d.user_id = p_user limit 1)))
  )
$$;
revoke execute on function can_user_see_booking(uuid, uuid) from public, anon, authenticated;

-- The people who can be mentioned on a booking: active colleagues who are able to open it.
create or replace function mentionable_users(p_booking_id uuid)
returns table (id uuid, full_name text, role_label text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform require_perm('notes.write');
  if not can_user_see_booking(auth.uid(), p_booking_id) then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
  return query
  select pr.id, coalesce(nullif(pr.full_name, ''), 'Team member'), coalesce(r.label, pr.role)
  from profiles pr
  left join roles r on r.key = pr.role
  where pr.active and pr.id <> auth.uid() and can_user_see_booking(pr.id, p_booking_id)
  order by 2;
end $$;
revoke execute on function mentionable_users(uuid) from public, anon;
grant execute on function mentionable_users(uuid) to authenticated;

-- Before saving: stamp the author's name and keep only valid mentions (active people who can open the booking).
create or replace function booking_notes_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_name := coalesce(nullif((select p.full_name from profiles p where p.id = new.author_id), ''), 'Team member');
  new.body := btrim(new.body);
  new.mentions := coalesce(
    (select array_agg(distinct m) from unnest(new.mentions) m
     where m <> new.author_id and can_user_see_booking(m, new.booking_id)),
    '{}');
  return new;
end $$;
create trigger booking_notes_before before insert on booking_notes
  for each row execute function booking_notes_before();

-- After saving: each mentioned colleague gets a notification on the bell.
create or replace function booking_notes_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, booking_id, kind, title, body, actor_name)
  select m, new.booking_id, 'note_mention',
         new.author_name || ' mentioned you on ' || coalesce(b.invoice_no, b.code),
         left(new.body, 160), new.author_name
  from unnest(new.mentions) m
  join bookings b on b.id = new.booking_id;
  return new;
end $$;
create trigger booking_notes_after after insert on booking_notes
  for each row execute function booking_notes_after();
