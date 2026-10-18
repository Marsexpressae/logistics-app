-- Celebrations: fireworks (or confetti) when good work is done.
-- Design: docs/superpowers/specs/2026-10-18-celebrations-design.md
--
-- One setting row says whether celebrations are on, which style plays, and which of the four jobs celebrate
-- (a booking is created, a pickup is collected, an intake is received, an invoice is raised). The Celebrations card in
-- Settings changes it only through save_celebrations, which checks every choice, so a bad value can never be stored.
-- This migration only adds one setting row and one function, so the running app keeps working.

insert into app_settings (key, value, label, description) values
  ('celebrations',
   '{"enabled": true, "style": "salvo", "events": {"booking_created": true, "pickup_collected": true, "intake_received": true, "invoice_raised": true}}'::jsonb,
   'Celebrations',
   'Fireworks when good work is done. Change them on the Celebrations card.')
on conflict (key) do nothing;

create or replace function save_celebrations(p_enabled boolean, p_style text, p_events jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform require_perm('settings.manage');
  if p_enabled is null then raise exception 'Choose on or off'; end if;
  if p_style is null or p_style not in ('salvo', 'confetti', 'classic', 'rings', 'willow') then raise exception 'Choose a style from the list'; end if;
  if p_events is null or jsonb_typeof(p_events) <> 'object'
     or (select count(*) from jsonb_object_keys(p_events)) <> 4 then
    raise exception 'Each celebration needs an on or off choice';
  end if;
  foreach k in array array['booking_created', 'pickup_collected', 'intake_received', 'invoice_raised'] loop
    if not (p_events ? k) or jsonb_typeof(p_events -> k) <> 'boolean' then raise exception 'Each celebration needs an on or off choice'; end if;
  end loop;
  update app_settings
  set value = jsonb_build_object('enabled', p_enabled, 'style', p_style, 'events', p_events), updated_at = now()
  where key = 'celebrations';
  if not found then
    insert into app_settings (key, value, label, description)
    values ('celebrations', jsonb_build_object('enabled', p_enabled, 'style', p_style, 'events', p_events), 'Celebrations', 'Fireworks when good work is done. Change them on the Celebrations card.');
  end if;
end $$;

revoke execute on function save_celebrations(boolean, text, jsonb) from public, anon;
grant execute on function save_celebrations(boolean, text, jsonb) to authenticated;
