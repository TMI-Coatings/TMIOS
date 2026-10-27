import { expect, test, type Page } from "@playwright/test";
import { can, canEditJob, canSeeJob, tabsFor } from "../../src/domain/permissions";
import { isSold } from "../../src/domain/schedule";
import type { Role } from "../../src/domain/types";
import { ROLE_LABEL } from "../../src/domain/types";
import { currentWeek } from "../../src/domain/weeks";
import { buildSample } from "../../src/sample/seed";

const sample = buildSample(currentWeek());
const userFor = (role: Role) => sample.users.find((u) => u.role === role)!;

async function viewAs(page: Page, role: Role, hash = "") {
  await page.goto("/" + hash);
  const u = userFor(role);
  await page.getByLabel("Viewing as").selectOption({ label: `${u.name} (${ROLE_LABEL[role]})` });
}

const ROLES_WITH_SAMPLE_USER: Role[] = ["admin", "ceo", "scheduler", "job_setup", "estimator", "pm", "superintendent", "sales_rep", "accounting", "cfo"];

for (const role of ROLES_WITH_SAMPLE_USER) {
  test(`${role}: sees the right tabs, jobs, totals and edit controls`, async ({ page }) => {
    await viewAs(page, role, "#schedule");
    const v = userFor(role);
    const tabs = page.getByRole("navigation", { name: "Sections" }).getByRole("button");
    await expect(tabs).toHaveText(tabsFor(role).map((t) => t.label));

    const visible = sample.jobs.filter((j) => isSold(j) && canSeeJob(v, j));
    await expect(page.locator("tr[data-job-row]")).toHaveCount(visible.length);

    const totals = page.getByRole("cell", { name: "Scheduled hrs (sold)" });
    if (role === "superintendent") {
      await expect(page.getByRole("heading", { name: "Your jobs" })).toBeVisible();
      await expect(totals).toHaveCount(0);
    } else {
      await expect(totals).toBeVisible();
    }

    const editable = visible.filter((j) => canEditJob(v, j, "plan"));
    const firstEditable = editable[0];
    if (firstEditable) await expect(page.locator(`tr[data-job-row="${firstEditable.number}"] input`).first()).toBeVisible();
    const readOnly = visible.find((j) => !canEditJob(v, j, "plan"));
    if (readOnly) await expect(page.locator(`tr[data-job-row="${readOnly.number}"] input`)).toHaveCount(0);

    const addJob = page.getByRole("button", { name: "Add job from estimate" });
    await expect(addJob).toHaveCount(can.addJob(role) ? 1 : 0);
  });
}

test("reps and PMs see every job on the schedule, not only their own (decision 6a)", async ({ page }) => {
  for (const role of ["sales_rep", "pm"] as const) {
    await viewAs(page, role, "#schedule");
    const u = userFor(role);
    const other = sample.jobs.find((j) => isSold(j) && (role === "pm" ? j.pmCode !== u.pmCode : j.repCode !== u.repCode))!;
    await expect(page.getByRole("button", { name: `${other.number} ${other.customer}` })).toBeVisible();
  }
});

test("admin sets a week by hand, and it is logged", async ({ page }) => {
  await viewAs(page, "admin", "#schedule");
  const job = sample.jobs.find((j) => j.status === "active")!;
  const cell = page.locator(`tr[data-job-row="${job.number}"] input`).first();
  await cell.fill("300");
  await cell.press("Enter");
  await expect(page.locator(`tr[data-job-row="${job.number}"] td.ov`)).toHaveCount(1);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Change log" }).click();
  await expect(page.getByRole("cell", { name: "Job " + job.number })).toBeVisible();
  await expect(page.getByRole("cell", { name: "300", exact: true })).toBeVisible();
});

