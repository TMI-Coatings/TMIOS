import { useState } from "react";
import { BILLING_METHOD_LABEL, Money, monthLabel, nextMonth } from "../domain/money";
import { can, canEditJob } from "../domain/permissions";
import { buildIndex } from "../domain/schedule";
import type { Job } from "../domain/types";
import { fmtShort, todayIn } from "../domain/weeks";
import { toCents, usd } from "../format";
import type { Ctx } from "../Workspace";

/** The billing box in the job window: method, contract and change orders, what's due, invoices, retainage. */
export function BillingPanel({ ctx, job, open }: { ctx: Ctx; job: Job; open?: boolean }) {
  const { viewer, data, repo, run, week } = ctx;
  const ds = data.ds;
  const [form, setForm] = useState<Record<string, string>>({});
  const [ms, setMs] = useState<{ id?: string; label: string; pct: number }[] | null>(null);
  const today = todayIn(new Date());
  const [co, setCo] = useState({ number: "", description: "", amount: "", material: "", materialCost: "", hours: "", approvedBy: "", approvedOn: today });
  if (!can.seeMoney(viewer.role)) return null;
  const m = new Money(ds, buildIndex(ds), week, today);
  const cb = can.recordInvoices(viewer.role);
  const st = m.billState(job);
  const pd = m.progressDue(job);
  const mr = m.milestonesReady(job);
  const f = (k: string, d = "") => form[k] ?? d;
  const set = (k: string, v: string) => setForm({ ...form, [k]: v });
  const signed = m.signedOff(job);
  const cos = ds.changeOrders.filter((c) => c.jobId === job.id);
  const label = st
    ? { wait: "complete, waiting on customer sign-off", ready: m.invoiceLate(job) ? "final invoice ready, late" : "final invoice ready", ret: "invoiced, retainage outstanding", closed: "invoiced and closed" }[st]
    : pd.length
      ? pd.some((p) => m.progressLate(p))
        ? "progress invoice late"
        : "progress invoice due"
      : mr.length
        ? "milestone ready to invoice"
        : BILLING_METHOD_LABEL[job.billingMethod].toLowerCase();
  const rows: [string, string][] = [
    ["Billing method", BILLING_METHOD_LABEL[job.billingMethod]],
    ["Contract value", usd(job.contractCents)],
    ["Approved change orders", cos.length ? `${cos.length}, ${usd(cos.reduce((a, c) => a + c.amountCents, 0))}` : "None"],
    ["Contract with change orders", usd(m.contract(job))],
    ["Billed to date", usd(m.billed(job))],
    ["Remaining to bill", usd(m.toBill(job))],
    ["Retainage", job.retainagePct > 0 ? `${job.retainagePct}%, ${usd(m.retainageOutstanding(job))} held` : "None"],
    ...(st ? ([["Customer sign-off", signed ? `Signed ${fmtShort(signed.at.slice(0, 10))} (${signed.by})` : "Not yet"]] as [string, string][]) : []),
    ["Customer PO", job.customerPo || "Not on file"],
    ["Billing contact", job.billTo || "Not on file"],
    ["Lien waivers", job.lienWaivers ? "Required" : "Not required"],
    ["Certified payroll", job.certifiedPayroll ? "Required" : "Not required"],
  ];
  const invs = ds.invoices.filter((i) => i.jobId === job.id && i.kind !== "skip");
  const milestones = m.milestones(job);
  const msEdit = cb && job.status !== "complete";

  return (
    <details className="wobox" open={open || st === "ready" || pd.length > 0 || mr.length > 0}>
      <summary>Billing: {label}</summary>
      <div className="scroll" style={{ marginTop: 8 }}>
        <table>
          <tbody>
            {rows.map(([a, b]) => (
              <tr key={a}>
                <td>{a}</td>
                <td className="r">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cb && job.status !== "complete" && (
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field">
            Billing method
            <select value={f("method", job.billingMethod)} onChange={(e) => set("method", e.target.value)}>
              {Object.entries(BILLING_METHOD_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button className="btn sec" disabled={f("method", job.billingMethod) === job.billingMethod} onClick={() => run(() => repo.setBillingMethod(job.id, f("method") as Job["billingMethod"]), "Billing method changed.")}>
            Change method
          </button>
        </div>
      )}

      {job.billingMethod === "monthly" && (
        <>
          <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Progress invoices</h3>
          {pd.map((p) => (
            <div className="panel" style={{ padding: 10, marginBottom: 8 }} key={p}>
              <b>{monthLabel(p, true)}</b>{" "}
              <span className="note">
                {m.progressLate(p) ? (
                  <>
                    <span className="tag red">Late</span> was due
                  </>
                ) : (
                  "due"
                )}{" "}
                {fmtShort(m.payDue(p))}. Suggested {usd(m.progressSuggest(job))}: {usd(m.recognized(job))} recognized less {usd(m.billed(job))} billed.
              </span>
              {cb && (
                <>
                  <div className="fg" style={{ marginTop: 8 }}>
                    <label className="field">
                      Invoice number
                      <input value={f("pn" + p)} placeholder="From Sage" onChange={(e) => set("pn" + p, e.target.value)} />
                    </label>
                    <label className="field">
                      Amount ($)
                      <input value={f("pa" + p, String(m.progressSuggest(job) / 100))} inputMode="decimal" onChange={(e) => set("pa" + p, e.target.value)} />
                    </label>
                  </div>
                  <div className="row" style={{ marginTop: 6 }}>
                    <button
                      className="btn"
                      onClick={() => run(() => repo.recordInvoice({ jobId: job.id, kind: "progress", period: p, number: f("pn" + p), amountCents: toCents(f("pa" + p, String(m.progressSuggest(job) / 100))) }), "Progress invoice recorded.")}
                    >
                      Record progress invoice
                    </button>
                    <button className="btn sec" onClick={() => run(() => repo.recordInvoice({ jobId: job.id, kind: "skip", period: p }), "Marked nothing to bill.")}>
                      Nothing to bill this month
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
          {!pd.length && job.status !== "complete" && (
            <p className="note" style={{ margin: 0 }}>
              {job.start > today ? `Starts ${fmtShort(job.start)}. First pay application due ${fmtShort(m.payDue(job.start.slice(0, 7)))}.` : `Up to date. Next pay application due ${fmtShort(m.payDue(nextMonth(today.slice(0, 7))))}.`}
            </p>
          )}
        </>
      )}

      {job.billingMethod === "milestone" && (
        <>
          <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Milestones</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Milestone</th>
                  <th className="r">%</th>
                  <th className="r">Amount</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(ms ?? milestones.map((x) => ({ id: x.id, label: x.label, pct: x.pct }))).map((x, i) => {
                  const real = milestones.find((y) => y.id === x.id);
                  const inv = real && m.milestoneInvoice(real);
                  const editing = ms && !inv;
                  return (
                    <tr key={x.id ?? "new" + i}>
                      <td>
                        {editing ? (
                          <input value={x.label} aria-label="Milestone name" onChange={(e) => setMs(ms!.map((y, k) => (k === i ? { ...y, label: e.target.value } : y)))} />
                        ) : (
                          x.label
                        )}
                      </td>
                      <td className="r">
                        {editing ? (
                          <input type="number" min={0} max={100} value={x.pct} style={{ width: 64 }} aria-label="Percent" onChange={(e) => setMs(ms!.map((y, k) => (k === i ? { ...y, pct: Math.max(0, Number(e.target.value) || 0) } : y)))} />
                        ) : (
                          x.pct
                        )}
                      </td>
                      <td className="r num">{usd(Math.round((m.contract(job) * x.pct) / 100))}</td>
                      <td>{inv ? `Invoiced ${inv.number}, ${fmtShort(inv.invoicedOn)}` : real?.reachedOn ? <b>Reached {fmtShort(real.reachedOn)}, by {real.reachedBy}</b> : "Not reached"}</td>
                      <td>
                        {!ms && real && !inv && real.reachedOn && cb && (
                          <span className="row" style={{ gap: 6 }}>
                            <input value={f("mn" + real.id)} placeholder="Invoice no." style={{ width: 110 }} aria-label="Invoice number" onChange={(e) => set("mn" + real.id, e.target.value)} />
                            <button className="btn" onClick={() => run(() => repo.recordInvoice({ jobId: job.id, kind: "milestone", milestoneId: real.id, number: f("mn" + real.id) }), "Milestone invoice recorded.")}>
                              Record invoice
                            </button>
                          </span>
                        )}
                        {!ms && real && !real.reachedOn && job.status !== "complete" && canEditJob(viewer, job, "milestones") && (
                          <button className="btn sec" onClick={() => run(() => repo.markMilestoneReached(real.id), "Milestone marked reached.")}>
                            Mark reached
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td>Final invoice at customer sign-off</td>
                  <td className="r">{Math.max(0, 100 - (ms ? ms.reduce((a, x) => a + x.pct, 0) : m.milestoneTotal(job)))}</td>
                  <td className="r num">{usd(Math.round((m.contract(job) * Math.max(0, 100 - (ms ? ms.reduce((a, x) => a + x.pct, 0) : m.milestoneTotal(job)))) / 100))}</td>
                  <td>{m.finalInvoice(job) ? "Invoiced" : "At completion"}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          {msEdit && (
            <div className="row" style={{ marginTop: 8 }}>
              {ms ? (
                <>
                  <button className="btn sec" onClick={() => setMs([...ms, { label: "New milestone", pct: 0 }])}>
                    Add milestone
                  </button>
                  <button
                    className="btn"
                    onClick={async () => {
                      const items = ms.filter((x) => !(x.id && milestones.some((y) => y.id === x.id && m.milestoneInvoice(y))));
                      if (await run(() => repo.saveMilestones(job.id, items), "Milestones saved.")) setMs(null);
                    }}
                  >
                    Save milestones
                  </button>
                  <button className="btn sec" onClick={() => setMs(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="btn sec" onClick={() => setMs(milestones.map((x) => ({ id: x.id, label: x.label, pct: x.pct })))}>
                  Edit milestones
                </button>
              )}
              <span className="note">Milestones total {ms ? ms.reduce((a, x) => a + x.pct, 0) : m.milestoneTotal(job)}%. The rest bills at sign-off.</span>
            </div>
          )}
        </>
      )}

      {job.billingMethod === "final" && job.status !== "complete" && (
        <p className="note" style={{ margin: "10px 0 0" }}>
          One invoice for the full contract once the job is complete and the customer signs off.
        </p>
      )}
      {st === "ready" && cb && (
        <>
          <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Final invoice</h3>
          <div className="fg">
            <label className="field">
              Invoice number
              <input value={f("fn")} placeholder="From Sage" onChange={(e) => set("fn", e.target.value)} />
            </label>
            <label className="field">
              Invoice amount ($)
              <input value={f("fa", String(m.toBill(job) / 100))} inputMode="decimal" onChange={(e) => set("fa", e.target.value)} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => run(() => repo.recordInvoice({ jobId: job.id, kind: "final", number: f("fn"), amountCents: toCents(f("fa", String(m.toBill(job) / 100))) }), "Final invoice recorded.")}>
              Record invoice
            </button>
            <span className="note">
              Due {fmtShort(m.invoiceDue(job)!)}. Billed gross; the customer holds {job.retainagePct}% retainage.
            </span>
          </div>
        </>
      )}
      {m.retainageOutstanding(job) > 0 && cb && (
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field">
            Retainage received ($)
            <input
              inputMode="decimal"
              style={{ width: 120 }}
              value={f("ret", String(m.retainageOutstanding(job) / 100))}
              onChange={(e) => setForm({ ...form, ret: e.target.value })}
            />
          </label>
          <button
            className="btn"
            onClick={() => {
              const amt = toCents(f("ret", String(m.retainageOutstanding(job) / 100)));
              if (!Number.isFinite(amt) || amt <= 0) return void run(() => Promise.reject(new Error("Enter the amount received in dollars.")));
              void run(() => repo.recordRetainageReceived(job.id, amt), amt < m.retainageOutstanding(job) ? "Part of the retainage received." : "Retainage received.");
            }}
          >
            Record retainage received
          </button>
          <span className="note">
            {usd(m.retainageOutstanding(job))} held. Released at{" "}
            {job.retainageRelease === "substantial_completion" ? "substantial completion" : job.retainageRelease === "final_completion" ? "final completion" : job.retainageReleaseNote || "the contract’s terms"}.
          </span>
        </div>
      )}
      {st === "wait" && (
        <p className="note" style={{ margin: "10px 0 0" }}>
          The PM marks the final walk done in the job journey. That sends it to Ready to invoice.
        </p>
      )}

      <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Change orders</h3>
      {cos.length ? (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>CO</th>
                <th>Description</th>
                <th>Approved</th>
                <th className="r">Amount</th>
                <th className="r">Materials cost</th>
                <th className="r">Hours</th>
              </tr>
            </thead>
            <tbody>
              {cos.map((c) => (
                <tr key={c.id}>
                  <td>{c.number}</td>
                  <td>{c.description}</td>
                  <td>
                    {fmtShort(c.approvedOn)}
                    {c.approvedBy ? `, ${c.approvedBy}` : ""}
                  </td>
                  <td className="r num">{usd(c.amountCents)}</td>
                  <td className="r num">{usd(c.materialCostCents)}</td>
                  <td className="r num">{c.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="note" style={{ margin: 0 }}>
          None yet. Approved change orders add to the contract and the projected hours. Procore fills these once it is connected.
        </p>
      )}
      {canEditJob(viewer, job, "changeOrders") && job.status !== "complete" && (
        <div className="row" style={{ marginTop: 8 }}>
          <label className="field">
            CO number
            <input value={co.number} style={{ width: 90 }} onChange={(e) => setCo({ ...co, number: e.target.value })} />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 160 }}>
            Description
            <input value={co.description} onChange={(e) => setCo({ ...co, description: e.target.value })} />
          </label>
          <label className="field">
            Amount ($)
            <input value={co.amount} inputMode="decimal" style={{ width: 110 }} onChange={(e) => setCo({ ...co, amount: e.target.value })} />
          </label>
          <label className="field">
            Of which materials ($)
            <input value={co.material} inputMode="decimal" style={{ width: 110 }} onChange={(e) => setCo({ ...co, material: e.target.value })} />
          </label>
          <label className="field">
            Materials cost ($)
            <input value={co.materialCost} inputMode="decimal" style={{ width: 110 }} onChange={(e) => setCo({ ...co, materialCost: e.target.value })} />
          </label>
          <label className="field">
            Hours
            <input value={co.hours} inputMode="numeric" style={{ width: 70 }} onChange={(e) => setCo({ ...co, hours: e.target.value })} />
          </label>
          <label className="field">
            Approved by
            <input value={co.approvedBy} style={{ width: 140 }} placeholder="Customer contact" onChange={(e) => setCo({ ...co, approvedBy: e.target.value })} />
          </label>
          <label className="field">
            Approved on
            <input type="date" value={co.approvedOn} onChange={(e) => setCo({ ...co, approvedOn: e.target.value })} />
          </label>
          <button
            className="btn sec"
            disabled={!co.number.trim() || !co.amount.trim() || !co.approvedBy.trim() || !co.approvedOn}
            onClick={async () => {
              const amountCents = toCents(co.amount);
              const materialCents = co.material.trim() ? toCents(co.material) : 0;
              const materialCostCents = co.materialCost.trim() ? toCents(co.materialCost) : 0;
              if (![amountCents, materialCents, materialCostCents].every(Number.isFinite)) return void run(() => Promise.reject(new Error("Enter amounts in dollars.")));
              const ok = await run(
                () => repo.addChangeOrder({
                    jobId: job.id,
                    number: co.number.trim(),
                    description: co.description.trim(),
                    amountCents,
                    materialCents,
                    materialCostCents,
                    hours: Math.round(Number(co.hours) || 0),
                    approvedOn: co.approvedOn,
                    approvedBy: co.approvedBy.trim(),
                  }),
                "Change order added.",
              );
              if (ok) setCo({ number: "", description: "", amount: "", material: "", materialCost: "", hours: "", approvedBy: "", approvedOn: today });
            }}
          >
            Add approved CO
          </button>
        </div>
      )}

      {invs.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: "14px 0 6px" }}>Invoice history</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th className="r">Amount</th>
                  {job.retainagePct > 0 && <th className="r">Retainage held</th>}
                </tr>
              </thead>
              <tbody>
                {invs.map((i) => (
                  <tr key={i.id}>
                    <td>{i.number}</td>
                    <td>{i.kind === "progress" ? `Progress, ${monthLabel(i.period!, true)}` : i.kind === "milestone" ? `Milestone: ${milestones.find((x) => x.id === i.milestoneId)?.label ?? ""}` : "Final"}</td>
                    <td>{fmtShort(i.invoicedOn)}</td>
                    <td className="r num">{usd(i.amountCents)}</td>
                    {job.retainagePct > 0 && <td className="r num">{usd(i.retainageCents)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}
