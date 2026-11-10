-- A person can send a short alert to one colleague (from the colleague's profile), for any task:
-- "please add the old invoice", "please request the return". It arrives like every other alert: the bell, the badge and a phone alert.
-- Adds one function. Nothing existing changes, so the running app keeps working.

create or replace function send_alert(p_to uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  actor_name text := (select full_name from profiles where id = auth.uid() and active);
  msg text := btrim(coalesce(p_message, ''));
begin
  if actor_name is null then
    raise exception 'You do not have permission to do this' using errcode = '42501';
  end if;
  if msg = '' then raise exception 'Type a message first'; end if;
  if char_length(msg) > 300 then raise exception 'Keep the message under 300 characters'; end if;
  if p_to is not distinct from actor then raise exception 'You cannot send an alert to yourself'; end if;
  if not exists (select 1 from profiles where id = p_to and active) then raise exception 'That person was not found'; end if;

  insert into notifications (user_id, booking_id, kind, title, body, actor_name)
  values (p_to, null, 'alert', 'Alert from ' || actor_name, msg, actor_name);
end $$;

revoke execute on function send_alert(uuid, text) from public, anon;
grant execute on function send_alert(uuid, text) to authenticated;
