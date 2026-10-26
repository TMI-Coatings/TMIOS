# TMI Ops — One-Page Spec

Oct 16, 2026 · @Austin Lewis

## Purpose

Replace the 2026 Schedule workbook with a web app that forecasts crew load 13 weeks out, rolls itself forward every week, and gives the board a trend they can verify.

One source of truth, four audiences: the scheduler enters actuals, PMs and supts see their jobs, Austin and Derrick see capacity and gaps, the board sees four numbers over time. Sold work only in the forecast; every change is logged with who, what, and when.

## Roles and the weekly rhythm

The week closes Friday; the digest goes out Monday 6 AM. Nothing rolls until actuals are in.

| Role | Does weekly | Sees |
| --- | --- | --- |
| Scheduler / PM | Enters actual hours per job by Friday 3 PM; marks jobs complete | All jobs, data entry screens |
| Superintendent / job leader | Confirms crew and finish date on their jobs; gets alerts on their jobs | Own jobs |
| Austin | Reviews capacity gaps; adjusts crew size and leader assignments | Everything, admin rights |
| Derrick | Reads the Monday digest and Dashboard | Everything, read-only |
| Board | Quarterly board view | Board tab only |

Missing actuals are named in the digest by job and by the person responsible. That is the accountability mechanism; nobody chases.

## Data model

Six objects. Jobs carry estimates; weekly entries carry actuals; the forecast is computed, never typed.

| Object | Key fields | Replaces in old workbook |
| --- | --- | --- |
| Job | Job #, type, customer, location, sales rep, PM, supt, crew size, original estimate hrs, projected hrs, start, projected finish, actual finish, status | Master Schedule A:P |
| Week entry | Job, week ending, planned hrs, actual hrs, entered by, entered at | Master Schedule Q:AH + Hours History |
| Person | Name, initials, role (leader / field / leadership), state, active, medical card expiry | Crew List |
| Time off | Person, start, end, type | Crew List F:G |
| Assignment | Job, person, week ending (who is on what) | Not tracked today |
| Event | Who, object, field, old value, new value, when | Not tracked today |

Hours Left = projected hrs minus sum of actuals, computed. Available men per week = active roster minus time off, computed. Leaders available per week = same, filtered to role = leader.

## Screens

Six screens, phone-friendly for supts, full-width for the office.

1. **Schedule grid** — jobs down, weeks across (13 shown, scroll for more); planned hrs per cell; capacity row at the bottom turns red where load exceeds available men. Drag a job to move its start.
2. **Job page** — one job: estimate vs. actual to date, crew, leader, finish date, change log, comments.
3. **Weekly close** — the scheduler's Friday screen: every active job in one list, type actual hours, mark complete, submit. Shows what is still missing.
4. **Crew** — roster, time off, leader flag, medical card expiry; add or remove with no formula risk.
5. **Dashboard** — this week and next 13: men available vs. scheduled, leaders available vs. required, jobs at risk (hours left trending over), backlog in weeks.
6. **Board view** — the four metrics in the Board section, as trend lines from go-live.

## Forecasting logic

Sold work only. The forecast answers one question per week: do we have the men and the leaders for what is sold?

- **Load** per week = sum of planned hrs across jobs scheduled that week. Planned hrs default to projected hrs spread evenly over start to projected finish; Austin or the PM can override any cell.
- **Capacity** per week = available men times 40, less a stated absence rate (start at 10%, tune from actuals).
- **Leader load** = jobs active that week, weighted by size (1 leader per large job; small jobs share). Leaders are the binding constraint today, so this gets its own line.
- **Run-rate check** = for each job, actual hrs per week so far vs. planned; a job burning faster than plan gets its projected finish pushed out automatically and flagged.
- **Backlog in weeks** = total sold hours left divided by average weekly capacity. This is the number for Derrick and the board.
- **Forecast accuracy** = each Monday, store that week's forecast load; after close, compare to actual. Trended, this proves the forecast can be trusted.

