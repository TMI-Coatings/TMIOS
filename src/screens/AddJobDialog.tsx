import { useState } from "react";
import { Modal } from "../components/Modal";
import type { NewJobInput } from "../data/repo";
import { leaderConflicts } from "../domain/crew";
import { jobProblem, ppeFor } from "../domain/jobRules";
import { FIRMNESS, bidMargin, materialRevenueCents } from "../domain/schedule";
import type { Job } from "../domain/types";
import { addDays, mondayOf } from "../domain/weeks";
import { pct, toCents, usd } from "../format";
import type { Ctx } from "../Workspace";

/** Add a sold job from the estimate. The contract split is computed here and frozen (decision 22). */
export function AddJobDialog({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const { data, week, repo, run } = ctx;
  const ds = data.ds;
  const estimators = ds.staff.estimators;
  const leaders = ds.people.filter((p) => p.kind === "leader" && p.active);
  const [f, setF] = useState({
    number: "",
    customer: "",
    location: "",
    jobType: "",
    repCode: ds.reps[0]?.code ?? "",
    pmCode: ds.pms[0]?.code ?? "",
    estimator: "",
    contract: "",
    hours: "",
    material: "",
    status: "scheduled" as "scheduled" | "active",
    billingMethod: "final" as Job["billingMethod"],
    firmness: "" as Job["firmness"] | "",
    waitsOnJobId: "",
    leaderId: leaders[0]?.id ?? "",
    crewSize: "4",
    start: mondayOf(addDays(week, 21)),
    projectedFinish: addDays(week, 28),
    mustFinish: "",
    mustFinishReason: "" as "" | "shutdown" | "contract",
    retainagePct: "0",
    retainageRelease: "" as "" | NonNullable<Job["retainageRelease"]>,
    retainageReleaseNote: "",
    customerPo: "",
    billTo: "",
    lienWaivers: false,
    certifiedPayroll: false,
    requirements: [] as string[],
    exterior: false,
    siteAddress: "",
    siteStartTime: "6:30 AM",
    siteContact: "",
    siteOrientation: "",
    sitePpe: "",
    note: "",
  });
  const clash = f.start && f.projectedFinish ? leaderConflicts(ds, f.leaderId || null, f.start, f.projectedFinish) : [];
  const [problem, setProblem] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v });

  const contractCents = toCents(f.contract || "0");
  const materialCents = toCents(f.material || "0");
  const hrs = Math.round(Number(f.hours) || 0);
  const rate = ds.settings.burdenedRateCents;
  const matRev = materialRevenueCents(contractCents, materialCents, hrs, rate);

  const submit = async () => {
    if (!f.estimator.trim()) return setProblem("Pick the estimator. They review the draft work order first.");
    if (!f.firmness) return setProblem("Pick how firm the dates are. The rep knows what the customer agreed to.");
    if (!(contractCents > 0) || !(hrs > 0)) return setProblem("Contract value and estimated hours are required.");
    const input: NewJobInput = {
      number: f.number.replace(/\D/g, ""),
      customer: f.customer.trim(),
      jobType: f.jobType.trim() || "General",
      location: f.location.trim(),
      repCode: f.repCode,
      pmCode: f.pmCode,
      estimator: f.estimator.trim(),
      leaderId: f.leaderId || null,
      crewSize: Math.max(1, Number(f.crewSize) || 1),
      estimateHrs: hrs,
      contractCents,
      materialCostCents: materialCents,
      start: f.start,
      projectedFinish: f.projectedFinish,
      mustFinish: f.mustFinish || null,
      mustFinishReason: f.mustFinish ? f.mustFinishReason || "contract" : null,
      status: f.status,
      firmness: f.firmness,
      waitsOnJobId: f.firmness === "waiting" ? f.waitsOnJobId || null : null,
      exterior: f.exterior,
      billingMethod: f.billingMethod,
      retainagePct: Number(f.retainagePct) || 0,
      retainageRelease: Number(f.retainagePct) > 0 ? f.retainageRelease || null : null,
      retainageReleaseNote: f.retainageRelease === "other" ? f.retainageReleaseNote.trim() || null : null,
      customerPo: f.customerPo.trim(),
      billTo: f.billTo.trim(),
      lienWaivers: f.lienWaivers,
      certifiedPayroll: f.certifiedPayroll,
      requirements: f.requirements,
      siteAddress: f.siteAddress,
      siteStartTime: f.siteStartTime,
      siteContact: f.siteContact,
      siteOrientation: f.siteOrientation || "None",
      sitePpe: f.sitePpe.trim() || ppeFor(f.jobType),
      note: f.note,
    };
    const p = jobProblem(null, {
      ...input,
      id: "new",
      projectedHrs: hrs,
      materialRevenueCents: matRev,
      burdenedRateCents: rate,
      baselineFinish: input.projectedFinish,
      actualFinish: null,
      firmnessReason: null,
      holdReason: null,
      holdUntil: null,
      active: true,
    });
    if (p) return setProblem(p);
    if (ds.jobs.some((j) => j.number === input.number)) return setProblem(`Job ${input.number} is already on the schedule.`);
    if (await run(() => repo.createJob(input), `Job ${input.number} added.`)) onClose();
  };

  const text = (k: keyof typeof f, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      {label}
      <input value={f[k] as string} onChange={(e) => set(k, e.target.value)} {...extra} />
    </label>
  );

  return (
    <Modal
      title="Add job from estimate"
      sub="The job is booked on the schedule the moment you add it, and a work order opens alongside it for job setup to draft."
      onClose={onClose}
      footer={
        <>
          {problem && <span className="err-text" role="alert" style={{ marginRight: "auto" }}>{problem}</span>}
          <button className="btn sec" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={submit}>
            Add job
          </button>
        </>
      }
    >
      <h2 style={{ fontSize: 15, margin: "0 0 8px" }}>Job</h2>
      <div className="fg">
        {text("number", "Job number", { inputMode: "numeric", maxLength: 4, placeholder: "4 digits" })}
        {text("customer", "Customer")}
        {text("location", "Location")}
        {text("jobType", "Type", { placeholder: "Floor system" })}
        <label className="field">
          Sales rep
          <select value={f.repCode} onChange={(e) => set("repCode", e.target.value)}>
            {ds.reps.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          PM
          <select value={f.pmCode} onChange={(e) => set("pmCode", e.target.value)}>
            {ds.pms.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Estimator (required)
          <select value={f.estimator} onChange={(e) => set("estimator", e.target.value)}>
            <option value="">Pick the estimator</option>
            {estimators.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>

      <h2 style={{ fontSize: 15, margin: "16px 0 8px" }}>From the estimate</h2>
      <div className="fg">
        {text("contract", "Contract value ($)", { inputMode: "decimal" })}
        {text("hours", "Estimated labor hrs", { inputMode: "numeric" })}
        {text("material", "Projected material cost ($)", { inputMode: "decimal" })}
      </div>
      <p className="note" style={{ margin: "8px 0 0" }}>
        {contractCents > 0 && hrs > 0
          ? `Material revenue ${usd(matRev)}, labor revenue ${usd(contractCents - matRev)} (split by estimated cost, fixed at intake). Bid cost at ${usd(rate)}/hr labor: ${pct(
              bidMargin(contractCents, materialCents, hrs, rate),
            )} GP.`
          : "Enter contract, hours and material cost to see the revenue split and bid margin."}
      </p>

      <h2 style={{ fontSize: 15, margin: "16px 0 8px" }}>Billing and retainage</h2>
      <div className="fg">
        <label className="field">
          Billing method
          <select value={f.billingMethod} onChange={(e) => set("billingMethod", e.target.value)}>
            <option value="final">Final invoice</option>
            <option value="monthly">Monthly progress</option>
            <option value="milestone">Milestones</option>
          </select>
        </label>
        {text("retainagePct", "Retainage (%)", { inputMode: "decimal" })}
        <label className="field">
          Retainage released at
          <select value={f.retainageRelease} disabled={!(Number(f.retainagePct) > 0)} onChange={(e) => set("retainageRelease", e.target.value)}>
            <option value="">Select…</option>
            <option value="substantial_completion">Substantial completion</option>
            <option value="final_completion">Final completion</option>
            <option value="other">Other (per contract)</option>
          </select>
        </label>
        {f.retainageRelease === "other" && text("retainageReleaseNote", "Release terms")}
        {text("customerPo", "Customer PO")}
        {text("billTo", "Billing contact")}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <label className="q">
          <input type="checkbox" checked={f.lienWaivers} onChange={(e) => set("lienWaivers", e.target.checked)} /> Lien waivers required
        </label>
        <label className="q">
          <input type="checkbox" checked={f.certifiedPayroll} onChange={(e) => set("certifiedPayroll", e.target.checked)} /> Certified payroll required
        </label>
      </div>

      <h2 style={{ fontSize: 15, margin: "16px 0 8px" }}>Schedule</h2>
      <div className="fg">
        <label className="field">
          Status
          <select value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="scheduled">Scheduled</option>
            <option value="active">In progress</option>
          </select>
        </label>
        <label className="field">
          Date firmness (required)
          <select value={f.firmness} onChange={(e) => set("firmness", e.target.value)}>
            <option value="">Select…</option>
            {FIRMNESS.map((x) => (
              <option key={x.key} value={x.key} title={x.description}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Can’t start until this job finishes
          <select value={f.waitsOnJobId} disabled={f.firmness !== "waiting"} onChange={(e) => set("waitsOnJobId", e.target.value)}>
            <option value="">None</option>
            {ds.jobs
              .filter((j) => j.active && j.status !== "complete")
              .sort((a, b) => a.number.localeCompare(b.number))
              .map((j) => (
                <option key={j.id} value={j.id}>
                  {j.number} {j.customer}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Job leader
          <select value={f.leaderId} onChange={(e) => set("leaderId", e.target.value)}>
            {leaders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {clash.length > 0 && (
            <span className="err-text" role="status">
              Already leads {clash.map((o) => `${o.number} ${o.customer}`).join(", ")} in those weeks.
            </span>
          )}
        </label>
        {text("crewSize", "Crew size", { type: "number", min: 1, max: 40 })}
        {text("start", "Start", { type: "date" })}
        {text("projectedFinish", "Projected finish", { type: "date" })}
        {text("mustFinish", "Must finish (shutdown or contract only)", { type: "date" })}
        <label className="field">
          Deadline type
          <select value={f.mustFinishReason} onChange={(e) => set("mustFinishReason", e.target.value)}>
            <option value="">None</option>
            <option value="shutdown">Shutdown</option>
            <option value="contract">Contract obligation</option>
          </select>
        </label>
      </div>

      <h2 style={{ fontSize: 15, margin: "16px 0 8px" }}>Requirements</h2>
      <div className="row">
        {ds.qualifications.map((q) => (
          <label className="q" key={q}>
            <input
              type="checkbox"
              checked={f.requirements.includes(q)}
              onChange={(e) => set("requirements", e.target.checked ? [...f.requirements, q] : f.requirements.filter((x) => x !== q))}
            />{" "}
            {q}
          </label>
        ))}
        <label className="q">
          <input type="checkbox" checked={f.exterior} onChange={(e) => set("exterior", e.target.checked)} /> Exterior work
        </label>
      </div>

      <h2 style={{ fontSize: 15, margin: "16px 0 8px" }}>Site details for the crew</h2>
      <div className="fg">
        {text("siteAddress", "Site address")}
        {text("siteStartTime", "Start time")}
        {text("siteContact", "Site contact")}
        {text("siteOrientation", "Orientation or badging")}
        {text("sitePpe", "PPE and permits")}
      </div>
      <label className="field" style={{ marginTop: 10 }}>
        Note for the job file (optional)
        <textarea rows={2} value={f.note} placeholder="Anything from the estimate or sale the team needs to know" onChange={(e) => set("note", e.target.value)} />
      </label>
    </Modal>
  );
}
