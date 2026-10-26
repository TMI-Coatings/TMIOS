/**
 * Sample data, generated the same way as the v15 demo (reference/TMI-Ops-Demo.html) so the
 * screens can be checked against it. Every name, number and job here is invented.
 * Used by sample mode in the browser and by scripts/make-seed-sql.ts for a dev database.
 * Never load real TMI data (hard rule 1).
 */
import type {
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
import { materialRevenueCents } from "../domain/schedule";
import { addDays, mondayOf } from "../domain/weeks";

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
  { code: "DM", name: "Dana Mills" },
  { code: "JT", name: "Jordan Tate" },
  { code: "KW", name: "Kelly Wright" },
  { code: "LB", name: "Lena Brooks" },
  { code: "NH", name: "Nate Holloway" },
  { code: "RS", name: "Rosa Santos" },
  { code: "TP", name: "Tom Pruitt" },
  { code: "VC", name: "Vic Castillo" },
  { code: "BF", name: "Ben Fischer" },
];
const RMAP: Record<string, string> = { AL: "DM", PK: "JT", ER: "KW", GD: "LB", CM: "NH", BE: "RS", EM: "TP", KK: "VC", SCS: "BF" };

export const PMS: Lookup[] = [
  { code: "JS", name: "Jenna Stahl" },
  { code: "RL", name: "Rob Lindqvist" },
  { code: "TK", name: "Tara Kline" },
];

const ESTIMATORS = ["Greg Halvorsen", "Paula Kern"];

const LEADERS = ["Mike Ramirez", "Tony Becker", "Jake Lund", "Dave Olson", "Luis Ortega", "Brandon Kurth", "Sam Nguyen", "Ray Thompson", "Kevin Jensen", "Marco Silva", "Pete Larson", "Darnell Hayes", "Ben Schultz", "Travis Moe"];
const FIRST = ["Alex", "Jordan", "Tyler", "Cody", "Eric", "Nate", "Logan", "Dylan", "Josh", "Matt", "Ryan", "Zach", "Adam", "Carlos", "Jesse", "Derek", "Shane", "Trent", "Hector", "Andre", "Wes", "Colton", "Isaac", "Mason", "Owen", "Garrett", "Juan", "Victor", "Seth", "Caleb", "Riley"];
const LAST = ["Anderson", "Johnson", "Peterson", "Nelson", "Hanson", "Larson", "Swanson", "Carlson", "Erickson", "Olson", "Miller", "Schmidt", "Weber", "Becker", "Hoffman", "Lopez", "Garcia", "Kowalski", "Novak", "Lindgren", "Berg", "Dahl", "Holm", "Stark", "Vogel", "Krause", "Moreno", "Ruiz", "Thao", "Vang", "Yang"];

