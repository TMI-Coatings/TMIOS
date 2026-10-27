/**
 * Sample data, generated the same way as the v15 demo (reference/TMI-Ops-Demo.html) so the
 * screens can be checked against it. Every name, number and job here is invented.
 * Used by sample mode in the browser and by scripts/make-seed-sql.ts for a dev database.
 * Never load real TMI data (hard rule 1).
 */
import type {
  ForecastSnapshot,
  WeekClose,
  WeeklyMetric,
  ActualHours,
  Assignment,
  Dataset,
  IsoDate,
  Job,
  JobNote,
  Lookup,
  Person,
  Role,
  TimeOff,
  TimeOffType,
  Viewer,
} from "../domain/types";
import { DEFAULT_SETTINGS } from "../domain/types";
import { allPlans, buildIndex, materialRevenueCents } from "../domain/schedule";
import { DEFAULT_CHECKPOINTS, DEFAULT_STAGES, type JobCheckpoint } from "../domain/journey";
import { WO_STEPS, type WorkOrder } from "../domain/workOrders";
import type { Outcome } from "../domain/scorecard";
import { MILESTONE_TEMPLATE, type Invoice, type Milestone, type PercentEntry, type RetainageReceipt } from "../domain/money";
import { addDays, mondayOf, weekEnding as weekEndingOf } from "../domain/weeks";

/** The demo was built around this week. Sample dates shift so this week lines up with the base week. */
const DEMO_WEEK = "2026-10-16";

function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable UUIDs so the browser sample and the SQL seed agree. */
export const sampleId = (kind: number, n: number) =>
  `00000000-0000-4000-8${kind.toString(16).padStart(3, "0")}-${n.toString(16).padStart(12, "0")}`;
const K = { person: 1, job: 2, timeoff: 3, assign: 4, note: 5, user: 6 };

export const QUALIFICATIONS = ["Confined space", "Lift", "Fiberglass"];

export const REPS: Lookup[] = [
  { code: "ER", name: "Eric Rich" },
  { code: "EM", name: "Ethan Miller" },
  { code: "KK", name: "Keith Kubitschek" },
  { code: "PK", name: "Phil Kick" },
  { code: "GD", name: "Gretchen Davies" },
  { code: "BE", name: "Brent Elwood" },
  { code: "CM", name: "Chris Monyhan" },
];
// The demo's jobs for AL and SCS go to reps on the current list.
const RMAP: Record<string, string> = { AL: "KK", SCS: "EM" };

export const PMS: Lookup[] = [
  { code: "JM", name: "Jake Moen" },
  // Scott Salmon is an estimator and Lucas Kemmerer is the purchaser; both work with PM rights (Austin, Oct 26).
  { code: "SS", name: "Scott Salmon" },
  { code: "LK", name: "Lucas Kemmerer" },
];

const ESTIMATORS = ["Stephen Bazant", "Juac Angoi", "Sarah Louvar", "Colicia Barnes", "Jordan Strand"];

const LEADERS = ["Mike Ramirez", "Tony Becker", "Jake Lund", "Dave Olson", "Luis Ortega", "Brandon Kurth", "Sam Nguyen", "Ray Thompson", "Kevin Jensen", "Marco Silva", "Pete Larson", "Darnell Hayes", "Ben Schultz", "Travis Moe"];
const FIRST = ["Alex", "Jordan", "Tyler", "Cody", "Eric", "Nate", "Logan", "Dylan", "Josh", "Matt", "Ryan", "Zach", "Adam", "Carlos", "Jesse", "Derek", "Shane", "Trent", "Hector", "Andre", "Wes", "Colton", "Isaac", "Mason", "Owen", "Garrett", "Juan", "Victor", "Seth", "Caleb", "Riley"];
const LAST = ["Anderson", "Johnson", "Peterson", "Nelson", "Hanson", "Larson", "Swanson", "Carlson", "Erickson", "Olson", "Miller", "Schmidt", "Weber", "Becker", "Hoffman", "Lopez", "Garcia", "Kowalski", "Novak", "Lindgren", "Berg", "Dahl", "Holm", "Stark", "Vogel", "Krause", "Moreno", "Ruiz", "Thao", "Vang", "Yang"];

