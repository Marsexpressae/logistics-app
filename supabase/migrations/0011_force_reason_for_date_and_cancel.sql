-- The pickup date and cancelling must only change through reschedule_booking() / cancel_booking(), which
-- require a reason, keep a history and notify the other party. Block every direct way around them.
--
-- Invoker function on purpose: for a normal API request current_user is "authenticated"; inside the
-- security-definer functions (and migrations/admin scripts) it is the function owner, so those still work.
create or replace function guard_schedule_changes() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    if new.pickup_date is distinct from old.pickup_date then
      raise exception 'Use Reschedule to change the pickup date (a reason is required)';
    end if;
    if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      raise exception 'Use Cancel to cancel a booking (a reason is required)';
    end if;
  end if;
  return new;
end $$;

create trigger bookings_schedule_guard before update on bookings
  for each row execute function guard_schedule_changes();
