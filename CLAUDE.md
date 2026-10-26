# TMI Ops: project rules

## What this is
Crew scheduling, forecasting, WIP, work orders, job journey and billing for TMI Coatings, an industrial coatings contractor. It replaces the 2026 Schedule workbook. reference/TMI-Ops-Demo.html is the functional spec: match its screens, rules, alerts and wording unless I say otherwise. reference/ also holds the one-page spec and the security brief, which set the limits.

## Stack (ask before changing any of it)
- React + TypeScript + Vite, hosted on Netlify
- Supabase Postgres, with row-level security on every table
- Sign-in: Supabase Auth with the Microsoft (Entra ID) provider, scopes openid, profile and email only
- Server code: Netlify Functions; scheduled functions for digests and syncs
- Tests: Vitest for business rules, Playwright for screens, run per role

## Hard rules
1. Sample data only. Never connect to the tmi-ops-prod project. Never import or paste real TMI data.
2. Procore is read-only: GET requests only. Never create, update or delete anything in Procore. No Sage connection of any kind.
3. Secrets live only in Netlify and Supabase environment settings. Never in code, the repo or the browser.
4. Access is enforced in the database with row-level security, not only hidden in the screen.
5. Every change to a job, crew, hours, status, firmness, work order, journey checkpoint or invoice writes a change-log row: who, when, what, old value, new value.
6. Never hard-delete records that carry history. Mark them inactive.
7. Money is stored in whole cents. Weeks end on Friday.
8. Thresholds (absence %, hours per man-week, overrun %, deadlines, pay-app day) are settings an admin can edit, never hard-coded.
9. Work in small steps: show me a plan, build, run the tests, then commit with a plain-English message.

## Roles
admin, ceo, scheduler (Nicole), job setup (Lori), estimator, pm, superintendent, sales rep, field crew (leaders only in Phase 1), accounting, cfo (Jared, full rights like admin and ceo). No board role: the board gets an exported PDF pack. Use the demo's permissions for each, except where docs/decisions.md says otherwise.

## Business rules to keep exactly
- Forecast counts sold work only. On-hold hours come out of capacity.
- Capacity = active roster less time off x hours per man-week x (1 - absence).
- Materials revenue is recognized by materials percent complete (PM or Jared); labor by PM percent complete. Both entered Mondays.
- Job numbers are four digits.
- Firmness, job journey checkpoints and billing methods work as in the demo.
- docs/decisions.md records the answers to the kickoff questions. Where it differs from the demo, it wins.