const CS = ["Confined space"];
const LF = ["Lift"];
type Spec = { c: string; t: string; l: string; o: number; w: number; cr: number; rep: string; pm: string; s: string; f?: number; x?: 1; q?: string[] };
const SPEC: Spec[] = [
  { c: "North Prairie Dairy", t: "Floor system", l: "Lake Norden, SD", o: -2, w: 4, cr: 6, rep: "GD", pm: "JS", s: "Mike Ramirez" },
  { c: "Riverbend Ethanol", t: "Tank lining", l: "Bingham Lake, MN", o: -1, w: 5, cr: 8, rep: "PK", pm: "JS", s: "Tony Becker", f: 1.32, q: CS },
  { c: "Twin Cities Metro Water", t: "Water tower", l: "Woodbury, MN", o: -3, w: 6, cr: 5, rep: "ER", pm: "RL", s: "Jake Lund", x: 1, q: LF },
  { c: "Granite Falls Grain", t: "Structural steel", l: "Granite Falls, MN", o: 0, w: 3, cr: 4, rep: "CM", pm: "RL", s: "Dave Olson", x: 1, q: LF },
  { c: "Lakeside Foods", t: "Floor system", l: "Owatonna, MN", o: 0, w: 2, cr: 6, rep: "BE", pm: "JS", s: "Luis Ortega" },
  { c: "Cedar Valley Power", t: "Stack coating", l: "Waterloo, IA", o: -1, w: 6, cr: 4, rep: "AL", pm: "TK", s: "Brandon Kurth", f: 1.24, x: 1, q: LF },
  { c: "St. Croix Paper", t: "Secondary containment", l: "Hudson, WI", o: 1, w: 3, cr: 5, rep: "KK", pm: "TK", s: "Sam Nguyen", q: CS },
  { c: "Red Wing Malting", t: "Interior painting", l: "Red Wing, MN", o: 1, w: 2, cr: 3, rep: "EM", pm: "RL", s: "Ray Thompson" },
  { c: "Mesabi Aggregates", t: "Structural steel", l: "Virginia, MN", o: 2, w: 5, cr: 6, rep: "SCS", pm: "TK", s: "Kevin Jensen", x: 1, q: LF },
  { c: "Prairie Pork Processing", t: "Floor system", l: "Worthington, MN", o: 2, w: 3, cr: 8, rep: "GD", pm: "JS", s: "Marco Silva" },
  { c: "Heartland Fiberglass", t: "Tank lining", l: "Mankato, MN", o: 3, w: 4, cr: 5, rep: "PK", pm: "RL", s: "Pete Larson", q: ["Confined space", "Fiberglass"] },
  { c: "City of Owatonna", t: "Water tower", l: "Owatonna, MN", o: 3, w: 4, cr: 4, rep: "ER", pm: "TK", s: "Darnell Hayes", x: 1, q: LF },
  { c: "Bluff Country Creamery", t: "Floor system", l: "Rochester, MN", o: 3, w: 2, cr: 6, rep: "CM", pm: "JS", s: "Mike Ramirez" },
  { c: "Minnesota Valley Ag", t: "Secondary containment", l: "New Ulm, MN", o: 4, w: 3, cr: 6, rep: "BE", pm: "RL", s: "Ben Schultz", q: CS },
  { c: "Iron Range Mining", t: "Structural steel", l: "Hibbing, MN", o: 4, w: 6, cr: 8, rep: "AL", pm: "TK", s: "Travis Moe", x: 1, q: LF },
  { c: "Two Rivers Hospital", t: "Interior painting", l: "Mankato, MN", o: 4, w: 3, cr: 4, rep: "KK", pm: "JS", s: "Jake Lund" },
  { c: "Kasota Stone", t: "Concrete repair", l: "Kasota, MN", o: 4, w: 2, cr: 3, rep: "EM", pm: "RL", s: "Darnell Hayes" },
  { c: "Northern Plains Wind", t: "Structural steel", l: "Lake Benton, MN", o: 4, w: 3, cr: 5, rep: "SCS", pm: "TK", s: "Luis Ortega", x: 1, q: LF },
  { c: "Riverbend Ethanol", t: "Tank lining, phase 2", l: "Bingham Lake, MN", o: 9, w: 4, cr: 6, rep: "PK", pm: "JS", s: "Tony Becker", q: CS },
  { c: "Lakeside Foods", t: "Floor system", l: "Cokato, MN", o: 10, w: 2, cr: 5, rep: "BE", pm: "JS", s: "Sam Nguyen" },
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
}

/** Build the sample dataset with the demo's week lined up to `baseWeek` (a Friday). */
export function buildSample(baseWeek: IsoDate): SampleData {
  const shift = (s: IsoDate) => addDays(s, Math.round((Date.parse(baseWeek) - Date.parse(DEMO_WEEK)) / 86_400_000));
  const START = baseWeek;
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
    .forEach((p) => off(p, shift("2026-11-09"), shift("2026-11-13"), "Hunting"));
  pick(F, 10).forEach((p) => off(p, shift("2026-11-25"), shift("2026-11-27"), "Holiday"));
  pick(people.slice(1), 30).forEach((p) => off(p, shift("2026-12-21"), shift("2027-01-01"), "Holiday"));
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
      estimator: ESTIMATORS[i % 2],
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
  U("Austin Lewis", "admin");
  U("Derrick", "ceo");
  U("Nicole", "scheduler");
  U("Lori", "job_setup");
  U("Greg Halvorsen", "estimator");
  U("Jenna Stahl", "pm", { pmCode: "JS" });
  U("Mike Ramirez", "superintendent", { personId: leaderId("Mike Ramirez") });
  U("Kelly Wright", "sales_rep", { repCode: "KW" });
  U("Jared", "cfo");
  U("Accounting", "accounting");

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
  };
}