const CS = ["Confined space"];
const LF = ["Lift"];
type Spec = { c: string; t: string; l: string; o: number; w: number; cr: number; rep: string; pm: string; s: string; f?: number; x?: 1; q?: string[] };
const SPEC: Spec[] = [
  { c: "North Prairie Dairy", t: "Floor system", l: "Lake Norden, SD", o: -2, w: 4, cr: 6, rep: "GD", pm: "JM", s: "Mike Ramirez" },
  { c: "Riverbend Ethanol", t: "Tank lining", l: "Bingham Lake, MN", o: -1, w: 5, cr: 8, rep: "PK", pm: "JM", s: "Tony Becker", f: 1.32, q: CS },
  { c: "Twin Cities Metro Water", t: "Water tower", l: "Woodbury, MN", o: -3, w: 6, cr: 5, rep: "ER", pm: "SS", s: "Jake Lund", x: 1, q: LF },
  { c: "Granite Falls Grain", t: "Structural steel", l: "Granite Falls, MN", o: 0, w: 3, cr: 4, rep: "CM", pm: "SS", s: "Dave Olson", x: 1, q: LF },
  { c: "Lakeside Foods", t: "Floor system", l: "Owatonna, MN", o: 0, w: 2, cr: 6, rep: "BE", pm: "JM", s: "Luis Ortega" },
  { c: "Cedar Valley Power", t: "Stack coating", l: "Waterloo, IA", o: -1, w: 6, cr: 4, rep: "AL", pm: "LK", s: "Brandon Kurth", f: 1.24, x: 1, q: LF },
  { c: "St. Croix Paper", t: "Secondary containment", l: "Hudson, WI", o: 1, w: 3, cr: 5, rep: "KK", pm: "LK", s: "Sam Nguyen", q: CS },
  { c: "Red Wing Malting", t: "Interior painting", l: "Red Wing, MN", o: 1, w: 2, cr: 3, rep: "EM", pm: "SS", s: "Ray Thompson" },
  { c: "Mesabi Aggregates", t: "Structural steel", l: "Virginia, MN", o: 2, w: 5, cr: 6, rep: "SCS", pm: "LK", s: "Kevin Jensen", x: 1, q: LF },
  { c: "Prairie Pork Processing", t: "Floor system", l: "Worthington, MN", o: 2, w: 3, cr: 8, rep: "GD", pm: "JM", s: "Marco Silva" },
  { c: "Heartland Fiberglass", t: "Tank lining", l: "Mankato, MN", o: 3, w: 4, cr: 5, rep: "PK", pm: "SS", s: "Pete Larson", q: ["Confined space", "Fiberglass"] },
  { c: "City of Owatonna", t: "Water tower", l: "Owatonna, MN", o: 3, w: 4, cr: 4, rep: "ER", pm: "LK", s: "Darnell Hayes", x: 1, q: LF },
  { c: "Bluff Country Creamery", t: "Floor system", l: "Rochester, MN", o: 3, w: 2, cr: 6, rep: "CM", pm: "JM", s: "Mike Ramirez" },
  { c: "Minnesota Valley Ag", t: "Secondary containment", l: "New Ulm, MN", o: 4, w: 3, cr: 6, rep: "BE", pm: "SS", s: "Ben Schultz", q: CS },
  { c: "Iron Range Mining", t: "Structural steel", l: "Hibbing, MN", o: 4, w: 6, cr: 8, rep: "AL", pm: "LK", s: "Travis Moe", x: 1, q: LF },
  { c: "Two Rivers Hospital", t: "Interior painting", l: "Mankato, MN", o: 4, w: 3, cr: 4, rep: "KK", pm: "JM", s: "Jake Lund" },
  { c: "Kasota Stone", t: "Concrete repair", l: "Kasota, MN", o: 4, w: 2, cr: 3, rep: "EM", pm: "SS", s: "Darnell Hayes" },
  { c: "Northern Plains Wind", t: "Structural steel", l: "Lake Benton, MN", o: 4, w: 3, cr: 5, rep: "SCS", pm: "LK", s: "Luis Ortega", x: 1, q: LF },
  { c: "Riverbend Ethanol", t: "Tank lining, phase 2", l: "Bingham Lake, MN", o: 9, w: 4, cr: 6, rep: "PK", pm: "JM", s: "Tony Becker", q: CS },
  { c: "Lakeside Foods", t: "Floor system", l: "Cokato, MN", o: 10, w: 2, cr: 5, rep: "BE", pm: "JM", s: "Sam Nguyen" },
];
const FIRM = ["confirmed", "locked", "confirmed", "confirmed", "flexible", "confirmed", "confirmed", "fill_in", "confirmed", "locked", "best_guess", "locked", "confirmed", "best_guess", "flexible", "flexible", "fill_in", "confirmed", "waiting", "best_guess"] as const;

function ppeFor(t: string) {
  if (/lining/i.test(t)) return "Supplied-air respirator, Tyvek, confined-space permit";
  if (/containment/i.test(t)) return "Respirator, chemical gloves, Tyvek";
  if (/Floor/i.test(t)) return "Half-face respirator, knee pads, steel toes";
  if (/tower|stack|steel|conveyor/i.test(t)) return "Full harness and lanyard, hard hat, safety glasses";
  return "Hard hat, safety glasses, steel toes";
}

export interface SampleData extends Dataset {
  users: (Viewer & { active: boolean })[];
  snapshots: ForecastSnapshot[];
}

