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
9. **Entering actuals.** Admin, ceo, scheduler, and a PM on their own jobs. The scheduler closes the week.
10. **Closeout cause tags.** The PM tags. Admin, ceo and scheduler can correct.
11. **Finance.** A new `cfo` role for Jared: accounting powers plus company financial views and billing approvals. Exact rights to be confirmed before the RLS policies are written. Billing alerts go to the role, not to a hard-coded name.
12. **Board.** No board login and no board role. The board gets an exported PDF board pack, which admin, ceo or cfo can generate.

## Business rules

13. **Overrun.** The demo rule: alert when estimate at completion (last two weeks' burn) exceeds projected hours by more than the overrun % setting. Dates never move on their own.
14. **On-time completion.** Measured against the must-finish date if there is one, otherwise the finish date when the job first went on the board.
15. **Closing with blanks.** Allowed after a confirm. Jobs with missing actuals are named in the Monday digest.
16. **Materials revenue.** Recognized by a materials % complete, entered on Mondays by the PM or Jared, the same way as labor. (This replaces "recognized when shipped".)
17. **Retainage.** Retainage % is a job field set at intake. How it is billed is **open: ask Jared**.
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
27. Starting settings, all editable by an admin: absence 10%, 40 hours per man-week, a dedicated leader on any job over 400 projected hours, 15% overrun, $55 burdened labor rate. The scheduler is **Nicole**. Teams channel, go-live date and first board meeting: **still open**.
28. Crew auto-fill. Runs only when the scheduler presses a button, and shows a preview to accept or edit. Never runs silently at close.
29. Digest engagement. Count signed-in clicks on digest links instead of opens. No tracking pixels.
30. Leader scorecard history. Starts empty at go-live.

## Still open

- Retainage billing mechanics (Jared).
- Exact rights of the `cfo` role.
- Time-system name and a sample export layout.
- Teams channel for alerts, go-live date, first board meeting.
