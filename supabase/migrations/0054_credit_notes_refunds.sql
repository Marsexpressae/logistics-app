-- Refunds and credit notes (stage 1: database foundation).
-- Design: docs/superpowers/specs/2026-10-15-refunds-credit-notes-design.md
--
-- After a booking is collected, invoiced or paid, "cancel" is the wrong tool: it leaves the invoice and the payments untouched.
-- The right tools are a CREDIT NOTE (lowers the invoice, no money moves) and a REFUND (money handed back).
-- Both are new, additive records. Existing payments and invoices are not changed. Nothing here is ever edited or deleted:
-- a mistake is VOIDED (the record stays, marked void, with a reason). Records are created and voided only through the
-- protected functions in this file, which check the permission and the rules; app users cannot write the tables directly.

-- ---------- credit notes ----------
create table if not exists credit_notes (
  id             uuid primary key default gen_random_uuid(),
  number         text not null unique,
  booking_id     uuid not null references bookings (id) on delete restrict,
  invoice_no     text not null,                       -- copied at the time, so the document never changes
  return_id      uuid references returns (id) on delete set null,
  note_date      date not null,
  reason         text not null check (length(btrim(reason)) > 0),
  old_total      numeric(12,2) not null,              -- the invoice total now, before this credit
  new_total      numeric(12,2) not null check (new_total >= 0), -- what is still charged (the kept services)
  credit_amount  numeric(12,2) not null check (credit_amount > 0),
  status         text not null default 'active' check (status in ('active', 'void')),
  void_reason    text,
  voided_at      timestamptz,
  voided_by_name text,
  created_by     uuid,
  created_by_name text,
  created_at     timestamptz not null default now(),
  check (credit_amount = old_total - new_total)
);
create index if not exists credit_notes_booking_idx on credit_notes (booking_id);
create index if not exists credit_notes_return_idx on credit_notes (return_id);

-- The services the business keeps charging for (transport, packing, labour, other). Their sum is the new invoice total.
create table if not exists credit_note_lines (
  id              uuid primary key default gen_random_uuid(),
  credit_note_id  uuid not null references credit_notes (id) on delete restrict,
  category        text not null check (category in ('transport', 'packing', 'labour', 'other')),
  amount          numeric(12,2) not null check (amount > 0),
  note            text
);
create index if not exists credit_note_lines_note_idx on credit_note_lines (credit_note_id);

-- ---------- refunds ----------
create table if not exists refunds (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique,
  booking_id      uuid not null references bookings (id) on delete restrict,
  credit_note_id  uuid references credit_notes (id) on delete restrict, -- none for a plain overpayment
  amount          numeric(12,2) not null check (amount > 0),
  method          text not null check (method in ('cash', 'bank_transfer')),
  refund_date     date not null,
  note            text,
  handed_by       uuid,
  handed_by_name  text,
  status          text not null default 'active' check (status in ('active', 'void')),
  void_reason     text,
  voided_at       timestamptz,
  voided_by_name  text,
  created_at      timestamptz not null default now()
);
create index if not exists refunds_booking_idx on refunds (booking_id);
create index if not exists refunds_credit_note_idx on refunds (credit_note_id);

-- ---------- who can read and write ----------
alter table credit_notes enable row level security;
alter table credit_note_lines enable row level security;
alter table refunds enable row level security;
revoke all on credit_notes, credit_note_lines, refunds from anon;
revoke insert, update, delete on credit_notes, credit_note_lines, refunds from authenticated;
grant select on credit_notes, credit_note_lines, refunds to authenticated;

-- Reading follows exactly who may read payments today (payments_select).
drop policy if exists credit_notes_select on credit_notes;
create policy credit_notes_select on credit_notes for select to authenticated using (
  (select has_perm('accounts.view'))
  or ((select has_perm('pickups.collect')) and exists (select 1 from bookings b where b.id = credit_notes.booking_id))
);
drop policy if exists refunds_select on refunds;
create policy refunds_select on refunds for select to authenticated using (
  (select has_perm('accounts.view'))
  or ((select has_perm('pickups.collect')) and exists (select 1 from bookings b where b.id = refunds.booking_id))
);
drop policy if exists credit_note_lines_select on credit_note_lines;
create policy credit_note_lines_select on credit_note_lines for select to authenticated using (
  exists (select 1 from credit_notes c where c.id = credit_note_lines.credit_note_id)
);

-- Every change is written to the change log (the Activity page).
drop trigger if exists audit_credit_notes on credit_notes;
create trigger audit_credit_notes after insert or update or delete on credit_notes for each row execute function audit_row();
drop trigger if exists audit_credit_note_lines on credit_note_lines;
create trigger audit_credit_note_lines after insert or update or delete on credit_note_lines for each row execute function audit_row();
drop trigger if exists audit_refunds on refunds;
create trigger audit_refunds after insert or update or delete on refunds for each row execute function audit_row();

-- ---------- permissions ----------
insert into permissions (key, group_name, label, description, sort) values
  ('refunds.issue', 'Accounts', 'Issue refunds and credit notes', 'Lower an invoice with a credit note and hand money back with a refund, after a pickup is collected', 90),
  ('refunds.void', 'Accounts', 'Void refunds and credit notes', 'Cancel a credit note or refund made by mistake (the record stays, marked void, with the reason)', 91)
on conflict (key) do nothing;
insert into role_permissions (role, permission) values
  ('manager', 'refunds.issue'), ('super_admin', 'refunds.issue'), ('super_admin', 'refunds.void')
on conflict do nothing;

