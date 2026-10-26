# Phase 1 plan: Foundation

Goal (from the spec): Microsoft sign-in, the database, the Schedule grid and the Crew screens. Gate: Austin can see the schedule in the app and it matches the workbook layout. Sample data only (hard rule 1).

## What gets built

1. **Database (Supabase Postgres)**, as migrations in `supabase/migrations/`:
   - Tables: `app_users`, `people`, `qualifications`, `person_qualifications`, `time_off`, `jobs`, `job_requirements`, `job_notes`, `plan_overrides`, `actual_hours`, `assignments`, `settings`, `change_log`.
   - Row-level security on every table. Role helpers read the signed-in user's row in `app_users`.
   - Field-level edit rules enforced by a database trigger on `jobs`, so the API refuses an edit the screen would also refuse.
   - Every insert or update writes per-field rows to `change_log` (who, when, table, record, field, old, new).
   - No deletes: there are no delete policies and the right is revoked; records are marked inactive instead.
   - Money in whole cents; weeks are Friday dates, with a check constraint.
   - Settings table seeded with the agreed starting values; admin and ceo can edit.
   - `company_load_inputs()`: a single security-definer function that hands reps and PMs the anonymized inputs for the company totals rows (decision 6).
2. **Business rules (TypeScript, Vitest)** in `src/domain/`: Friday weeks, plan spread with overrides, load, on-hold, capacity, leaders needed/available, gap weeks, tags (overrun, late, past must-finish, on hold, confirm dates, waits-on, winter), crew checks, and the permission matrix.
3. **App (React + Vite)**:
   - Sign-in with Microsoft (Supabase Auth, Azure provider, openid/profile/email only). Unknown emails get "ask an admin for access".
   - **Schedule**: 13-week grid; filters (rep, PM, firmness incl. on hold), sort; firmness edge styles; tags; totals rows (sold, on hold, available, open/short, leaders); editable plan cells per role; job window to change dates, status, firmness, crew size, leader, weekly crew, notes and site details per role.
   - **Add job** (admin, ceo, scheduler, job setup): four-digit job number, contract split frozen at intake (decision 22), retainage % and release terms (decision 17).
   - **Crew**: men and leaders available by week, time off (add / mark removed), roster with qualifications, driver, DOT expiry, active.
   - **Access** (admin, ceo): add people by email, set role and links (person, rep, PM).
   - **Settings** (admin, ceo): the thresholds.
4. **Sample mode** (`VITE_DATA_MODE=sample`): the same app running on in-browser sample data with a "Viewing as" role picker, as in the demo. It is used for the Phase 1 review and the Playwright tests, and it can be shown before Veracity signs off. It never talks to a database.
5. **Netlify**: `netlify.toml` with security headers. Supabase URL and anon key are environment settings; the service key is never used in the browser.

## How it is tested

- Vitest: business rules.
- Vitest against a local Postgres 16 with a small stand-in for Supabase's `auth` schema: every role's read and write rights, the change log and the no-delete rule.
- Playwright: the screens in sample mode, once per role.

## Not in Phase 1

Weekly close and actuals entry, dashboard, alerts and digest, work orders, journey, billing, revenue, scorecard, board pack, Procore. Crew auto-fill is a button with preview (decision 28) and is deferred to Phase 2 with weekly close.

## Calls I made where the demo and decisions were silent

- Leaders sign in as `superintendent`, linked to their person record. `field_crew` exists as a role but has no screens until the My week screen.
- `cfo` has the same Phase 1 rights as `accounting` (read the schedule). Its full rights are still open.
- Weekly crew assignment follows the demo: admin, ceo and the job's own leader. The scheduler can't, which looks wrong for the person who owns the board. Flagged for Austin.
- Phase 1 has no actuals entry, so hours left uses seeded sample actuals.
