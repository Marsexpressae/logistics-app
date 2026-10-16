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
