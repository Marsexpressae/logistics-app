-- App controls (Settings page) and the "payment before loading" rule.

-- ---------- settings ----------
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  label      text not null,
  description text,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
revoke all on app_settings from anon;

insert into permissions (key, group_name, label, description, sort) values
  ('settings.manage',            'People',     'Change app settings',          'Turn app controls on or off on the Settings page', 72),
  ('containers.override_payment','Containers', 'Load without full payment',    'Load a parcel into a container even when payment is required and not complete (a reason is recorded)', 85)
on conflict (key) do nothing;

insert into role_permissions (role, permission) values
  ('super_admin', 'settings.manage'), ('super_admin', 'containers.override_payment'),
  ('manager', 'containers.override_payment')
on conflict do nothing;

create policy settings_select on app_settings for select to authenticated using (true);
create policy settings_update on app_settings for update to authenticated
  using ((select has_perm('settings.manage'))) with check ((select has_perm('settings.manage')));
grant select, update on app_settings to authenticated;

insert into app_settings (key, value, label, description) values
  ('require_payment_before_loading', 'false'::jsonb,
   'Require payment before loading into a container',
   'When on, a parcel can only be loaded if its booking has an invoice amount and it is paid in full. People with "Load without full payment" can override it with a reason.')
on conflict (key) do nothing;

create trigger audit_app_settings after insert or update or delete on app_settings
  for each row execute function audit_row();

-- ---------- override history ----------
alter table booking_events drop constraint if exists booking_events_kind_check;
alter table booking_events add constraint booking_events_kind_check
  check (kind in ('rescheduled', 'cancelled', 'loaded_without_payment'));

-- ---------- the rule ----------
drop function if exists load_parcel(uuid, text);
create or replace function load_parcel(p_container_id uuid, p_barcode text, p_override_reason text default null)
returns parcels language plpgsql security definer set search_path = public as $$
declare
  c containers;
  p parcels;
  b bookings;
  paid numeric;
  actor uuid := auth.uid();
begin
  perform require_perm('containers.manage');
  select * into c from containers where id = p_container_id;
  if not found then raise exception 'Container not found'; end if;
  if c.status <> 'loading' then raise exception 'Container % has already departed', c.code; end if;

  select * into p from parcels where barcode = upper(trim(p_barcode)) for update;
  if not found then raise exception 'No parcel with barcode %', p_barcode; end if;
  if p.status = 'repacked' then
    raise exception 'Parcel % was repacked. Scan the new label instead.', p.barcode;
  end if;
  if p.status <> 'in_warehouse' then
    raise exception 'Parcel % is not in a warehouse (status: %)', p.barcode, p.status;
  end if;

  if coalesce((select (value)::text = 'true' from app_settings where key = 'require_payment_before_loading'), false) then
    select * into b from bookings where id = p.booking_id;
    select coalesce(sum(amount), 0) into paid from payments where booking_id = b.id;
    if b.invoice_amount is null or paid < b.invoice_amount then
      if nullif(btrim(coalesce(p_override_reason, '')), '') is null then
        raise exception 'PAYMENT_REQUIRED % : %', b.code,
          case when b.invoice_amount is null then 'no invoice amount is set yet'
               else 'paid ' || to_char(paid, 'FM999,999,990.00') || ' of ' || to_char(b.invoice_amount, 'FM999,999,990.00') end;
      end if;
      if not has_perm('containers.override_payment') then
        raise exception 'Payment is required before loading % and you cannot override it. Ask a manager.', b.code;
      end if;
      insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
      values (b.id, 'loaded_without_payment', btrim(p_override_reason) || ' (' || p.barcode || ' into ' || c.code || ')',
              actor, (select full_name from profiles where id = actor));
    end if;
  end if;

  update parcels set status = 'loaded', container_id = c.id where id = p.id returning * into p;
  return p;
end $$;
