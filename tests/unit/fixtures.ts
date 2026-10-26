import type { Dataset, Job, Person } from "../../src/domain/types";
import { DEFAULT_SETTINGS } from "../../src/domain/types";

export const W = "2026-10-30"; // current week (Friday)

export function job(over: Partial<Job> = {}): Job {
  return {
    id: "j1",
    number: "4112",
    customer: "Test Co",
    jobType: "Floor system",
    location: "Mankato, MN",
    repCode: "KW",
    pmCode: "JS",
    estimator: "Greg Halvorsen",
    leaderId: "p1",
    crewSize: 4,
    estimateHrs: 400,
    projectedHrs: 400,
    contractCents: 6_000_000,
    materialCostCents: 1_000_000,
    materialRevenueCents: 1_500_000,
    start: "2026-10-26",
    projectedFinish: "2026-11-20",
    baselineFinish: "2026-11-20",
    mustFinish: null,
    mustFinishReason: null,
    actualFinish: null,
    status: "active",
    firmness: "confirmed",
    waitsOnJobId: null,
    holdReason: null,
    holdUntil: null,
    exterior: false,
    billingMethod: "final",
    retainagePct: 0,
    retainageRelease: null,
    retainageReleaseNote: null,
    requirements: [],
    siteAddress: "",
    siteStartTime: "",
    siteContact: "",
    siteOrientation: "",
    sitePpe: "",
    active: true,
    ...over,
  };
}

export function person(over: Partial<Person> = {}): Person {
  return { id: "p1", name: "Pat", kind: "field", state: "MN", phone: "", driver: false, dotExpires: null, active: true, quals: {}, ...over };
}

export function dataset(over: Partial<Dataset> = {}): Dataset {
  return {
    jobs: [],
    people: [],
    timeOff: [],
    overrides: [],
    actuals: [],
    assignments: [],
    notes: [],
    settings: { ...DEFAULT_SETTINGS },
    qualifications: ["Confined space", "Lift", "Fiberglass"],
    reps: [],
    pms: [],
    ...over,
  };
}
