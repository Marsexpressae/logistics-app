-- Security hardening. The app is safe today because row security and permission checks stop the public role,
-- but the public (not signed-in) role should not hold rights it does not need. Defence in depth:
--   1. Our migration history table gets row security and is closed to everyone but the database owner.
--   2. The public role (anon) loses every right on the app's tables, and the right to run database functions,
--      except `track_booking`, the customer tracking page.
--   3. Signed-in users lose rights no screen uses (truncate, references, triggers on tables).
--   4. Functions created in the future are closed to the public role by default.
-- Signed-in users keep exactly the rights they have today.

-- 1. the migration history
alter table schema_migrations enable row level security;
revoke all on schema_migrations from anon, authenticated;

-- 2 + 3. tables
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke all on all sequences in schema public from anon;

-- 2. functions: close to the public role, keep the signed-in people's access exactly as it is now
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as signed_in_can,
           p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') -- not part of an extension
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.signed_in_can and not r.is_trigger then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

-- the customer tracking page is the one thing the public role may run
grant execute on function track_booking(text) to anon, authenticated;

-- 4. the future
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;
