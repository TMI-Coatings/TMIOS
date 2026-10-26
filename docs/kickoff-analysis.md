# TMI Ops: kickoff analysis

Step 1 of the build guide. Read from `reference/TMI-Ops-Demo.html` (v15 demo), `reference/one-page-spec.md` and `reference/security-brief.md`. No code written yet.

Prepared Oct 26, 2026 for Austin Lewis.

---

## 1. What the demo contains

### Screens (12 tabs + 2 dialogs)

| Tab | Who sees it in the demo | What it does |
| --- | --- | --- |
| My week | crew, supt | This week and next: job cards (when, where with map link, leader phone, site contact, orientation, PPE, crew-visible notes, crewmates), time-off banner, **Got it** acknowledgment, my certifications with expiry status |
| Dashboard | admin, scheduler, ceo | 5 KPIs (men scheduled vs target, leaders needed/available, backlog weeks and $, overrun count, gap weeks), two 13-week charts, verbal awards table, firmness mix for 8 weeks, **Needs attention** list, editable Assumptions |
| Schedule | everyone except crew and board | 13-week grid, editable cells (admin/ceo), filters (rep, PM, firmness incl. on hold), sort, firmness edge styles, winter/deadline/override markers, tags, totals rows (sold, on hold, available, open/short, leaders), supt "Confirm my crews", **Add job from estimate** |
| Work orders | admin, scheduler, ceo, Lori, estimator, PM, rep | KPIs, the chain, "your queue" per role, all work orders with sign-off dots, days waiting |
| Job journey | admin, scheduler, ceo, Lori, estimator, PM, rep, accounting | KPIs, "your checkpoints next 2 weeks", kanban by stage, overdue table, the step definitions |
| Billing | admin, ceo, accounting | KPIs, monthly progress billing table, final/milestone kanban (waiting on sign-off, ready, retainage outstanding, closed), final-only jobs running ahead of billing |
| Weekly close | admin, scheduler, ceo | Import from time system or CSV, per-job actuals with source and review flags, mark finished, close and roll forward |
| Revenue | admin, scheduler, ceo, rep, accounting | KPIs, monthly/weekly recognized vs forecast chart and table, WIP schedule with editable materials %, labor %, billed to date, recognition rules settings |
| Crew | admin, scheduler, ceo | Men and leaders available by week, add time off, upcoming time off, roster with quals, driver, DOT expiry, active flag |
| Alerts and log | everyone except board | Teams-style feed filtered per role, per-rule mute toggles, "Send Monday digest now", change log |
| Leader scorecard | admin, scheduler, ceo, supt (own only) | 12-month history per leader: hours vs bid, fade, field-caused fade, on-time, running jobs; drill-down with closeout cause tags |
| Board view | admin, ceo, board | Four trended metrics, firmness note, revenue by month, communication record, before/after table |
| Job window (dialog) | from any job link | Billing panel, journey panel, work order panel, hours stats and meters, all job fields, notes, site details, weekly crew assignment with issue tags, actuals history, per-job change log |
| Add job from estimate (dialog) | admin, scheduler, ceo, Lori | Job, estimate (value, hours, material cost with live split and GP preview), schedule, requirements, site details, note |

### Roles in the demo

`admin` (Austin), `ops` (Scheduler), `lori` (job setup), `est` (estimator), `pm`, `supt`, `crew`, `ceo` (Derrick), `acct` (Accounting), `rep`, `board`. A `sched` role is referenced in tab and alert lists but never defined; it's dead code.

### Edit rights in the demo (summary)

