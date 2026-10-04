-- Returns can be corrected and deleted, with a trail.
--   * form_date: the date shown on the return form. Set it to the real date when entering an old return.
--   * Edit: date, note, and who received the parcels. Delete: needs a reason, puts the parcels back in stock,
--     and is recorded on the booking history. The Activity log keeps the full details of what was deleted.
--   * Both need the permission "Edit or delete returns" (manager and super admin by default).
insert into permissions (key, group_name, label, description, sort) values
  ('returns.manage', 'Warehouse', 'Edit or delete returns', 'Correct the date, note or receiver of a return, or delete a return (a reason is required)', 87)
on conflict (key) do nothing;
insert into role_permissions (role, permission) values ('super_admin', 'returns.manage'), ('manager', 'returns.manage')
on conflict do nothing;

alter table returns add column if not exists form_date date not null default current_date;
update returns set form_date = created_at::date;

alter table booking_events drop constraint if exists booking_events_kind_check;
alter table booking_events add constraint booking_events_kind_check
  check (kind in ('rescheduled', 'cancelled', 'loaded_without_payment', 'departed_with_missing', 'returned', 'return_deleted'));

create or replace function update_return(p_return_id uuid, p_form_date date, p_received_by text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r returns;
begin
  perform require_perm('returns.manage');
  select * into r from returns where id = p_return_id for update;
  if not found then raise exception 'Return not found'; end if;
  if r.status = 'cancelled' then raise exception 'A cancelled return cannot be edited'; end if;
  if p_form_date is null then raise exception 'Enter the date'; end if;
  if r.status = 'completed' and nullif(btrim(coalesce(p_received_by, '')), '') is null then
    raise exception 'Enter the name of the person who received the parcels';
  end if;
  update returns
  set form_date = p_form_date,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      received_by_name = case when r.status = 'completed' then btrim(p_received_by) else received_by_name end
  where id = r.id;
end $$;

create or replace function delete_return(p_return_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r returns;
  n int;
  actor uuid := auth.uid();
begin
  perform require_perm('returns.manage');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Enter the reason for deleting this return'; end if;
  select * into r from returns where id = p_return_id for update;
  if not found then raise exception 'Return not found'; end if;

  update parcels set status = 'in_warehouse', return_id = null
  where return_id = r.id and status in ('ready_for_return', 'returned');
  get diagnostics n = row_count;

  insert into booking_events (booking_id, kind, reason, actor_id, actor_name)
  values (r.booking_id, 'return_deleted',
          r.code || ' deleted (' || n || ' parcel(s) back in the warehouse): ' || btrim(p_reason),
          actor, (select full_name from profiles where id = actor));
  delete from returns where id = r.id;
end $$;

revoke execute on function update_return(uuid, date, text, text) from public, anon;
revoke execute on function delete_return(uuid, text) from public, anon;
grant execute on function update_return(uuid, date, text, text) to authenticated;
grant execute on function delete_return(uuid, text) to authenticated;