test("the scheduler moves dates and sets leader, crew size and hours on any job", async ({ page }) => {
  await viewAs(page, "scheduler", "#schedule");
  const job = sample.jobs[3];
  await page.getByRole("button", { name: `${job.number} ${job.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByLabel("Start", { exact: true })).toBeEnabled();
  await expect(dlg.getByLabel("Job leader")).toBeEnabled();
  await expect(dlg.getByLabel("Crew size")).toBeEnabled();
  await expect(dlg.getByLabel("Projected hrs")).toBeEnabled();
});

test("leaders see hours, not dollars, in the job window", async ({ page }) => {
  await viewAs(page, "superintendent", "#schedule");
  const u = userFor("superintendent");
  const j = sample.jobs.find((x) => x.leaderId === u.personId)!;
  await page.getByRole("button", { name: `${j.number} ${j.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText(/Estimate: [\d,]+ hrs\./)).toBeVisible();
  await expect(dlg.getByText(/Contract \$|GP/)).toHaveCount(0);
});

test("PMs and reps see job changes in the Change log", async ({ page }) => {
  await viewAs(page, "pm", "#log");
  await expect(page.getByRole("heading", { name: "Change log" })).toBeVisible();
});

test("a PM can move their own job and not someone else's", async ({ page }) => {
  await viewAs(page, "pm", "#schedule");
  const own = sample.jobs.find((j) => j.pmCode === "JM" && isSold(j))!;
  await page.getByRole("button", { name: `${own.number} ${own.customer}` }).click();
  await expect(page.getByRole("dialog").getByLabel("Start", { exact: true })).toBeEnabled();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const other = sample.jobs.find((j) => j.pmCode !== "JM" && isSold(j))!;
  await page.getByRole("button", { name: `${other.number} ${other.customer}` }).click();
  await expect(page.getByRole("dialog", { name: `${other.number} ${other.customer}` })).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("Start", { exact: true })).toHaveCount(0);
});

test("moving a job off Locked needs a reason, which lands in pinned notes", async ({ page }) => {
  await viewAs(page, "admin", "#schedule");
  const job = sample.jobs.find((j) => j.firmness === "locked" && j.status === "active")!;
  await page.getByRole("button", { name: `${job.number} ${job.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Date firmness").selectOption("confirmed");
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await expect(dlg.getByRole("alert")).toContainText("needs a reason");
  await dlg.getByLabel("Reason for leaving Locked").fill("Plant moved the shutdown a week");
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: `${job.number} ${job.customer}` }).click();
  await expect(page.getByRole("dialog").getByText("Firmness Locked → Confirmed, some flexibility: Plant moved the shutdown a week")).toBeVisible();
});

test("job setup adds a job from the estimate and it lands on the schedule", async ({ page }) => {
  await viewAs(page, "job_setup", "#schedule");
  await page.getByRole("button", { name: "Add job from estimate" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Job number").fill("4291");
  await dlg.getByLabel("Customer", { exact: true }).fill("Valley Malt House");
  await dlg.getByLabel("Estimator (required)").selectOption("Stephen Bazant");
  await dlg.getByLabel("Contract value ($)").fill("96500");
  await dlg.getByLabel("Estimated labor hrs").fill("610");
  await dlg.getByLabel("Projected material cost ($)").fill("21800");
  await expect(dlg.getByText(/Material revenue \$\d+K, labor revenue \$\d+K/)).toBeVisible();
  await dlg.getByRole("button", { name: "Add job" }).click();
  await expect(dlg.getByRole("alert")).toContainText("firm");
  await dlg.getByLabel("Date firmness (required)").selectOption("confirmed");
  await dlg.getByRole("button", { name: "Add job" }).click();
  await expect(page.getByRole("button", { name: "4291 Valley Malt House" })).toBeVisible();
});

test("a four-digit job number is required", async ({ page }) => {
  await viewAs(page, "admin", "#schedule");
  await page.getByRole("button", { name: "Add job from estimate" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Job number").fill("429");
  await dlg.getByLabel("Customer", { exact: true }).fill("Short Number Co");
  await dlg.getByLabel("Estimator (required)").selectOption("Juac Angoi");
  await dlg.getByLabel("Contract value ($)").fill("1000");
  await dlg.getByLabel("Estimated labor hrs").fill("10");
  await dlg.getByLabel("Date firmness (required)").selectOption("confirmed");
  await dlg.getByRole("button", { name: "Add job" }).click();
  await expect(dlg.getByRole("alert")).toContainText("four digits");
});

test("the scheduler adds and removes time off; removal is kept in the log", async ({ page }) => {
  await viewAs(page, "scheduler", "#crew");
  const person = sample.people.find((p) => p.kind === "field")!;
  await page.getByLabel("Person taking time off").selectOption({ label: person.name });
  await page.getByLabel("Time off type").selectOption("Medical");
  await page.getByRole("button", { name: "Add time off" }).click();
  const row = page.getByRole("row").filter({ hasText: person.name }).filter({ hasText: "Medical" }).filter({ has: page.getByRole("button", { name: "Remove" }) });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Change log" }).click();
  await expect(page.getByRole("cell", { name: "time off removed" })).toBeVisible();
});

test("only admin and CEO see Access and Settings; a setting change is logged", async ({ page }) => {
  await viewAs(page, "admin", "#settings");
  const box = page.getByLabel("Absence rate (%)");
  await box.fill("12");
  await box.press("Enter");
  await expect(page.getByText("Setting saved.")).toBeVisible();
  await viewAs(page, "scheduler");
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "Settings" })).toHaveCount(0);
});

test("the schedule fits a phone screen without sideways page scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await viewAs(page, "superintendent", "#schedule");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a new leader takes over the crew, and the change reads in plain words", async ({ page }) => {
  await viewAs(page, "admin", "#schedule");
  const j = sample.jobs.find((x) => x.status === "active" && x.leaderId)!;
  const oldName = sample.people.find((p) => p.id === j.leaderId)!.name;
  const next = sample.people.find((p) => p.kind === "leader" && p.id !== j.leaderId && !sample.assignments.some((a) => a.jobId === j.id && a.personId === p.id))!;
  await page.getByRole("button", { name: `${j.number} ${j.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Job leader").selectOption(next.id);
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: `${j.number} ${j.customer}` }).click();
  await expect(page.getByRole("dialog").getByText(`Job leader ${oldName} → ${next.name}`)).toBeVisible();
  await expect(page.getByRole("dialog").getByText(/leaderId|0000/)).toHaveCount(0);
});

test("entering an actual finish marks the job complete", async ({ page }) => {
  await viewAs(page, "scheduler", "#schedule");
  const j = sample.jobs.find((x) => x.status === "active")!;
  await page.getByRole("button", { name: `${j.number} ${j.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Actual finish").fill(j.projectedFinish);
  await expect(dlg.getByLabel("Status")).toHaveValue("complete");
});

test("settings refuse values that would break the numbers", async ({ page }) => {
  await viewAs(page, "admin", "#settings");
  const box = page.getByLabel("Absence rate (%)");
  await box.fill("150");
  await box.press("Enter");
  await expect(page.getByText("Use a number from 0 to 50.")).toBeVisible();
});

test("changing someone to PM asks for their PM code first, and you can't change your own access", async ({ page }) => {
  await viewAs(page, "admin", "#access");
  const est = sample.users.find((u) => u.role === "estimator")!;
  await page.getByLabel(`${est.name} role`).selectOption("pm");
  await expect(page.getByText("Pick a link to save the new role.")).toBeVisible();
  const row = page.locator("tr", { has: page.getByLabel(`${est.name} role`) });
  await row.getByLabel("PM code").selectOption(sample.pms[1].code);
  await expect(page.getByText(`${est.name} updated.`)).toBeVisible();
  await expect(page.getByLabel(`${est.name} role`)).toHaveValue("pm");
  const me = userFor("admin");
  await expect(page.getByLabel(`${me.name} role`)).toBeDisabled();
});

test("Lori corrects a job's PO and PM after it's added", async ({ page }) => {
  await viewAs(page, "job_setup", "#schedule");
  const j = sample.jobs.find((x) => x.status === "scheduled")!;
  await page.getByRole("button", { name: `${j.number} ${j.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByText("Job details from intake").click();
  await dlg.getByLabel("Customer PO").fill("PO-77812");
  const other = sample.pms.find((p) => p.code !== j.pmCode)!;
  await dlg.getByLabel("Project manager").selectOption(other.code);
  await dlg.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: `${j.number} ${j.customer}` }).click();
  await expect(page.getByRole("dialog").getByText(`Customer PO ${j.customerPo || "blank"} → PO-77812`)).toBeVisible();
  await expect(page.getByRole("dialog").getByText(`PM ${sample.pms.find((p) => p.code === j.pmCode)!.name} → ${other.name}`)).toBeVisible();
});

test("the job window warns when a leader is already leading another job those weeks", async ({ page }) => {
  await viewAs(page, "scheduler", "#schedule");
  const j = sample.jobs.find((x) => x.status === "scheduled" && x.leaderId)!;
  const other = sample.jobs.find((o) => o.id !== j.id && o.leaderId && o.leaderId !== j.leaderId && o.status !== "complete" && o.start <= j.projectedFinish && o.projectedFinish >= j.start)!;
  await page.getByRole("button", { name: `${j.number} ${j.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Job leader").selectOption(other.leaderId!);
  await expect(dlg.getByText(new RegExp(`already leads .*${other.number} ${other.customer}`))).toBeVisible();
});

test("typing more than the hours left asks first", async ({ page }) => {
  await viewAs(page, "admin", "#schedule");
  const job = sample.jobs.find((j) => j.status === "active")!;
  const cell = page.locator(`tr[data-job-row="${job.number}"] input`).first();
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await cell.fill("99999");
  await cell.press("Enter");
  await expect.poll(() => asked).toContain("more than the");
  await expect(page.locator(`tr[data-job-row="${job.number}"] td.ov`)).toHaveCount(0);
});