| Action | Who |
| --- | --- |
| Planned hours cells, start, projected hrs, must-finish, leader, settings, roster active flag | admin, ceo |
| Firmness and "waits on" | admin, ceo, scheduler, own PM, own rep |
| Status, hold reason, actual finish | admin, ceo, scheduler |
| Projected finish, crew size, weekly crew | admin, ceo, own supt (scheduler can't move dates) |
| Site details, time off, quals, driver flag | admin, ceo, scheduler |
| Notes | admin, ceo, scheduler, own supt |
| Work order upload / file in Procore | Lori, scheduler, admin, ceo |
| Work order sign-off | the person at that step, or admin/ceo acting for them (logged) |
| Journey checkpoint | owner role on that job, or admin/ceo; automatic items can't be toggled |
| Milestone reached | admin, ceo, scheduler, own PM |
| Invoices, retainage, billing method | accounting, admin, ceo |
| Materials %, labor %, billed to date | admin, ceo, scheduler |
| Closeout cause tags | admin, scheduler, ceo |

### Business rules

- **Weeks:** keyed by Friday week-ending date; Monday = Friday − 4.
- **Sold** = not complete and not Verbal. Verbal is shown hatched, never counted.
- **Plan spread:** hours left spread evenly across the job's remaining weeks; any typed week is kept and the rest rebalance.
- **Load** = sold, not on hold, planned hours that week. **On hold** shown separately, excluded from capacity math.
- **Capacity** = Σ active people × (1 − share of Mon–Fri days off) × hours per man-week × (1 − absence).
- **Leaders needed** = 1 per job with projected hrs ≥ large-job threshold, else 0.5. **Leaders available** = same capacity formula filtered to Leader.
- **Gap week** = load > capacity or leaders needed > leaders available (next 8 weeks).
- **Move-first suggestion:** in gap weeks, movable jobs (fill-in, very flexible, best guess) ranked by looseness.
- **EAC / overrun:** average burn of the last two actual weeks × weeks remaining + actual to date; overrun when EAC > projected × (1 + overrun %).
- **Backlog** weeks = sold hours left ÷ average 13-week capacity; dollars = value × hours left ÷ projected.
- **Open capacity to sell:** weeks 4–8 out with ≥ `openMin` hours open.
- **Winter:** exterior jobs in weeks whose Monday falls Dec 1 – Mar 15.
- **Firmness:** six levels (locked, confirmed, waiting on another job, very flexible, best guess, fill-in). Leaving Locked needs a reason (written to notes, alert fires). "Waiting" requires a predecessor; Blocked if predecessor finish ≥ this start, Watch if predecessor is overrunning. Best guess starting within 4 weeks → "Confirm dates".
- **On hold:** reason and restart date required; alert on/off hold; Needs-attention item when restart date passes.
- **Must-finish:** shutdown or contract obligation; flagged when projected finish is later.
- **Crew checks:** double-booked, time off, off roster, missing/expired qualification, DOT physical lapsed (drivers only), short crew. Auto-fill prefers last week's crew, then qualified people.
- **Weekly close:** import or type actuals; flags missing and ± variance > overrun % vs plan; unmatched job numbers listed; close allowed with blanks after confirm (named in digest); marks complete; rolls week; logs every entry with source; snapshots forecast; stores 4-weeks-out forecast; posts digest; runs gap, open-capacity, work-order and cert checks; auto-fills crew 3 weeks out.
- **Metrics per close:** utilization vs target headcount and vs full roster, backlog, forecast accuracy (vs forecast made 4 weeks earlier, missing jobs excluded), on-time (vs must-finish else baseline finish).
- **Revenue:** materials revenue = contract × material cost ÷ (material cost + est hrs × burdened rate), rounded; recognized = materials rev × materials % + labor rev × labor %. Suggested labor % = actual ÷ EAC; flag if 15+ pts off. Stale if % not updated this week once started. Margin fade flag at −3 pts. GP now uses EAC hours × rate. Materials forecast lands in first scheduled week (shipped policy) or spreads with labor (installed).
- **Over (under) billing** = billed − recognized.
- **Work orders:** job is booked immediately; WO states Awaiting draft → Draft → In review → Final (+ Returned). Sign-offs strictly in order: estimator, rep, PM, scheduler. Send-back needs a comment and restarts at estimator. Late after `woDays` per step; pings PM once per step. Lori marks final filed in Procore.
- **Job journey:** 9 stages, 17 checkpoints, each with owner and offset days from start or finish; 4 automatic (WO final, crew mobilized, work complete, final invoice). Job sits at its earliest unfinished stage; "not ready" if a startup checkpoint is late within 3 weeks of start. The demo labels stages/owners/lead times "placeholders to adjust".
- **Billing:** method per job (final, monthly progress, milestone). Progress: one pay app per job per month, due on `payDay`, suggested = recognized − billed, or "nothing to bill". Milestones are % of contract; remainder bills at sign-off; ≤ 100% total. Final: needs customer sign-off (journey "final walk") → ready → due in `invDays`. Retainage % per job, tracked until received.

### Alerts (9 rules)

Work order, Billing, Open capacity, Date moved, Overrun warning, Crew change, Capacity gap, Monday digest, Certification reminder (60/30 days and on expiry, by text). Routing per role is in `alertsFor()`; each user can mute any rule. Every alert is stored.

### Settings in the demo

Target headcount (50), absence (10%), hours per man-week (40), dedicated-leader job size (400 hrs), open-capacity alert (400 hrs), overrun (15%), pay-app day (25), invoice deadline (3 days), WO review deadline (2 days), burdened labor rate ($55), materials policy (shipped/installed).

**Hard-coded in the demo that rule 8 says should be settings:** winter window (Dec 1 – Mar 15), cert reminder days (60/30), labor-% divergence (15 pts), margin-fade flag (3 pts), under-billing flag ($1,000), over-billing red (10%), "starting soon" windows (14 and 21 days), half-leader weight for small jobs, open-capacity window (weeks 4–8), qualification list, time-off types, closeout causes, milestone template, journey checkpoints.

---

## 2. Proposed database tables

All money in cents (`bigint`), all weeks as the Friday `date`. Every table gets `created_at/by`, `updated_at/by`, `active` (soft delete) and a change-log trigger.

| Table | Main fields |
| --- | --- |
| `app_users` | auth user id, email, display name, role, linked `person_id` (crew/supt), rep code, PM code, estimator flag, active |
| `people` | name, initials, kind (leader / field / leadership), state, phone, driver, DOT expiry, active |
| `qualifications` | name (Confined space, Lift, Fiberglass, …) |
| `person_qualifications` | person, qualification, expires |
| `time_off` | person, first day, last day, type, active |
| `jobs` | number (4 digits, unique), customer, type, location, rep, PM, estimator, leader (person), crew size, estimate hrs, projected hrs, contract cents, material cost cents, material revenue cents, start, projected finish, baseline finish, must-finish date + reason, actual finish, status (Verbal / Scheduled / Active / On hold / Complete), firmness, waits-on job, hold reason, hold until, exterior, billing method, retainage %, PO, bill-to, lien waivers, certified payroll, site address / start time / contact / orientation / PPE |
| `job_requirements` | job, qualification |
| `job_notes` | job, text, pinned, crew-visible, author |
| `plan_overrides` | job, week, hours |
| `actual_hours` | job, week, hours, source (import / CSV / typed), import batch, entered by/at |
| `hour_imports` / `hour_import_lines` | file, who, when; raw job number, hours, matched job, unmatched flag |
| `week_closes` | week, closed by/at, jobs entered, total hrs, missing job list |
| `assignments` | job, person, week |
| `crew_confirmations` | job, week, leader, at |
| `field_acknowledgments` | person, week, at |
| `percent_complete` | job, week, materials %, labor %, entered by (history, not overwritten) |
| `revenue_snapshots` | job, week, recognized cents |
| `invoices` | job, kind (final / progress / milestone / skip), period, milestone, number, amount cents, date, by |
| `milestones` | job, label, %, reached date/by, invoice |
| `retainage_receipts` | job, amount, date |
| `work_orders` | job, status, current step, version, step-since date, final, filed in Procore, last ping key |
| `work_order_files` | work order, version, storage path, uploaded by/at |
| `work_order_steps` | work order, version, step (estimator / rep / PM / scheduler), state, by, at, comment |
| `journey_checkpoint_defs` | key, stage, order, label, owner role, offset days, anchor (start / finish), automatic source |
| `job_checkpoints` | job, checkpoint, done by/at (undo = inactive row) |
| `forecast_snapshots` | made week, target week, job, hours (covers same-week snapshot and 4-weeks-out) |
| `weekly_metrics` | week, utilization (target), utilization (roster), backlog weeks, backlog cents, accuracy, on-time |
| `closeout_outcomes` | job, final GP, on time, overrun cause (feeds the leader scorecard) |
| `alerts` | rule, title, body, recipients, job, created at, delivery status per channel |
| `alert_mutes` | user, rule |
| `alert_state` | dedupe keys (last gap set, open-capacity set, billing period alerted, WO pings, cert reminders sent) |
| `settings` | key, value, updated by/at |
| `change_log` | who, when, table, record, field, old value, new value |
| *Phase 4:* `procore_projects`, `procore_budget_lines`, `procore_change_orders`, `procore_timecards`, `sync_runs` | read-only mirrors, keyed by Procore id and job number |

---

## 3. Unclear, missing or contradictory

Ranked by how much each one could cost if guessed wrong.

### Blockers and security

1. **The GitHub repo is public.** `alewis2022/TMIOS` is visible to anyone. The brief requires code in a TMI-owned account; this is a personal account and public. Nothing has been pushed. Make it private (or move to a TMI org) before the first push.
2. **Field crew sign-in.** The guide says Microsoft only; the spec and brief both list it as an open decision (60+ crew likely without accounts; options: account per leader, or one-time code by text). This decides whether `crew` exists in Phase 1 and whether an SMS provider enters the stack.
3. **Texting isn't in the stack.** The demo and spec send cert reminders and "changes reach you by text." The guide's approved services are Teams webhook and email only. Texting needs a new outside service (needs Veracity), or texts become email for now.
4. **Per-person alerts vs one Teams channel.** Rules go to "PM, supt, Austin," but a Workflows webhook posts to one channel. Assumption: channel post for leadership + individual email for named people. Personal Teams messages would need Graph permissions beyond openid/profile/email.
5. **Work order file storage.** Drafts are uploaded files with customer scope and pricing. The brief doesn't mention file storage. Proposed: private Supabase Storage bucket, RLS-guarded, signed URLs. Needs to be in Veracity's summary.
6. **Reps and PMs see company totals.** The demo's Schedule totals rows and Revenue KPIs (sold revenue not recognized, net over/under billing, review count) use all jobs even when a rep or PM is viewing. With row-level security that only works through a deliberate aggregate function. Decide: should reps and PMs see company-wide capacity and revenue totals?

### Role and permission conflicts

7. **Derrick (ceo): read-only or full edit?** Spec: "Everything, read-only." Demo: ceo has every admin power (plan cells, settings, roster, acting for any sign-off).
8. **Who can move dates and plan cells?** Spec: "Austin or the PM can override any cell"; spec screen 1 says "drag a job to move its start." Demo: only admin/ceo edit cells and start dates; the scheduler can't move a start date; no drag. The scheduler not being able to move a job seems wrong for the person who owns the schedule.
9. **Who enters actuals?** Spec: "Scheduler / PM." Demo: Weekly close is admin, scheduler, ceo only.
10. **Closeout cause tags.** Demo text says the PM tags causes; the demo only lets admin, scheduler, ceo tag. The journey assigns that checkpoint to the PM.
11. **Finance role.** The brief lists "CFO/finance"; the guide and demo say "accounting." Billing alerts go to "Jared" by name. Is Jared an `accounting` user, an `admin`, or a separate `cfo` role?
12. **Board accounts.** TMI tenant users, or outside people as Entra guests?

### Business-rule conflicts

13. **Overrun definition.** Spec: hours left drops > 15% in one week, or run-rate pushes finish out. Demo: EAC (last-two-week burn) > projected × 1.15. Spec also says run-rate auto-pushes the projected finish; the demo never moves dates on its own. Recommendation: keep the demo's EAC rule; don't auto-move dates (it would fire Date-moved alerts nobody made).
14. **On-time completion.** Spec: finish date set 4 weeks prior. Demo: must-finish, else the finish date when first scheduled. These give different numbers for the board.
15. **"Nothing rolls until actuals are in"** (spec) vs. demo: close allowed with blanks after a confirm, named in the digest. Recommendation: keep the demo's approach.
16. **Shipped vs delivered.** The setting is stored as `delivered`, labeled "Shipped." For WIP these differ (supplier ship date vs on site). Which one does Jared's policy mean, and who records it: the PM's materials % or a shipped date?
17. **Retainage.** Demo: final invoice amount includes retainage; retainage then tracked as outstanding until received. Is that how TMI bills (retainage invoiced and withheld by the customer), or is retainage invoiced separately at release? Retainage % in the demo is guessed from the customer name; it needs to be a job field set at intake.
18. **Progress pay apps.** Suggested amount = recognized − billed. Do customers require AIA G702/703 schedule-of-values billing? If so, the app needs a schedule of values per job, which isn't in the demo.
19. **Change orders.** The spec leaves it open; the demo says "Pulled from Procore once connected." Until Phase 4, how do approved COs change contract value and hours? Milestone amounts use original contract only.
20. **Source of actual hours.** Weekly close imports from the time system or a CSV; Phase 4 also pulls Procore timecards. Which is the record? Two sources will disagree.
21. **Verbal jobs can't be entered.** Neither the status dropdown nor "Add job" offers Verbal. How does a verbal award get on the board, and who can enter it (rep? Lori?)?
22. **Contract split.** Spec open item: from the estimate, or entered by the PM at award. Demo derives it from cost proportions at the $55 rate, so changing the rate re-splits every job's revenue. Recommend freezing the split at intake.
23. **Journey checkpoints are "placeholders."** Do the stages, owners and lead times get finalized before Phase 2, or built as admin-editable definitions? I recommend editable definitions.
24. **Hard deletes in the demo.** Removing time off deletes it; rule 6 says mark inactive. Will follow rule 6.

### Inputs I'll need

25. Time-system name and a sample export with fake data (column layout).
26. Timezone for "Friday 3 PM close" and "Monday 6 AM digest" (assume America/Chicago; Netlify cron runs in UTC, so DST needs handling).
27. Spec open decisions still unchecked: scheduler name, absence and hours confirmed, 400-hr leader threshold, 15% overrun, Teams channel, go-live date and first board meeting, burdened rate.
28. Should the crew auto-fill (demo `fillCrew`) run in production, or only on a button press? Auto-fill at close quietly assigns people three weeks out.
29. Digest "open rate" as board proof (spec): Teams can't report opens and email tracking pixels add a privacy question. Drop it or count link clicks?
30. Leader scorecard history: the 12 months of closed jobs in the demo are synthetic. In production, does it start empty at go-live or load from Procore/Sage history (which counts as real data before approval)?