-- ---------- numbers (Settings > Numbering) ----------
select register_number_series('credit_note', 'Credit note numbers', 'CR-', 1001, 'credit_notes', 'number', 50);
select register_number_series('refund', 'Refund numbers', 'RF-', 1001, 'refunds', 'number', 60);

-- ---------- the money maths, in ONE place ----------
-- For a booking: the invoice total now (original amount minus active credits), what has been paid (payments minus active
-- refunds), the balance still due, the refund due (paid above what is now owed), and the payment state.
-- Accounts totals, the invoice list, search and the booking page all read this, so they cannot disagree.
-- It runs with the caller's own rights (no security definer), so row security on payments, refunds and credit notes applies:
-- a person who may not read the money sees nothing of it.
-- Payment state, in this order: not_invoiced, refund_due, credited, paid, partial, unpaid.
create or replace function money_of(p_booking uuid)
returns table (invoice_now numeric, paid numeric, balance_due numeric, refund_due numeric, pay_status text)
language sql stable set search_path = public as $$
  with m as (
    select b.invoice_amount,
           coalesce((select sum(p.amount) from payments p where p.booking_id = p_booking), 0)
             - coalesce((select sum(r.amount) from refunds r where r.booking_id = p_booking and r.status = 'active'), 0) as paid,
           coalesce((select sum(c.credit_amount) from credit_notes c where c.booking_id = p_booking and c.status = 'active'), 0) as credits
    from bookings b
    where b.id = p_booking
  )
  select case when m.invoice_amount is null then null else round(m.invoice_amount - m.credits, 2) end,
         round(m.paid, 2),
         case when m.invoice_amount is null then null else greatest(round(m.invoice_amount - m.credits - m.paid, 2), 0) end,
         case when m.invoice_amount is null then 0 else greatest(round(m.paid - (m.invoice_amount - m.credits), 2), 0) end,
         case when m.invoice_amount is null then 'not_invoiced'
              when m.paid > m.invoice_amount - m.credits then 'refund_due'
              when m.invoice_amount - m.credits = 0 and m.paid = 0 then 'credited'
              when m.invoice_amount - m.credits - m.paid <= 0 then 'paid'
              when m.paid > 0 then 'partial'
              else 'unpaid' end
  from m
$$;

-- The same numbers as one JSON object, for the app.
create or replace function booking_money(p_booking uuid) returns jsonb
language sql stable set search_path = public as $$
  select to_jsonb(m) from money_of(p_booking) m
$$;

revoke execute on function money_of(uuid), booking_money(uuid) from public, anon;
grant execute on function money_of(uuid), booking_money(uuid) to authenticated;

-- ---------- issuing a credit note ----------
-- p_lines is a JSON list of kept services: [{"category": "transport", "amount": 400, "note": "..."}].
-- The new invoice total is the SUM of those lines (it is never typed); no lines means a full credit.
-- The credit is the old total minus the new total, and must be above zero.
create or replace function issue_credit_note(p_booking_id uuid, p_reason text, p_lines jsonb, p_date date default null, p_return_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  today date := (now() at time zone 'Asia/Dubai')::date;
  day date;
  old_total numeric;
  new_total numeric := 0;
  line jsonb;
  amount numeric;
  cn_id uuid;
  actor uuid := auth.uid();
begin
  perform require_perm('refunds.issue');
  select * into b from bookings where id = p_booking_id for update;
  if not found then raise exception 'Booking not found'; end if;
  if b.status = 'cancelled' then raise exception 'A cancelled booking cannot be credited'; end if;
  if b.status not in ('collected', 'at_warehouse') then raise exception 'Credit notes are only for bookings that have been collected'; end if;
  if b.invoice_amount is null or b.invoice_no is null then raise exception 'This booking has no invoice amount yet'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'A reason is required'; end if;

  for line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if coalesce(line ->> 'category', '') not in ('transport', 'packing', 'labour', 'other') then
      raise exception 'Choose a category for each kept service: transport, packing, labour or other';
    end if;
    amount := round(coalesce((line ->> 'amount')::numeric, 0), 2);
    if amount <= 0 then raise exception 'Each kept service needs an amount above zero'; end if;
    new_total := new_total + amount;
  end loop;

  old_total := (select m.invoice_now from money_of(p_booking_id) m);
  if new_total >= old_total then raise exception 'The new invoice total must be below the current total (%)', old_total; end if;

  day := coalesce(p_date, today);
  if day > today then raise exception 'The date cannot be in the future'; end if;
  if b.collected_at is not null and day < (b.collected_at at time zone 'Asia/Dubai')::date then
    raise exception 'The date cannot be before the collection day (%)', (b.collected_at at time zone 'Asia/Dubai')::date;
  end if;
  if p_return_id is not null and not exists (select 1 from returns r where r.id = p_return_id and r.booking_id = p_booking_id) then
    raise exception 'That return belongs to another booking';
  end if;

  insert into credit_notes (number, booking_id, invoice_no, return_id, note_date, reason, old_total, new_total, credit_amount, created_by, created_by_name)
  values (take_next_number('credit_note'), b.id, b.invoice_no, p_return_id, day, btrim(p_reason), old_total, new_total, old_total - new_total,
          actor, (select full_name from profiles where id = actor))
  returning id into cn_id;

  insert into credit_note_lines (credit_note_id, category, amount, note)
  select cn_id, l ->> 'category', round((l ->> 'amount')::numeric, 2), nullif(btrim(coalesce(l ->> 'note', '')), '')
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;

  return cn_id;
end $$;
revoke execute on function issue_credit_note(uuid, text, jsonb, date, uuid) from public, anon;
grant execute on function issue_credit_note(uuid, text, jsonb, date, uuid) to authenticated;
