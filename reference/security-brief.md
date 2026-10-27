# TMI Ops: Procore Integration and Security Brief

Updated Oct 27, 2026 · @Austin Lewis (first issued Oct 20)

## How it fits

Procore stays TMI's system of record for daily reports, photos, job costing and the Sage integration. TMI Ops adds what Procore doesn't cover: crew scheduling, forecasting, WIP, billing follow-up and a near-real-time board view. It reads from Procore, so nothing is entered twice.

&#91;embedded content: how the systems fit · 4 steps\]

Better schedule data gives accounting a forecast it can trust, which builds board and investor confidence.

## Where things stand

- **Built so far:** every screen in the original demo, plus the changes in "What changed since Oct 20" below. It runs only on invented sample data.
- **The demo site** shows real TMI staff names and roles. Its jobs, customers, hours and dollars are all invented.
- **Not built until Veracity approves:**
  - live Microsoft sign-in
  - the database holding real TMI data
  - the Procore connection
  - Teams and email delivery of alerts
  - the time-system import

## Procore connection

TMI Ops connects to Procore **read-only**. It pulls job data and never writes back, so it cannot change job costing, budgets or anything that flows to Sage.

**What it reads:** projects and job numbers, budgets and job cost, approved change orders, timecards and hours.

**Steps with TMI's Procore admin:**

1. Register the app in Procore's developer portal under TMI's company account. This creates a client ID and secret, the app's own credentials.
2. Install the app in Procore's company App Management with a read-only permission template, limited to the data above.
3. Store the client ID and secret on the server (hosting environment variables), never in the web page or in code.
4. Test against one closed job, then turn on live updates so changes in Procore show in TMI Ops within minutes.

Procore renames its developer tools from time to time; the admin should follow Procore's current setup guide. Until Procore is connected, hours come in by a CSV export from the time system, and change orders are typed in by hand.

## Sign-in: TMI Microsoft single sign-on

Everyone signs in with their existing TMI Microsoft 365 account. No separate passwords, and a link alone gets nobody in.

**Sign-in only, no data access.** Microsoft only confirms who the person is and returns their name and email (the basic openid, profile and email permissions). TMI Ops gets no access to Outlook, OneDrive, SharePoint, Teams files or any other Microsoft 365 data, and no AI tool is connected to TMI's Microsoft account. Veracity can check the exact permissions requested when they register the app.

1. Veracity registers TMI Ops as a single-tenant app in TMI's Microsoft 365 (Entra ID), limited to TMI accounts.
2. Existing Microsoft protections apply automatically, including multi-factor sign-in.
3. **Access list.** Only emails an admin has added on the Access screen get in. When someone leaves, IT turns off their Microsoft account and an admin turns off their access in TMI Ops. That stops their data on the next request. Do both, because a session that's already open can keep refreshing until it's turned off in TMI Ops.
4. **No self-lockout.** Nobody can change or turn off their own access, and the last person with full rights can't be removed.
5. **Field crew.** In Phase 1 only crew leaders sign in, each with a TMI Microsoft account. Regular crew don't sign in. Texting or one-time codes come later, with their own review.

## Who sees what

Each person has one role. **The database enforces every rule below, not just the screen.**

| Role | Who | Sees | Can change |
| --- | --- | --- | --- |
| Admin, CEO, CFO (full rights) | Austin Lewis, Jason Jelinek, Al Trenary (admin); Derrick Gordon (CEO); Jared Wiese (CFO) | Everything | Everything, including access and settings |
| Scheduler | Nicole | All jobs and money | Dates, plan hours, job leader, crew size, projected hours, crews, status; closes the week |
| Job setup | Lori | All jobs and money | Adds jobs, corrects intake details, change orders, work order drafts |
| Project manager | Jake Moen, Scott Salmon, Lucas Kemmerer | All jobs and money | Their own jobs: dates, hours, percent complete, change orders, milestones |
| Sales rep | Seven reps | All jobs and money; capacity dashboard | Firmness and work order sign-off on their own jobs |
| Estimator | Five estimators (Scott Salmon also estimates) | All jobs, **hours only** | Work order sign-off on jobs where they are the estimator |
| Accounting | Patrick Leaon | All jobs and money | Invoices, payments received, retainage, month-end WIP |
| Job leader | Leaders on the roster | **Their own jobs, hours only** | Their crews and finish dates; "Got it" on their week |