Hook for later: a pipeline-hours toggle from the Sales Guide at a stated close rate. Not in v1.

## Notification rules

Five rules at launch, delivered to a Teams channel with email backup. Each message links to the job. Leadership can mute per rule; Derrick gets all five by default.

| Rule | Fires when | Goes to |
| --- | --- | --- |
| Date moved | Job start or projected finish changes by 1+ day | PM, supt, Austin, Derrick |
| Overrun warning | Hours left drops more than 15% in one week, or run-rate pushes finish out | PM, supt, Austin |
| Crew change | Crew size or leader changes on an active job | PM, supt, Austin |
| Capacity gap | Any of the next 8 weeks has load above capacity, or leader load above leaders available | Austin, Derrick |
| Monday digest | Every Monday 6 AM: this week's jobs and leaders, gaps, jobs missing last week's actuals, forecast accuracy last week | Full leadership team |

Every notification is also a row in the Event log, so the board story (who was told what, when) is self-documenting.

## Board metrics and the before/after

Four numbers, trended weekly from go-live, shown quarterly. Each one was either unmeasured or hand-assembled before.

| Metric | Definition | Before |
| --- | --- | --- |
| Utilization | Actual field hrs / available hrs | Not measured; estimated from job cost after the fact |
| Backlog (weeks) | Sold hrs left / avg weekly capacity | Guessed from the grid by eye |
| Forecast accuracy | Actual load vs. Monday forecast, 4-week avg | Did not exist |
| On-time completion | Jobs finished by the finish date set 4 weeks prior | Not tracked |

The communication story in one slide: before, a workbook one person updated, overwritten weekly, no history, no alerts. After, a shared system with a full change log, five automatic alerts, a Monday digest to the whole leadership team, and twelve months of history. Pull the Event log count and the digest open rate as the proof.

Estimated vs. actual hours by job also comes free from this data and feeds the estimating scorecard metric.

## Revenue recognition and forecast

Each contract splits into a materials value and a labor value; PMs enter percent complete for each at the Monday job cost meeting, and recognized revenue = materials value × materials % + labor value × labor %. The forecast spreads what is left across the schedule’s planned hours, so moving a job moves its revenue.

- **Labor % check:** hours used against hours at completion give a suggested labor %. A PM entry 15+ points away is flagged for review.
- **Materials rule:** materials are recognized when shipped (finance policy); remaining material revenue lands in the job’s first scheduled week.
- **Intake from the estimate:** each new job comes in with contract value, estimated labor hours and projected material cost. Contract revenue splits between materials and labor in proportion to those estimated costs.
- **Margin fade:** GP % at bid against GP % now (hours at completion at the burdened labor rate plus estimated material cost). A 3-point drop flags the job for Monday review, as do stale percentages and a labor % that disagrees with hours.
- **Billing:** billed to date per job gives over (under) billing, job by job and in total.
- **Outputs:** recognized month to date, this month and next month forecast, sold revenue not yet recognized, a monthly chart on the Revenue tab and the board view, and a revenue line in the Monday digest.

## Added after the v1 demo

| Change | Why |
| --- | --- |
| Utilization against a 50-man working target, full roster shown beside it | Roster-based utilization understates and invites a denominator argument |
| Actuals imported from the time system or a CSV, exceptions flagged for review | Removes retyping; answers the CFO’s duplicate-data objection |
| Forecast accuracy measured against the forecast made 4 weeks earlier | Same-week accuracy is nearly guaranteed to look good |
| Named crew assignments by week, with double-booking, time-off, qualification, medical-card and short-crew checks; supt confirms crews weekly | Leaders are the binding constraint; conflicts surface before Monday |
| Verbal status: shown, not counted until scheduled | Real awards visible without inflating sold totals |
| Qualifications per person (confined space, lift, fiberglass) required by job type | Matches people to work; source is HR or safety training records |
| Backlog in dollars beside weeks | Board thinks in revenue, ops in weeks |
| Exterior jobs flagged in winter weeks (Dec 1 to Mar 15) | Winter capacity is not usable for exterior work |