/** Build the sample dataset with the demo's week lined up to `baseWeek` (a Friday). */
export function buildSample(baseWeek: IsoDate, today: IsoDate = mondayOf(baseWeek)): SampleData {
  const shift = (s: IsoDate) => addDays(s, Math.round((Date.parse(baseWeek) - Date.parse(DEMO_WEEK)) / 86_400_000));
  const START = baseWeek;
  /** Calendar-bound sample dates (deer season, holidays) stay on their dates, in the coming year. */
  const cal = (demoDate: IsoDate) => {
    let d = baseWeek.slice(0, 4) + demoDate.slice(4);
    if (d < addDays(baseWeek, -30)) d = String(Number(d.slice(0, 4)) + 1) + d.slice(4);
    return d;
  };
  const r = rng(42);
  const rd = () => shift(addDays("2026-10-20", Math.floor(r() * 430)));

  const people: Person[] = [];
  let pn = 1;
  const quals = (pc: number, pl: number, pf: number) => {
    const a: string[] = [];
    if (r() < pc) a.push("Confined space");
    if (r() < pl) a.push("Lift");
    if (r() < pf) a.push("Fiberglass");
    return a;
  };
  const qexp = (qs: string[]) => Object.fromEntries(qs.map((q) => [q, shift(addDays("2027-01-15", Math.floor(r() * 560)))]));
  LEADERS.forEach((name, i) => {
    const qs = QUALIFICATIONS.slice();
    const med = shift(addDays("2027-02-01", Math.floor(r() * 300)));
    people.push({
      id: sampleId(K.person, pn++),
      name,
      kind: "leader",
      state: i % 5 === 3 ? "WI" : i % 7 === 2 ? "IA" : "MN",
      phone: "612-555-02" + String(10 + i).padStart(2, "0"),
      driver: true,
      dotExpires: med,
      active: true,
      quals: qexp(qs),
    });
  });
  const used = new Set(LEADERS);
  while (people.length < 75) {
    const name = FIRST[Math.floor(r() * FIRST.length)] + " " + LAST[Math.floor(r() * LAST.length)];
    if (used.has(name)) continue;
    used.add(name);
    const qs = quals(0.55, 0.6, 0.25);
    const state = ["MN", "MN", "MN", "MN", "WI", "IA", "SD"][Math.floor(r() * 7)];
    const driver = r() < 0.3;
    const med = rd();
    people.push({
      id: sampleId(K.person, pn++),
      name,
      kind: "field",
      state,
      phone: "612-555-" + String(3000 + pn),
      driver,
      dotExpires: driver ? med : null,
      active: true,
      quals: qexp(qs),
    });
  }

  const pick = <T,>(arr: T[], k: number) => {
    const c = arr.slice();
    const o: T[] = [];
    while (o.length < k && c.length) o.push(c.splice(Math.floor(r() * c.length), 1)[0]);
    return o;
  };
  const L = people.filter((p) => p.kind === "leader");
  const F = people.filter((p) => p.kind === "field");
  const timeOff: TimeOff[] = [];
  let tn = 1;
  const off = (p: Person, a: IsoDate, b: IsoDate, type: TimeOffType) =>
    timeOff.push({ id: sampleId(K.timeoff, tn++), personId: p.id, firstDay: a, lastDay: b, type, active: true });
  pick(L.slice(1), 5)
    .concat(pick(F, 11))
    .forEach((p) => off(p, cal("2026-11-09"), cal("2026-11-13"), "Hunting"));
  pick(F, 10).forEach((p) => off(p, cal("2026-11-25"), cal("2026-11-27"), "Holiday"));
  pick(people.slice(1), 30).forEach((p) => {
    const a = cal("2026-12-21");
    off(p, a, addDays(a, 11), "Holiday");
  });
  pick(F, 6).forEach((p) => {
    const s = shift(addDays("2026-10-19", 7 * Math.floor(r() * 6)));
    off(p, s, addDays(s, 2), "PTO");
  });

  const leaderId = (name: string) => people.find((p) => p.name === name)!.id;
  const actuals: ActualHours[] = [];
  const jobs: Job[] = SPEC.map((s, i) => {
    const we0 = addDays(START, 7 * s.o);
    const start = mondayOf(we0);
    const finish = addDays(we0, 7 * (s.w - 1));
    const proj = Math.round((s.cr * 40 * s.w * 0.9) / 10) * 10;
    const est = i === 2 ? Math.round((proj * 0.82) / 10) * 10 : i === 9 ? Math.round((proj * 1.05) / 10) * 10 : proj;
    const id = sampleId(K.job, i + 1);
    for (let k = 0; k < s.w; k++) {
      const w = addDays(we0, 7 * k);
      if (w < START) actuals.push({ jobId: id, week: w, hours: Math.round((proj / s.w) * (s.f || 1) * (0.93 + r() * 0.14)) });
    }
    const value = Math.round((proj * (112 + r() * 38)) / 500) * 500;
    const mshare = /lining|Floor|containment/i.test(s.t) ? 0.4 : /painting/i.test(s.t) ? 0.2 : 0.3;
    const matCost = Math.round((value * mshare * 0.55) / 100) * 100;
    const muni = /^City of|County|Metro Water/.test(s.c);
    const contractCents = value * 100;
    const materialCostCents = matCost * 100;
    return {
      id,
      number: String(4112 + i * 7),
      customer: s.c,
      jobType: s.t,
      location: s.l,
      repCode: RMAP[s.rep] ?? s.rep,
      pmCode: s.pm,
      estimator: ESTIMATORS[i % ESTIMATORS.length],
      leaderId: leaderId(s.s),
      crewSize: s.cr,
      estimateHrs: est,
      projectedHrs: proj,
      contractCents,
      materialCostCents,
      materialRevenueCents: materialRevenueCents(contractCents, materialCostCents, est, DEFAULT_SETTINGS.burdenedRateCents),
      start,
      projectedFinish: finish,
      baselineFinish: finish,
      mustFinish: i === 11 ? addDays(finish, -7) : i === 1 || i === 9 ? finish : null,
      mustFinishReason: i === 11 ? "contract" : i === 1 || i === 9 ? "shutdown" : null,
      actualFinish: null,
      status: start <= START ? "active" : "scheduled",
      firmness: FIRM[i],
      waitsOnJobId: i === 18 ? sampleId(K.job, 2) : null,
      firmnessReason: null,
      holdReason: i === 19 ? "Customer is reworking the floor layout" : null,
      holdUntil: i === 19 ? shift("2027-01-11") : null,
      exterior: !!s.x,
      billingMethod: i === 1 || i === 14 ? "milestone" : i === 0 || i === 2 || i === 11 ? "monthly" : "final",
      retainagePct: muni ? 5 : 0,
      retainageRelease: muni ? "final_completion" : null,
      retainageReleaseNote: null,
      customerPo: "PO " + (48000 + 4112 + i * 7),
      billTo: "Accounts payable, " + s.c,
      lienWaivers: value >= 100000,
      certifiedPayroll: muni,
      requirements: s.q ?? [],
      siteAddress: `${100 + i * 37} ${["Industrial", "Commerce", "Mill", "Plant", "Elevator", "Water"][i % 6]} ${["Dr", "Rd", "St", "Ave"][i % 4]}, ${s.l}`,
      siteStartTime: i % 3 === 2 ? "7:00 AM" : "6:30 AM",
      siteContact: ["Gary Holm", "Lisa Ortiz", "Dan Berg", "Rachel Kim"][i % 4] + ", 507-555-01" + String(10 + i).padStart(2, "0"),
      siteOrientation: i % 3 === 0 ? "Site orientation, 1 hr, first morning" : i % 3 === 1 ? "Badge pickup at the guard shack" : "None",
      sitePpe: ppeFor(s.t),
      active: true,
    };
  });
  jobs[19].status = "on_hold";

  let nn = 1;
  const notes: JobNote[] = [];
  const N = (k: number, text: string, author: string, daysAgo: number, pinned: boolean, crewVisible: boolean) =>
    notes.push({ id: sampleId(K.note, nn++), jobId: jobs[k].id, text, pinned, crewVisible, author, createdAt: addDays(START, -daysAgo) + "T14:00:00Z" });
  N(1, "Plant shutdown the first week of November. No hot work without a plant permit; the plant supplies the confined-space attendant.", "Austin Lewis", 11, true, true);
  N(11, "Contract carries liquidated damages of $500 a day after the must-finish date. Talk recovery plan before adding crew.", "Austin Lewis", 8, true, false);
  N(0, "Gate code 4412. Park on the north side, not by the loading dock.", "Mike Ramirez", 4, false, true);
  N(5, "Customer’s engineer wants a photo update every Friday.", "Nicole", 7, false, false);

  // Crew assignments for the next 16 weeks, the way the demo seeds them: leader first, then last week's crew, then qualified people.
  const assignments: Assignment[] = [];
  let an = 1;
  const offFrac = (p: Person, w: IsoDate) => {
    const m = mondayOf(w);
    let d = 0;
    for (let i = 0; i < 5; i++) {
      const day = addDays(m, i);
      if (timeOff.some((t) => t.personId === p.id && t.firstDay <= day && t.lastDay >= day)) d++;
    }
    return d / 5;
  };
  const byWeek = new Map<string, string[]>();
  for (let wi = 0; wi < 16; wi++) {
    const w = addDays(START, 7 * wi);
    const live = jobs.filter((j) => j.status !== "complete" && j.start <= w && j.projectedFinish >= mondayOf(w)).sort((a, b) => (a.start < b.start ? -1 : 1));
    const busy = new Set<string>();
    for (const j of live) {
      const cur: string[] = [];
      if (j.leaderId && !busy.has(j.leaderId)) cur.push(j.leaderId);
      const prev = byWeek.get(j.id + "|" + addDays(w, -7)) ?? [];
      const ok = (p: Person) => j.requirements.every((q) => q in p.quals);
      const cands = people.filter(
        (p) => p.active && p.kind === "field" && !busy.has(p.id) && !cur.includes(p.id) && offFrac(p, w) === 0 && (!p.driver || (p.dotExpires ?? "") >= w),
      );
      cands.sort((a, b) => (prev.includes(b.id) ? 4 : 0) + (ok(b) ? 2 : 0) - ((prev.includes(a.id) ? 4 : 0) + (ok(a) ? 2 : 0)) || (a.id < b.id ? -1 : 1));
      cands.slice(0, Math.max(0, j.crewSize - cur.length)).forEach((p) => cur.push(p.id));
      cur.forEach((pid) => {
        busy.add(pid);
        assignments.push({ id: sampleId(K.assign, an++), jobId: j.id, personId: pid, week: w });
      });
      byWeek.set(j.id + "|" + w, cur);
    }
  }

  const users: SampleData["users"] = [];
  let un = 1;
  const U = (name: string, role: Role, extra: Partial<Viewer> = {}) =>
    users.push({
      userId: sampleId(K.user, un++),
      name,
      email: name.toLowerCase().replace(/[^a-z]+/g, ".") + "@example.com",
      role,
      personId: null,
      repCode: null,
      pmCode: null,
      active: true,
      ...extra,
    });
  // Full rights: Austin, Derrick, Jared, Jason, and Al as Austin's backup.
  U("Austin Lewis", "admin");
  U("Derrick Gordon", "ceo");
  U("Jared Wiese", "cfo");
  U("Jason Jelinek", "admin");
  U("Al Trenary", "admin");
  U("Nicole", "scheduler");
  U("Lori", "job_setup");
  ESTIMATORS.forEach((n) => U(n, "estimator"));
  PMS.forEach((p) => U(p.name, "pm", { pmCode: p.code }));
  // Leaders are still invented until the crew list comes in.
  U("Mike Ramirez", "superintendent", { personId: leaderId("Mike Ramirez") });
  REPS.forEach((r) => U(r.name, "sales_rep", { repCode: r.code }));
  U("Patrick Leaon", "accounting");

  // Ten closed weeks before this one, with the demo's illustrative board-metric history.
  const ILLUS = {
    util: [0.41, 0.43, 0.42, 0.45, 0.44, 0.47, 0.46, 0.49, 0.5, 0.52],
    roster: [0.27, 0.29, 0.28, 0.3, 0.29, 0.31, 0.31, 0.33, 0.33, 0.35],
    backlog: [3.1, 3.0, 3.4, 3.6, 3.5, 3.9, 4.1, 4.0, 4.4, 4.6],
    acc: [0.62, 0.66, 0.65, 0.7, 0.71, 0.73, 0.76, 0.78, 0.77, 0.81],
    ontime: [0.6, 0.62, 0.66, 0.65, 0.7, 0.74, 0.73, 0.78, 0.81, 0.84],
  };
  const closes: WeekClose[] = [];
  const metrics: WeeklyMetric[] = [];
  for (let i = 0; i < 10; i++) {
    const w = addDays(START, -7 * (10 - i));
    const rows = actuals.filter((a) => a.week === w);
    closes.push({ week: w, entered: rows.length, totalHrs: rows.reduce((a, r) => a + r.hours, 0), missingJobIds: [], completedJobIds: [] });
    metrics.push({
      week: w,
      utilization: ILLUS.util[i],
      utilizationRoster: ILLUS.roster[i],
      backlogWeeks: ILLUS.backlog[i],
      backlogCents: null,
      accuracy: ILLUS.acc[i],
      onTime: ILLUS.ontime[i],
      illustrative: true,
    });
  }
  // The forecast "made" four weeks before each of the next four weeks, with the demo's noise.
  const snapshots: ForecastSnapshot[] = [];
  {
    const r7 = rng(7);
    const ds0 = { jobs, people, timeOff, overrides: [], actuals, assignments, notes, settings: { ...DEFAULT_SETTINGS }, qualifications: QUALIFICATIONS, reps: REPS, pms: PMS, closes, hourEntries: [], confirmations: [], metrics, workOrders: [], stages: [], checkpointDefs: [], jobCheckpoints: [], staff: { schedulers: [], jobSetup: [], estimators: [] }, percents: [], changeOrders: [], milestones: [], invoices: [], retainageReceipts: [], outcomes: [] };
    const plans = allPlans(ds0, buildIndex(ds0), START);
    for (let i = 0; i < 4; i++) {
      const w = addDays(START, 7 * i);
      for (const j of jobs) {
        if (j.status === "on_hold") continue;
        const h = plans.get(j.id)?.get(w) ?? 0;
        if (h) snapshots.push({ madeWeek: addDays(w, -28), targetWeek: w, jobId: j.id, hours: Math.round(h * (0.82 + r7() * 0.36)) });
      }
    }
  }

  // Work orders as the demo seeds them: most final and filed, a few mid-review, one sent back, three awaiting drafts.
  const stamp = (d: IsoDate) => d + "T15:00:00Z";
  const ago = (n: number) => addDays(today, -n);
  const repName = (c: string) => REPS.find((r) => r.code === c)?.name ?? c;
  const pmName = (c: string) => PMS.find((r) => r.code === c)?.name ?? c;
  const who = (j: Job, k: number) => (k === 0 ? j.estimator : k === 1 ? repName(j.repCode) : k === 2 ? pmName(j.pmCode) : "Nicole");
  const workOrders: WorkOrder[] = jobs.map((j) => {
    const s0 = addDays(j.start, -12);
    return {
      jobId: j.id,
      version: 1,
      currentStep: 4,
      since: s0,
      final: true,
      filed: true,
      fileName: `WO-${j.number}-draft-v1.pdf`,
      filePath: null,
      returned: null,
      signoffs: WO_STEPS.map((_, k) => ({ step: k, by: who(j, k), at: stamp(s0) })),
      history: [
        { at: stamp(s0), who: "Lori", action: "Final filed in Procore as the work order of record.", note: "" },
        { at: stamp(s0), who: "Nicole", action: "Scheduler sign-off: crew and dates approved.", note: "" },
        { at: stamp(addDays(s0, -3)), who: "Lori", action: `Uploaded draft WO-${j.number}-draft-v1.pdf.`, note: "" },
      ],
    };
  });
  const mid = (i: number, cur: number, days: number, estimator?: string) => {
    const j = jobs[i];
    if (estimator) j.estimator = estimator;
    const at = (k: number) => stamp(ago(days + cur - 1 - k));
    workOrders[i] = {
      jobId: j.id,
      version: 1,
      currentStep: cur,
      since: ago(days),
      final: false,
      filed: false,
      fileName: `WO-${j.number}-draft-v1.pdf`,
      filePath: null,
      returned: null,
      signoffs: WO_STEPS.slice(0, cur).map((_, k) => ({ step: k, by: who(j, k), at: at(k) })),
      history: [
        ...WO_STEPS.slice(0, cur)
          .map((d, k) => ({ at: at(k), who: who(j, k), action: `${d.role} sign-off: ${d.what.toLowerCase()} approved.`, note: "" }))
          .reverse(),
        { at: stamp(ago(days + cur)), who: "Lori", action: `Uploaded draft WO-${j.number}-draft-v1.pdf.`, note: "" },
      ],
    };
  };
  mid(9, 3, 1); // Prairie Pork: waiting on the scheduler
  mid(11, 1, 1); // City of Owatonna: waiting on the rep
  mid(12, 2, 2); // Bluff Country: waiting on the PM
  mid(13, 0, 4, "Stephen Bazant"); // Minnesota Valley Ag: estimator, late
  mid(15, 0, 0, "Stephen Bazant"); // Two Rivers Hospital: draft just uploaded
  mid(16, 0, 1, "Juac Angoi"); // Kasota Stone
  {
    const j = jobs[14]; // Iron Range: sent back by the PM
    const comment = "Access plan doesn’t match the estimate. Scope calls for three boom lifts and the estimate carries two. Add the third lift and the extra mobilization before I sign.";
    workOrders[14] = {
      jobId: j.id,
      version: 1,
      currentStep: 0,
      since: ago(1),
      final: false,
      filed: false,
      fileName: `WO-${j.number}-draft-v1.pdf`,
      filePath: null,
      returned: { by: pmName(j.pmCode), role: "PM", comment, at: stamp(ago(1)) },
      signoffs: [],
      history: [
        { at: stamp(ago(1)), who: pmName(j.pmCode), action: "Sent back by the PM.", note: comment },
        { at: stamp(ago(2)), who: who(j, 1), action: "Sales rep sign-off: contract terms approved.", note: "" },
        { at: stamp(ago(3)), who: j.estimator, action: "Estimator sign-off: hours and scope approved.", note: "" },
        { at: stamp(ago(4)), who: "Lori", action: `Uploaded draft WO-${j.number}-draft-v1.pdf.`, note: "" },
      ],
    };
  }
  for (const [i, d] of [
    [17, 1],
    [18, 0],
    [19, 0],
  ]) {
    workOrders[i] = {
      jobId: jobs[i].id,
      version: 0,
      currentStep: 0,
      since: ago(d),
      final: false,
      filed: false,
      fileName: null,
      filePath: null,
      returned: null,
      signoffs: [],
      history: [{ at: stamp(ago(d)), who: "Lori", action: "Job booked on the schedule. Work order opened, awaiting a draft.", note: "" }],
    };
  }
  workOrders[8].filed = false; // Mesabi: final, not yet filed in Procore
  workOrders[8].history.shift();

  // Journey checkpoints ticked off, as the demo seeds them.
  const ownerWho = (j: Job, o: string) => ({ sales_rep: repName(j.repCode), job_setup: "Lori", pm: pmName(j.pmCode), scheduler: "Nicole", accounting: "Patrick Leaon" })[o] ?? o;
  const jobCheckpoints: JobCheckpoint[] = [];
  jobs.forEach((j, i) => {
    for (const c of DEFAULT_CHECKPOINTS) {
      if (c.autoSource || c.anchor === "finish") continue;
      const due = addDays(j.start, c.offsetDays);
      if (due <= addDays(START, 7) || (i * 5 + c.key.length) % 3 === 0)
        jobCheckpoints.push({ jobId: j.id, key: c.key, by: ownerWho(j, c.owner), at: stamp(due < START ? due : addDays(START, -3)) });
    }
  });
  const unset = (i: number, keys: string[]) => {
    for (const k of keys) {
      const n = jobCheckpoints.findIndex((c) => c.jobId === jobs[i].id && c.key === k);
      if (n >= 0) jobCheckpoints.splice(n, 1);
    }
  };
  unset(10, ["ord", "sub"]);
  unset(3, ["prejob"]);
  unset(11, ["coi"]);
  unset(9, ["safety"]);
  unset(13, ["po"]);

  // Percent complete from the Monday meetings, one entry per week with hours; the latest is this week's.
  const percents: PercentEntry[] = [];
  const r11 = rng(11);
  const round5 = (x: number) => Math.round(x * 20) * 5;
  jobs.forEach((j, i) => {
    const weeks = actuals.filter((a) => a.jobId === j.id).sort((a, b) => a.week.localeCompare(b.week));
    let cum = 0;
    weeks.forEach((a, k) => {
      cum += a.hours;
      let lab = round5(Math.min(0.95, cum / j.projectedHrs));
      const last = k === weeks.length - 1;
      if (last && i === 5) lab = 75;
      if (last && i === 1) lab = 30;
      const mat = Math.min(100, round5(lab / 100 + 0.35));
      percents.push({ jobId: j.id, week: last ? START : a.week, materialsPct: mat, laborPct: lab, enteredBy: pmName(j.pmCode) });
    });
  });
  const recognizedNow = (j: Job) => {
    const p = percents.filter((x) => x.jobId === j.id).at(-1);
    return p ? (j.materialRevenueCents * p.materialsPct) / 100 + ((j.contractCents - j.materialRevenueCents) * p.laborPct) / 100 : 0;
  };

  // Billing: monthly progress on three jobs, milestones on Riverbend and Iron Range, the rest final only.
  const invoices: Invoice[] = [];
  const milestones: Milestone[] = [];
  const retainageReceipts: RetainageReceipt[] = [];
  let iv = 1;
  let invNo = 1150;
  const inv = (jobId: string, kind: Invoice["kind"], amountCents: number, on: IsoDate, extra: Partial<Invoice> = {}) =>
    invoices.push({ id: sampleId(7, iv++), jobId, kind, period: null, milestoneId: null, number: kind === "skip" ? null : `26-${invNo++}`, amountCents, invoicedOn: on, recordedBy: "Patrick Leaon", ...extra });
  {
    const j0 = jobs[0];
    const amt = Math.round((recognizedNow(j0) * (0.85 + r11() * 0.1)) / 10000) * 10000;
    inv(j0.id, "progress", amt, addDays(START, -5), { period: START.slice(0, 7) });
    let mn = 1;
    const ms = (j: Job, list: [string, number][], reached: (IsoDate | null)[]) =>
      list.forEach(([label, pct], k) =>
        milestones.push({ id: sampleId(8, mn++), jobId: j.id, label, pct, sort: k + 1, reachedOn: reached[k] ?? null, reachedBy: reached[k] ? pmName(j.pmCode) : null }),
      );
    ms(jobs[1], [["Mobilization", 20], ["Tank 1 lined", 40], ["Tank 2 lined", 30]], [addDays(START, -7), START, null]);
    inv(jobs[1].id, "milestone", Math.round(jobs[1].contractCents * 0.2), addDays(START, -7), { milestoneId: milestones[0].id });
    ms(jobs[14], MILESTONE_TEMPLATE, []);
  }

  // Five finished jobs for the billing board: ready, monthly with a balance, waiting on sign-off, retainage out, closed.
  const DONE = [
    { num: "4051", c: "Dakota Ridge Ethanol", t: "Tank lining", l: "Marshall, MN", rep: "PK", pm: "JM", s: "Tony Becker", st: -45, fin: -7, val: 148500, method: "final", signed: true },
    { num: "4058", c: "Wabasha County Highway Dept", t: "Structural steel", l: "Wabasha, MN", rep: "CM", pm: "LK", s: "Kevin Jensen", st: -38, fin: -7, val: 212000, method: "monthly", signed: true, prog: 159000, muni: true },
    { num: "4065", c: "Sunrise Cheese", t: "Floor system", l: "Melrose, MN", rep: "BE", pm: "SS", s: "Luis Ortega", st: -31, fin: -9, val: 86500, method: "final", signed: false },
    { num: "4072", c: "Mankato Water Treatment", t: "Secondary containment", l: "Mankato, MN", rep: "ER", pm: "SS", s: "Pete Larson", st: -73, fin: -35, val: 174000, method: "final", signed: true, final: true, muni: true },
    { num: "4079", c: "Ag Partners Co-op", t: "Interior painting", l: "Redwood Falls, MN", rep: "EM", pm: "JM", s: "Ray Thompson", st: -66, fin: -42, val: 58000, method: "final", signed: true, final: true, warranty: true },
  ];
  DONE.forEach((x, k) => {
    const id = sampleId(K.job, 100 + k);
    const proj = Math.round(x.val / 150 / 10) * 10;
    const start = addDays(START, x.st - 4);
    const finish = addDays(START, x.fin);
    const contractCents = x.val * 100;
    const job: Job = {
      id,
      number: x.num,
      customer: x.c,
      jobType: x.t,
      location: x.l,
      repCode: RMAP[x.rep] ?? x.rep,
      pmCode: x.pm,
      estimator: ESTIMATORS[k % ESTIMATORS.length],
      leaderId: leaderId(x.s),
      crewSize: 5,
      estimateHrs: proj,
      projectedHrs: proj,
      contractCents,
      materialCostCents: Math.round(x.val * 0.3 * 0.55) * 100,
      materialRevenueCents: Math.round((x.val * 0.3) / 500) * 50000,
      start,
      projectedFinish: finish,
      baselineFinish: finish,
      mustFinish: null,
      mustFinishReason: null,
      actualFinish: finish,
      status: "complete",
      firmness: "confirmed",
      waitsOnJobId: null,
      firmnessReason: null,
      holdReason: null,
      holdUntil: null,
      exterior: false,
      billingMethod: x.method as Job["billingMethod"],
      retainagePct: x.muni ? 5 : 0,
      retainageRelease: x.muni ? "final_completion" : null,
      retainageReleaseNote: null,
      customerPo: "PO " + (48000 + Number(x.num)),
      billTo: "Accounts payable, " + x.c,
      lienWaivers: x.val >= 100000,
      certifiedPayroll: !!x.muni,
      requirements: [],
      siteAddress: "",
      siteStartTime: "6:30 AM",
      siteContact: "",
      siteOrientation: "None",
      sitePpe: ppeFor(x.t),
      active: true,
    };
    jobs.push(job);
    actuals.push({ jobId: id, week: weekEndingOf(finish), hours: proj });
    const s0 = addDays(start, -20);
    workOrders.push({
      jobId: id,
      version: 2,
      currentStep: 4,
      since: s0,
      final: true,
      filed: true,
      fileName: `WO-${x.num} v2.pdf`,
      filePath: null,
      returned: null,
      signoffs: WO_STEPS.map((_, i) => ({ step: i, by: who(job, i), at: stamp(s0) })),
      history: [{ at: stamp(s0), who: "Lori", action: "Final filed in Procore as the work order of record.", note: "" }],
    });
    for (const c of DEFAULT_CHECKPOINTS) {
      if (c.autoSource) continue;
      if (c.anchor === "finish" && c.key !== "walk") continue;
      if (c.key === "walk" && !x.signed) continue;
      jobCheckpoints.push({ jobId: id, key: c.key, by: ownerWho(job, c.owner), at: stamp(addDays(c.anchor === "finish" ? finish : start, c.offsetDays)) });
    }
    if (x.prog) inv(id, "progress", x.prog * 100, addDays(START, -32), { period: addDays(START, -32).slice(0, 7) });
    if (x.final) {
      inv(id, "final", contractCents, addDays(finish, 7));
      jobCheckpoints.push({ jobId: id, key: "cause", by: pmName(x.pm), at: stamp(addDays(finish, 5)) });
      if (x.warranty) jobCheckpoints.push({ jobId: id, key: "warr", by: pmName(x.pm), at: stamp(addDays(finish, 10)) });
    }
  });

  // Closeout outcomes: the finished jobs above, plus the demo's illustrative 12 months per leader.
  const rate = DEFAULT_SETTINGS.burdenedRateCents;
  const outcomes: Outcome[] = jobs
    .filter((j) => j.status === "complete")
    .map((j, k) => {
      const act = actuals.filter((a) => a.jobId === j.id).reduce((a, x) => a + x.hours, 0);
      return {
        id: sampleId(9, k + 1),
        jobId: j.id,
        number: j.number,
        customer: j.customer,
        jobType: j.jobType,
        leaderId: j.leaderId,
        pmCode: j.pmCode,
        finishedOn: j.actualFinish!,
        estimateHrs: j.estimateHrs,
        actualHrs: act,
        contractCents: j.contractCents,
        gpBid: 1 - (j.materialCostCents + j.estimateHrs * rate) / j.contractCents,
        gpFinal: 1 - (j.materialCostCents + act * rate) / j.contractCents,
        onTime: true,
        cause: null,
        illustrative: false,
      };
    });
  {
    const r7 = rng(7);
    const types = ["Floor system", "Tank lining", "Water tower", "Structural steel", "Secondary containment", "Interior painting", "Stack coating"];
    const custs = ["Prairie Gold Dairy", "Northstar Ethanol", "City of Mankato", "Bluff Valley Foods", "Midwest Grain Co-op", "Lakeshore Paper", "River City Water", "Heartland Malting", "Summit Agri", "Crown Creamery"];
    const skill: Record<string, number> = { "Mike Ramirez": 0.96, "Tony Becker": 1.17, "Jake Lund": 1.02, "Dave Olson": 1.05, "Luis Ortega": 0.98, "Brandon Kurth": 1.12, "Sam Nguyen": 1.0, "Ray Thompson": 1.07, "Kevin Jensen": 0.99, "Marco Silva": 1.03, "Pete Larson": 1.09, "Darnell Hayes": 1.01, "Ben Schultz": 0.97, "Travis Moe": 1.04 };
    let n = 3100;
    let on = 100;
    for (const L of LEADERS) {
      const k = 2 + Math.floor(r7() * 5);
      for (let i = 0; i < k; i++) {
        const est = Math.round((200 + r7() * 1400) / 10) * 10;
        const value = Math.round((est * (115 + r7() * 40)) / 500) * 500;
        const gpBid = 0.38 + r7() * 0.12;
        const matCost = Math.round(value * (1 - gpBid) - est * 55);
        const ratio = (skill[L] || 1) * (0.92 + r7() * 0.16);
        let cause: string | null = null;
        if (ratio > 1.08) {
          const x = r7();
          cause =
            (skill[L] || 1) > 1.06
              ? x < 0.6 ? "Field" : x < 0.75 ? "Estimate" : x < 0.9 ? "Change order not captured" : "Customer delay"
              : x < 0.25 ? "Field" : x < 0.55 ? "Estimate" : x < 0.8 ? "Change order not captured" : x < 0.9 ? "Customer delay" : "Weather";
        }
        const actual = Math.round(est * ratio);
        const cost = matCost * (0.97 + r7() * 0.06) + actual * 55;
        outcomes.push({
          id: sampleId(9, on++),
          jobId: null,
          number: String((n += 11)),
          customer: custs[Math.floor(r7() * custs.length)],
          jobType: types[Math.floor(r7() * types.length)],
          leaderId: leaderId(L),
          pmCode: PMS[on % 3].code,
          finishedOn: addDays(START, -7 * (1 + Math.floor(r7() * 50))),
          estimateHrs: est,
          actualHrs: actual,
          contractCents: value * 100,
          gpBid,
          gpFinal: 1 - cost / value,
          onTime: r7() < (ratio > 1.1 ? 0.55 : 0.9),
          cause,
          illustrative: true,
        });
      }
    }
  }

  return {
    jobs,
    people,
    timeOff,
    overrides: [],
    actuals,
    assignments,
    notes,
    settings: { ...DEFAULT_SETTINGS },
    qualifications: QUALIFICATIONS,
    reps: REPS,
    pms: PMS,
    users,
    closes,
    hourEntries: [],
    confirmations: [],
    metrics,
    snapshots,
    workOrders,
    stages: DEFAULT_STAGES.map((x) => ({ ...x })),
    checkpointDefs: DEFAULT_CHECKPOINTS.map((x) => ({ ...x })),
    jobCheckpoints,
    staff: { schedulers: ["Nicole"], jobSetup: ["Lori"], estimators: [...ESTIMATORS] },
    percents,
    changeOrders: [],
    milestones,
    invoices,
    retainageReceipts,
    outcomes,
  };
}
