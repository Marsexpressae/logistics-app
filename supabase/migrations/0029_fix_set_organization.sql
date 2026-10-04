-- The database refuses an UPDATE that has no WHERE condition (a safety rule). Saving the organization had none.
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
  update organization set legal_name = name, currency = cur, country = land, updated_at = now() where id is not null;
end $$;
