-- "Automatic, next is 1010": the first number of a series that is not used yet, worked out in the database.
-- The screen used to guess by asking for 600 candidate numbers in one web address, which could grow too long.
-- Read-only. Only people who may type numbers (the same people who see the hint) can ask.
create or replace function next_number_preview(p_kind text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  s number_series;
  n bigint;
  taken boolean;
begin
  perform require_perm('numbers.edit');
  select * into s from number_series where kind = p_kind;
  if not found then raise exception 'Unknown number series'; end if;
  n := s.next_number;
  loop
    taken := false;
    if s.lookup_table is not null then
      execute format('select exists (select 1 from %I where %I = $1)', s.lookup_table, s.lookup_column) into taken using s.prefix || n;
    end if;
    exit when not taken;
    n := n + 1;
  end loop;
  return s.prefix || n;
end $$;
revoke execute on function next_number_preview(text) from public, anon;
grant execute on function next_number_preview(text) to authenticated;
