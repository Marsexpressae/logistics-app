-- A private error log. When something breaks in a person's browser, the app writes one line here, so problems are found
-- by us and not only reported by the team. Free, and the data stays in your own database.
--   * Only signed-in people can write to it (through the function below), and only the settings administrator can read it.
--   * The same error from the same person within 10 minutes is counted, not repeated.
--   * Only the newest 300 lines are kept.
create table client_errors (
  id         bigint generated always as identity primary key,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  count      int not null default 1,
  user_id    uuid,
  user_name  text,
  path       text,
  message    text not null,
  stack      text,
  user_agent text
);
create index client_errors_last_seen_idx on client_errors (last_seen desc);

alter table client_errors enable row level security;
create policy client_errors_select on client_errors for select to authenticated using ((select has_perm('settings.manage')));
revoke all on client_errors from anon, authenticated;
grant select on client_errors to authenticated;

create or replace function log_client_error(p_message text, p_stack text, p_path text, p_agent text) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  msg text := btrim(left(coalesce(p_message, ''), 500));
begin
  if actor is null or msg = '' then return; end if;

  update client_errors set count = count + 1, last_seen = now()
  where user_id = actor and message = msg and last_seen > now() - interval '10 minutes';

  if not found then
    insert into client_errors (user_id, user_name, path, message, stack, user_agent)
    values (actor, (select full_name from profiles where id = actor), left(coalesce(p_path, ''), 200), msg,
            left(coalesce(p_stack, ''), 2000), left(coalesce(p_agent, ''), 200));
  end if;

  delete from client_errors where id in (select e.id from client_errors e order by e.last_seen desc offset 300);
end $$;

create or replace function clear_client_errors() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('settings.manage');
  delete from client_errors where id is not null;
end $$;

revoke execute on function log_client_error(text, text, text, text) from public, anon;
revoke execute on function clear_client_errors() from public, anon;
grant execute on function log_client_error(text, text, text, text) to authenticated;
grant execute on function clear_client_errors() to authenticated;
