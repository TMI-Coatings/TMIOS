# TMI Ops: decisions

Answers to the open questions in `kickoff-analysis.md` section 3, decided by Austin on 2026-10-26. Numbers match that list. Where a decision changes the demo, the decision wins.

## Blockers and security

1. **Repo.** Moved to the `TMI-Coatings` org as `TMIOS`, private. Default branch is `TMIOS`.
2. **Field crew sign-in.** Phase 1: crew leaders only, with Microsoft accounts. Regular crew do not sign in. No SMS provider. Crew self-service comes later.
3. **Texting.** Not in Phase 1. Everything the demo texts goes by email. SMS is a separate change later, with its own vendor review.
4. **Alerts to named people.** A webhook post to the leadership Teams channel, plus an individual email to each named person. No extra Microsoft Graph permissions.
5. **Work order files.** Private Supabase Storage bucket guarded by row-level security, opened through short-lived signed links. Add to Veracity's summary.
6. **Company totals.** Reps and PMs see the full company totals, as in the demo (capacity, sold revenue not recognized, net over/under billing, review count). They are served through one summary function, so access can be narrowed later without a rebuild.

## Roles and permissions

7. **CEO (Derrick).** Full admin powers, as in the demo.
8. **Moving start dates and plan cells.** Admin, ceo and scheduler on any job; a PM on their own jobs. Every move is logged and fires the Date-moved alert.
8a. **Crew assignment.** Admin, ceo, cfo and scheduler on any job; a leader on their own jobs.
9. **Entering actuals.** Admin, ceo, scheduler, and a PM on their own jobs. The scheduler closes the week.
10. **Closeout cause tags.** The PM tags. Admin, ceo and scheduler can correct.
11. **Finance.** A new `cfo` role for Jared, with full rights: the same powers as admin and CEO. Billing alerts go to the role, not to a hard-coded name.
11a. **People and roles (Austin, Oct 26).** Full rights: Austin Lewis (admin), Derrick Gordon (ceo), Jared Wiese (cfo), Jason Jelinek, Director of Ops (admin), and Al Trenary (admin, Austin's backup). Project manager rights: Jake Moen (PM); Scott Salmon (estimator) and Lucas Kemmerer (purchaser), who work with PM rights, so each sees only the jobs where they are the PM. Estimators: Stephen Bazant, Juac Angoi, Sarah Louvar, Colicia Barnes, Jordan Strand. Sales reps: Ethan Miller, Keith Kubitschek, Phil Kick, Eric Rich, Gretchen Davies, Brent Elwood, Chris Monyhan. Scheduler: Nicole. Accounting: Patrick Leaon. Job setup stays Lori. Field leaders and crew in the sample are still invented. The sample site uses these names with @example.com addresses; live access is added on the Access screen with real TMI emails.
11b. **Sales dashboard (Austin, Oct 27).** Sales reps get the Dashboard tab, as a capacity-to-sell view: company-wide scheduled vs available hours, open hours by week with the 4-to-8-week sell window marked, leader shortfalls, and date firmness. It runs on the anonymous company totals, so reps still see no other customers or dollars.
12. **Board.** No board login and no board role. The board gets an exported PDF board pack, which admin, ceo or cfo can generate.

## Business rules

13. **Overrun.** The demo rule: alert when estimate at completion (last two weeks' burn) exceeds projected hours by more than the overrun % setting. Dates never move on their own.
14. **On-time completion.** Measured against the must-finish date if there is one, otherwise the finish date when the job first went on the board.
15. **Closing with blanks.** Allowed after a confirm. Jobs with missing actuals are named in the Monday digest.
16. **Materials revenue.** Recognized by a materials % complete, entered on Mondays by the PM or Jared, the same way as labor. (This replaces "recognized when shipped".) So the revenue forecast spreads what's left of materials across the schedule with labor, and the demo's "shipped or installed" setting is gone. PMs get the Revenue tab to enter their percentages.
17. **Retainage.** We invoice the gross amount and the customer holds back retainage; there is no separate retainage invoice. When retainage is released, the customer pays the held balance against the invoices already sent. The app tracks retainage held per invoice and the total outstanding per job. Both the retainage % and the release trigger (substantial completion, final completion, or other, with a note) vary by contract, so they are job fields set at intake from the contract. Assumed: Lori enters them.
18. **Pay apps.** The demo method: suggested amount = recognized − billed. No schedule of values or AIA G702/703.
19. **Change orders.** Entered by hand (amount, hours, date, approved by). Contract value and hours = original + approved COs. The Procore sync fills the same table in Phase 4.
20. **Source of actual hours.** Procore timecards are the record once Phase 4 connects. Until then, weekly close imports a time-system CSV, built so Procore can replace it with nothing downstream changing.
21. **Verbal awards.** Not on the board. They stay in the bidding process until there is a contract.
22. **Contract split.** Labor and materials amounts are entered at intake and frozen. Changing the rate never rewrites history.
23. **Job journey.** Admin-editable definitions (stages, owners, lead times), seeded from the demo's checkpoints.
24. **Deletes.** Hard rule 6 applies: removing time off marks it inactive.

## Inputs and settings

25. Time-system name and a sample export (fake data): **still needed**.
26. Timezone: America/Chicago, with daylight saving handled for the Netlify cron jobs (which run in UTC).
27. Starting settings, all editable by an admin: absence 10%, 40 hours per man-week, a dedicated leader on any job over 400 projected hours, 15% overrun, $55 burdened labor rate. The scheduler is **Nicole**. Teams channel: **pending (recommendation below)**. Go-live: Austin wants it within 2–3 weeks; see the go-live note below. First board meeting: not yet set.
28. Crew auto-fill. Runs only when the scheduler presses a button, and shows a preview to accept or edit. Never runs silently at close.
29. Digest engagement. Count signed-in clicks on digest links instead of opens. No tracking pixels.
30. Leader scorecard history. Starts empty at go-live.

## Still open

- Time-system name and a sample export layout (deferred).
- Teams channel: recommended a new private channel, "TMI Ops Alerts". Awaiting OK.
- What "go-live" means and its date: see below.
- First board meeting date.

## Go-live note

The spec's plan is four two-week phases plus a one-month parallel run, and Veracity approves security before the build starts. A 2–3 week target fits Phase 1 (Foundation): sign-in, schedule grid and crew screens on sample data, matching the workbook layout. Real TMI data cannot go in until Veracity signs off (hard rule 1).
