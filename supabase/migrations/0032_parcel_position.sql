-- An optional free-text position for a parcel inside its warehouse ("Rack 3", "Left wall"), so staff can find it.
-- No master list: it is typed. Search finds parcels by it. Changes are recorded in the Activity log (parcels are audited).
alter table parcels add column if not exists position text check (position is null or length(position) <= 60);

create or replace function set_parcel_position(p_parcel_id uuid, p_position text) returns void
language plpgsql security definer set search_path = public as $$
declare pos text := nullif(btrim(coalesce(p_position, '')), '');
begin
  perform require_perm('warehouse.manage');
  if pos is not null and length(pos) > 60 then raise exception 'The position can have up to 60 characters'; end if;
  update parcels set position = pos where id = p_parcel_id;
  if not found then raise exception 'Parcel not found'; end if;
end $$;
revoke execute on function set_parcel_position(uuid, text) from public, anon;
grant execute on function set_parcel_position(uuid, text) to authenticated;
