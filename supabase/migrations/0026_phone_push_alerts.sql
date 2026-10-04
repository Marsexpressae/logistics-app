-- Phone push alerts: every notification on the bell can also reach the person's phone, even with the app closed.
--   1. push_subscriptions: one row per phone/browser that turned alerts on (each person manages their own).
--   2. A trigger sends each new notification to the app's /api/push route, which delivers it.
--      The route proves the call comes from the database with a random secret kept in a private table (never in the code).
--      If anything goes wrong while sending, the notification itself is still saved: a failed push never blocks a change.

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;
create policy push_select on push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy push_insert on push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_delete on push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
revoke all on push_subscriptions from anon;
revoke update on push_subscriptions from authenticated;
grant select, insert, delete on push_subscriptions to authenticated;

-- Private settings. No policies and no grants: only the database functions below, and the server key, can read it.
create table private_config (
  key   text primary key,
  value text not null
);
alter table private_config enable row level security;
revoke all on private_config from anon, authenticated;
insert into private_config (key, value)
values ('push_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;
insert into private_config (key, value) values ('push_url', 'https://app.marsexpress.ae/api/push')
on conflict (key) do nothing;

create extension if not exists pg_net with schema extensions;

create or replace function notifications_send_push() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  secret text := (select c.value from private_config c where c.key = 'push_secret');
  url    text := (select c.value from private_config c where c.key = 'push_url');
begin
  if secret is not null and url is not null
     and exists (select 1 from push_subscriptions s where s.user_id = new.user_id) then
    begin
      perform net.http_post(
        url := url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
        body := jsonb_build_object('notification_id', new.id)
      );
    exception when others then
      null; -- never let a push problem stop the notification from being saved
    end;
  end if;
  return new;
end $$;

create trigger notifications_push after insert on notifications
  for each row execute function notifications_send_push();