Notes on these rules:
- **Hours only** means the database won't return contract value, cost or margin to these people. It also hides dollar entries in the change log from them.
- **Work order drafts** open only for office roles and estimators, through short-lived links. Job leaders and crew can't open them.
- **Board:** there is no board login. Admin, the CEO or the CFO exports a PDF board pack.

## Precautions built in from the start

| Risk | Precaution |
| --- | --- |
| Someone gets the link | Microsoft sign-in required on every page and every data request; only emails on the access list get in |
| A user sees more than their role | Row-level security in the database on every table. About 100 automated tests check each role's access against the database on every change. |
| Dollar figures reach the field | The database withholds contract value, cost and margin from leaders, crew and estimators |
| TMI Ops changes Procore or Sage | Read-only Procore permissions; no connection to Sage at all. Accounting marks payments received by hand. |
| Credentials leak | Procore and database keys kept server-side, never in the browser or code |
| Work order files exposed | Private file storage guarded by the same access rules, opened only through short-lived links |
| Numbers don't match accounting | Job cost comes from Procore/Sage, not re-entered. Month-end WIP is locked in the database, can't be changed afterwards, and is checked against Sage. |
| Who changed what | Every change to a job, crew, hours, status, firmness, work order, journey checkpoint, invoice or payment is logged with name, time, old value and new value |
| Records deleted | Nothing with history is ever deleted; it's marked inactive |
| The demo setting reaches the live site | A production build in demo mode fails unless it's explicitly allowed. The allowance is removed at go-live. |
| Alerts reach the wrong person | No two people on the access list or the roster can share a name. Only Microsoft sign-ins link to the access list. |
| Bad settings break the numbers | Every threshold has limits that the database enforces |
| Lost data or vendor change | Daily backups; code and data held in TMI-owned accounts; data exportable anytime (including a WIP spreadsheet export) |
| Single point of failure (Austin) | Al Trenary is the named backup admin; code and decisions documented in the TMI-owned repository |
| Real data in the demo | The demo uses invented jobs and dollars only until security is approved. It shows real staff names and roles, so the demo site is password-protected (Netlify, since Oct 27). |

**What TMI Ops will hold:**
- **Staff and crew:** names, roles, phone numbers, DOT physical and certification expiry dates, time off.
- **Jobs:** customers, contract values and estimates, schedules and hours, notes and work order files.
- **Money:** invoices, payments received, retainage.
- **Records:** the change log.

**What it won't hold:** no Social Security numbers, pay rates or bank details.

Veracity reviews and approves these before real data goes in, not after.

## Cost and approvals

**Running cost:** roughly $45–$65 a month. That's Netlify Pro website hosting (already paid) plus a database with backups at about $25. These figures are approximate and still to confirm. Microsoft sign-in and Teams alerts use TMI's existing Microsoft 365 at no added cost.

Not included:
- Veracity's review time
- build and maintenance time
- an independent security review, if TMI orders one

**Approval path:**

1. ✅ Jared (CFO) approves the demo and the scope: Procore for dailies, photos, job costing and Sage; TMI Ops for crew scheduling, forecasting, WIP, billing follow-up and the board view.
2. **Next:** Veracity reviews this brief and sets their requirements.
3. Veracity registers the Microsoft sign-in app; TMI sets up a development database in a TMI-owned account; the live version is tested end to end there.
4. Procore admin sets up the read-only app connection.
5. Run alongside the current schedule workbook for one month, checking WIP against Sage, then switch over.

## What changed since Oct 20

- **Visibility:** sales reps and PMs see every job, including dollars, because reps share customers across territories. They still change only their own jobs.
- **Hours only:** job leaders, crew and estimators no longer see any dollar figures.
- **New finance features:**
  - payments received, entered by hand, and how long invoices have been outstanding
  - retainage held on each invoice, with part payments
  - month-end WIP locked for the books
  - a WIP spreadsheet export
  - a financial section in the board pack
- **New reminders:**
  - the scheduler can nudge PMs who haven't entered hours
  - anyone can send a "Remind" on a stuck work order
  - if Monday's digest fails to send after the close, the app catches it
- **More checks on entries:** settings have enforced limits, change orders need an approver, and invoices can't exceed what's left on the contract.
