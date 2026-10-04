-- The organization's legal details. The legal name is different from the brand name ("Mars Express").
-- It is shown on printed documents (pickup receipt, return form); the currency is the one amounts are in.
create table organization (
  id         uuid primary key default gen_random_uuid(),
  legal_name text not null default '' check (length(legal_name) <= 120),
  currency   text not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  country    text not null default 'United Arab Emirates' check (length(country) between 1 and 60),
  updated_at timestamptz not null default now()
);
create unique index organization_single on organization ((true)); -- there is exactly one organization
insert into organization default values;

alter table organization enable row level security;
create policy organization_select on organization for select to authenticated using (true);
revoke all on organization from anon;
revoke insert, update, delete on organization from authenticated;
grant select on organization to authenticated;

create or replace function set_organization(p_legal_name text, p_currency text, p_country text) returns void
language plpgsql security definer set search_path = public as $$
declare
  name text := btrim(coalesce(p_legal_name, ''));
  cur  text := upper(btrim(coalesce(p_currency, '')));
  land text := btrim(coalesce(p_country, ''));
begin
  perform require_perm('settings.manage');
  if length(name) > 120 then raise exception 'The organization name can have up to 120 characters'; end if;
  if cur !~ '^[A-Z]{3}$' then raise exception 'Choose a currency'; end if;
  if length(land) not between 1 and 60 then raise exception 'Enter the country'; end if;
  update organization set legal_name = name, currency = cur, country = land, updated_at = now();
end $$;
revoke execute on function set_organization(text, text, text) from public, anon;
grant execute on function set_organization(text, text, text) to authenticated;

create trigger audit_organization after insert or update or delete on organization
  for each row execute function audit_row();
