-- Packing list: the items of a booking get an order.
-- Design: docs/superpowers/specs/2026-10-17-packing-list-design.md
--
-- Until now items had no order of their own (the screens sorted by the random internal id). Each item now has a stored
-- position inside its booking. Existing items are numbered in the order the screens show today, so nothing visibly jumps.
-- The serial number shown on screen is not stored: it is the row's place in the list, so it renumbers by itself.

-- ---------- the column ----------
alter table booking_items add column if not exists position int;

-- Numbering the existing items is housekeeping, not a change anyone made, so the change log is switched off for this one step
-- (otherwise every item of every booking would get a "position" entry "by system" in the Activity log).
alter table booking_items disable trigger audit_booking_items;
update booking_items i set position = r.n
from (select id, row_number() over (partition by booking_id order by id) as n from booking_items) r
where r.id = i.id and i.position is null;
alter table booking_items enable trigger audit_booking_items;

alter table booking_items alter column position set not null;
create index if not exists booking_items_booking_position_idx on booking_items (booking_id, position);

-- ---------- a new item goes last ----------
create or replace function booking_items_set_position() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.position is null then
    -- one new item at a time per booking, so two people adding at the same moment do not get the same position
    perform pg_advisory_xact_lock(hashtext(new.booking_id::text));
    new.position := coalesce((select max(x.position) from booking_items x where x.booking_id = new.booking_id), 0) + 1;
  end if;
  return new;
end $$;
drop trigger if exists booking_items_set_position on booking_items;
create trigger booking_items_set_position before insert on booking_items
  for each row execute function booking_items_set_position();

-- ---------- move an item one place up or down ----------
-- Swaps the item with its neighbour. It runs with the CALLER's rights (no security definer), so the existing policy
-- items_write decides who may do it: items.edit while the booking is booked, items.edit_after any time. A person who may not
-- edit the items changes nothing and gets a plain message. The booking's items are locked while swapping, so two people
-- moving at once cannot leave two items in the same place.
create or replace function move_booking_item(p_item_id uuid, p_direction text) returns void
language plpgsql set search_path = public as $$
declare
  it booking_items;
  nb booking_items;
  changed int;
begin
  if p_direction is null or p_direction not in ('up', 'down') then raise exception 'Direction must be up or down'; end if;
  select * into it from booking_items where id = p_item_id;
  if not found then raise exception 'Item not found'; end if;

  perform 1 from booking_items where booking_id = it.booking_id order by id for update;
  -- items that ended up with the same position (two inserts at the same moment) are renumbered first, so the swap below always works
  if exists (select 1 from booking_items where booking_id = it.booking_id group by position having count(*) > 1) then
    update booking_items b set position = r.n
    from (select id, row_number() over (order by position, id) as n from booking_items where booking_id = it.booking_id) r
    where r.id = b.id and b.position is distinct from r.n;
  end if;
  select * into it from booking_items where id = p_item_id; -- read again once the lock is ours (and after any renumbering)

  if p_direction = 'up' then
    select * into nb from booking_items where booking_id = it.booking_id and (position, id) < (it.position, it.id) order by position desc, id desc limit 1;
    if not found then raise exception 'It is already first'; end if;
  else
    select * into nb from booking_items where booking_id = it.booking_id and (position, id) > (it.position, it.id) order by position, id limit 1;
    if not found then raise exception 'It is already last'; end if;
  end if;

  update booking_items set position = case id when it.id then nb.position else it.position end where id in (it.id, nb.id);
  get diagnostics changed = row_count;
  if changed <> 2 then raise exception 'You cannot change this packing list'; end if;
end $$;
revoke execute on function move_booking_item(uuid, text) from public, anon;
grant execute on function move_booking_item(uuid, text) to authenticated;
