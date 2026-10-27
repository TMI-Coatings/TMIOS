# TMI Ops

Crew scheduling and forecasting for TMI Coatings. It replaces the 2026 Schedule workbook. Project rules are in `CLAUDE.md`; decisions are in `docs/decisions.md`; the Phase 1 plan is in `docs/phase-1-plan.md`.

**What's built** (every screen in the demo, plus the changes since; see `docs/decisions.md`):

| Area | Screens |
| --- | --- |
| Foundation | Microsoft sign-in, Access (with "Also estimates"), Settings with enforced limits, Change log; row-level security and a change log on every table |
| Schedule | Schedule grid (find a job, sticky header and job column, warnings for over-typed weeks), job window (intake corrections, leader double-booking warning), Add job from estimate, Crew (availability, time off, roster, certification expiry dates, auto-fill with preview) |
| The week | Weekly close (PM hours, CSV import that asks before replacing typed hours, "Waiting on hours" with a nudge, review, close in the database), Dashboard (capacity-to-sell view for reps), Alerts with per-person mutes and the Monday digest, My week, Confirm my crews |
| Jobs | Work orders (draft upload, four sign-offs in order, send-back history, Remind, filed in Procore), Job journey (admin-editable stages and checkpoints) |
| Money | Revenue and WIP (Monday percent complete, recognized revenue, margin, CSV export, month-end WIP locked for the books), Billing (final, monthly, milestone; retainage held per invoice and part payments; payments received, AR aging, retainage by release trigger), change orders with cost and approver |
| Reporting | Leader scorecard (PM tags overrun causes), Board view with the financial position and the PDF board pack |

**Who sees what:** reps and PMs see every job and its dollars but change only their own; leaders, crew and estimators see hours only, enforced in the database. The full table is in `reference/security-brief.md`.

**Still to come (needs outside approvals):** Teams and email delivery of alerts, the Monday 6 AM digest and work-order reminders as scheduled Netlify functions, Procore read-only sync, and the time-system import. Until then alerts show in the app and hours come in by CSV.

## Try it on sample data

```
npm install
npm run dev:sample
```

This opens the app on invented data held in your browser, with a "Viewing as" picker to switch roles. Netlify deploy previews and branch deploys build this way, so a link can be shared before Veracity signs off. The production build doesn't contain sample mode.

## Tests

```
npm test                 # business rules (Vitest)
npm run test:db          # security rules against a local Postgres 16
npm run test:e2e         # screens, once per role (Playwright, sample mode)
```

`test:db` needs a local Postgres. It uses `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/postgres`), creates a throwaway database, and refuses to run against anything that looks like a hosted Supabase project. It runs every permission rule in `src/domain/permissions.ts` against the database, so the screens and the database can't drift apart.

If Playwright can't find its browser, point it at one with `PW_CHROMIUM_PATH`.

## Setting up the live site (with Veracity)

Do this on a **dev** Supabase project first. Never point anything here at `tmi-ops-prod` until security is approved (hard rule 1).

1. **Supabase project.** Create the project in a TMI-owned account. Apply `supabase/migrations/` in order (Supabase CLI `supabase db push`, or paste each file into the SQL editor). On the dev project only, load `supabase/seed.sql` for sample data (`npm run db:seed-sql` regenerates it for the current week).
2. **Microsoft sign-in.** Veracity registers TMI Ops in Entra ID as a single-tenant app (TMI accounts only), with delegated permissions `openid`, `profile` and `email` only. The redirect URI is `https://<project>.supabase.co/auth/v1/callback`. In Supabase, under Authentication > Providers > Azure, enter the client ID and secret, and set the Azure tenant URL to TMI's tenant (`https://login.microsoftonline.com/<tenant-id>`), not "common". Add the Netlify site URL under Authentication > URL configuration.
3. **Netlify.** Connect the repo. Under Site configuration > Environment variables, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The anon key is public by design: row-level security protects the data. The service role key never goes in Netlify's build settings, the code or the browser.
4. **First admin.** In the Supabase SQL editor:
   `insert into app_users (email, name, role) values ('<your TMI email>', 'Austin Lewis', 'admin');`
   Everyone after that is added on the Access screen. A person can only get in once their email is listed there.
5. **Leaving TMI.** Turn the person off on the Access screen. That stops their data access on their next request. Turning off their Microsoft account stops new sign-ins, but an already-open session can keep refreshing until it is turned off here, so do both. Consider the Supabase session time-box and inactivity timeout settings.

## How it's built

- `src/domain/`: business rules (weeks, plan spread, capacity, tags, crew checks, permissions). No screen or database code.
- `src/data/`: one interface, two versions: `supabaseRepo.ts` (live) and `sampleRepo.ts` (in-browser sample).
- `src/screens/`: the screens. `src/styles.css` is the demo's stylesheet.
- `supabase/migrations/`: tables, row-level security, the edit trigger on jobs, the change-log trigger and every write the screens make (weekly close, work orders, billing, payments, month-end WIP, reminders). Apply them in file order.
- Hard rules held by the database: four-digit job numbers, Friday weeks, money in whole cents, no deletes, every change logged, and a reason required to move a job off Locked.