## Field view

Every crew member gets a "My week" phone screen: job, days, start time, site address with a map link, leader’s phone, site contact, orientation or badging, PPE and permits, and who else is on the crew, for this week and next. A Got it button records that they saw it.

- **DOT physicals:** tracked only for drivers, as an expiration date with no medical detail. A lapsed card blocks assignment and flags the schedule.
- **Certifications:** each qualification carries an expiration date the scheduler maintains. Texts go to the person, copied to the scheduler, at 60 and 30 days and on expiry.
- **Site details:** entered once at intake from the estimate (address, start time, contact, orientation, PPE).
- **Open decision:** field login method. 60+ crew members likely lack Microsoft accounts, so a text-message link or phone-number sign-in is the practical route; IT needs to weigh in.

## Build plan, stack, cost

Four phases, each with a gate Austin signs off before the next starts. Built through Claude Code, same path as the chores board.

1. **Foundation (weeks 1–2)** — database, Microsoft 365 login, import of the current 2026 Schedule and Crew List, Schedule grid and Crew screens. Gate: Austin can see today's schedule in the app and it matches the workbook.
2. **Weekly close (weeks 3–4)** — Weekly close screen, Job page, Event log, computed hours left and capacity. Gate: the scheduler runs two Friday closes in parallel with the workbook; numbers match.
3. **Forecast and alerts (weeks 5–6)** — Dashboard, run-rate check, five notification rules, Monday digest to Teams. Gate: leadership receives two digests; workbook retired.
4. **Board view (weeks 7–8)** — four metrics trended, export to PDF for the board deck. Gate: first quarterly board view produced.

Stack: Netlify hosting and scheduled functions, Supabase (hosted Postgres) for data, Microsoft login, Teams incoming webhook plus a transactional email service. Running cost under $50 a month at TMI's size. Estimated vs. actual data is kept forever; nothing is overwritten.

Risk: Friday discipline from the scheduler. Mitigation is the digest naming missing entries, and a four-week parallel run so the old workbook is the backup until trust is earned.

## Phase two: work order drafts and finalization

A sold job goes on the schedule as booked right away. The work order runs alongside it with its own status: draft, in review, final. It never holds the job off the board.

1. Lori enters the sold job from the estimate, with a required estimator field.
2. Lori drafts the work order separately in Claude from the estimate and proposal/contract, using one fixed TMI template.
3. She uploads the draft to the job in TMI Ops. The assigned estimator gets a Teams alert to review it.
4. Sign-offs in order: estimator (hours, scope), salesperson (contract terms), PM (execution plan), scheduler (crew, dates). Each is logged.
5. Review deadline: if a step sits past two days, the PM is pinged.

**Kept separate on purpose:** AI drafting happens outside TMI Ops and feeds in a draft, so the app itself has no AI connection to TMI data. Fuller AI drafting from square one can come later.

**Settled:** Claude use is approved under TMI's business account, which Austin administers. The final work order of record lives in Procore; TMI Ops shows a copy on the job so anyone working in the schedule can reach it.

## Open decisions for Austin

- [ ] Who is the scheduler that owns the Friday close, and does Derrick agree it sits in their seat?
- [ ] Absence rate to start the capacity calc (proposed 10%) and hours per man-week (proposed 40)
- [ ] Large-job threshold for leader load (proposed: any job over 400 projected hrs needs a dedicated leader)
- [ ] Overrun threshold for the alert (proposed 15% in one week)
- [ ] Which Teams channel gets the alerts, and whether supts get Teams or text
- [ ] Go-live target date and which board meeting gets the first board view
- [ ] Burdened labor cost per hour for the WIP margin (demo uses $55)
- [ ] Contract split between materials and labor: from the estimate, or entered by the PM at award
- [ ] How change orders are entered so contract value and hours stay current (the largest source of false margin fade)
