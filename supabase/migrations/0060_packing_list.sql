-- Packing list: the items of a booking get an order.
-- Design: docs/superpowers/specs/2026-10-17-packing-list-design.md
--
-- Until now items had no order of their own (the screens sorted by the random internal id). Each item now has a stored
-- position inside its booking. Existing items are numbered in the order the screens show today, so nothing visibly jumps.
-- The serial number shown on screen is not stored: it is the row's place in the list, so it renumbers by itself.

-- ---------- the column ----------
alter table booking_items add column if not exists position int;

update booking_items i set position = r.n
from (select id, row_number() over (partition by booking_id order by id) as n from booking_items) r
where r.id = i.id and i.position is null;

alter table booking_items alter column position set not null;
create index if not exists booking_items_booking_position_idx on booking_items (booking_id, position);

-- ---------- a new item goes last ----------
create or replace function booking_items_set_position() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.position is null then
    new.position := coalesce((select max(x.position) from booking_items x where x.booking_id = new.booking_id), 0) + 1;
  end if;
  return new;
end $$;
drop trigger if exists booking_items_set_position on booking_items;
create trigger booking_items_set_position before insert on booking_items
  for each row execute function booking_items_set_position();
