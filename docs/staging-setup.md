# A test copy of the system (staging) and automatic checks

**Why:** today every push goes straight to the live app and the live database. A second, empty copy lets changes be tried
(and database changes applied) before real people depend on them.

## What is already in place (no action needed)

- **Automatic checks** run on every change (GitHub, "Checks"): code style, types, 111 tests and a full build.
  A red cross on a commit means something is wrong. They never touch the live database.
- **Real-database tests** (`npm run test:db`): 10 tests of the actual permission and safety rules. Each runs in a
  transaction that is rolled back, so nothing is kept. They run against whichever database address is set.

## What is NOT in place yet: the test copy itself (about 15 minutes, needs your accounts)

> **Important today:** Vercel *preview* links (the "dev version" links) currently use the **live** database, so anything saved
> on a preview is real. Until step 4 is done, previews are for looking only.

1. **Create a second Supabase project** (free) named `mars-express-staging`. Same region as the live one.
2. **Copy three things** from it (Project Settings): the *Database connection string* (the pooler URL, with the password),
   the *Project URL*, and the *publishable (anon) key*, plus the *service role key*.
3. **Put the database address in GitHub:** repository Settings > Secrets and variables > Actions > New repository secret,
   name `SUPABASE_STAGING_DB_URL`. From then on the "Real-database tests" job fills the test copy with the newest changes and
   tests the rules on it automatically.
4. **Point previews at the test copy (Vercel):** project Settings > Environment Variables. For the variables
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, make sure the live
   values are ticked for **Production only**, and add the test copy's values for **Preview only**.
5. **Create the first login on the test copy:** in the test project, Authentication > Users > Add user, then in the SQL editor:
   ```sql
   insert into profiles (id, full_name, role, active)
   select id, 'Test admin', 'super_admin', true from auth.users where email = 'YOUR-TEST-EMAIL';
   ```

## First run

The 45 database changes have only ever been applied step by step to the live database, never to an empty one in one go.
The first run on the empty test copy may reveal a step that assumed something already existed. If so, tell me; fixing that
also makes it possible to rebuild the system from nothing after a disaster.

To fill the test copy by hand (any time):

```
SUPABASE_DB_URL="<the test database address>" npm run db:migrate
SUPABASE_DB_URL="<the test database address>" npm run test:db
```

## The routine that follows

1. Make a change on a branch and push the branch. GitHub runs the checks. Vercel makes a preview on the test copy.
2. Look at the preview. Database changes were already applied to the test copy by the checks.
3. Only when happy: merge to `main`, which goes live, and apply the database change to the live database
   (`npm run db:migrate`) at a quiet moment.
