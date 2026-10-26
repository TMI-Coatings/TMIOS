# TMI Ops: Procore Integration and Security Brief

Oct 20, 2026 · @Austin Lewis

## How it fits

Procore stays TMI's system of record for daily reports, photos, job costing and the Sage integration. TMI Ops adds what Procore doesn't cover: crew scheduling, forecasting, WIP and a near-real-time board view. It reads from Procore, so nothing is entered twice.

&#91;embedded content: how the systems fit · 4 steps\]

Better schedule data gives accounting a forecast it can trust, which builds board and investor confidence.

## Procore connection

TMI Ops connects to Procore **read-only**. It pulls job data and never writes back, so it cannot change job costing, budgets or anything that flows to Sage.

**What it reads:** projects and job numbers, budgets and job cost, approved change orders, timecards and hours.

**Steps with TMI's Procore admin:**

1. Register the app in Procore's developer portal under TMI's company account. This creates a client ID and secret, the app's own credentials.
2. Install the app in Procore's company App Management with a read-only permission template, limited to the data above.
3. Store the client ID and secret on the server (hosting environment variables), never in the web page or in code.
4. Test against one closed job, then turn on live updates so changes in Procore show in TMI Ops within minutes.

Procore renames its developer tools from time to time; the admin should follow Procore's current setup guide.

## Sign-in: TMI Microsoft single sign-on

Everyone signs in with their existing TMI Microsoft 365 account. No separate passwords, and a link alone gets nobody in.

**Sign-in only, no data access.** Microsoft only confirms who the person is and returns their name and email (the basic openid, profile and email permissions). TMI Ops gets no access to Outlook, OneDrive, SharePoint, Teams files or any other Microsoft 365 data, and no AI tool is connected to TMI's Microsoft account. Veracity can check the exact permissions requested when they register the app.

1. Veracity registers TMI Ops as an app in TMI's Microsoft 365 (Entra ID) and limits it to TMI accounts.
2. Existing Microsoft protections apply automatically, including multi-factor sign-in.
3. When someone leaves, IT turns off their Microsoft account and their access to TMI Ops ends at the same moment.
4. Inside the app, each person has a role that controls what they see: admin, scheduler, job setup (Lori), estimator, PM, CFO/finance, superintendent, sales rep (own jobs only), field crew (own week only), board (summary only).

**Open question:** field crew without TMI email accounts. Options are a TMI account per leader or a one-time code by text. To decide with HR and Veracity.

## Precautions built in from the start

| Risk | Precaution |
| --- | --- |
| Someone gets the link | Microsoft sign-in required on every page and every data request |
| A user sees more than their role | Row-level security in the database: each request returns only what that person's role allows |
| TMI Ops changes Procore or Sage | Read-only Procore permissions; no connection to Sage at all |
| Credentials leak | Procore and database keys kept server-side, never in the browser or code |
| Numbers don't match accounting | Job cost comes from Procore/Sage, not re-entered; WIP checked against Sage at month end |
| Who changed what | Every change logged with name and time |
| Lost data or vendor change | Daily backups; code and data held in TMI-owned accounts; data exportable anytime |
| Single point of failure (Austin) | A named backup owner; code documented in a company account |
| Real data in the demo | Demo uses sample data only until security is approved |

Veracity reviews and approves these before the build starts, not after.

## Cost and approvals

**Running cost:** about $45 a month (website hosting about $19, database with backups about $25; approximate, to confirm). Microsoft sign-in and Teams alerts use TMI's existing Microsoft 365 at no added cost. Not included: Veracity's review time and build/maintenance time.

**Approval path:**

1. Jared (CFO) approves the demo and the scope: Procore for dailies, photos, job costing and Sage; TMI Ops for crew scheduling, forecasting, WIP and the board view.
2. Short call with Veracity to get their security requirements before any build.
3. Procore admin sets up the read-only app connection.
4. Build in four two-week phases, with Veracity requirements built in.
5. Run alongside the current schedule for one month, checking WIP against Sage, then switch over.
