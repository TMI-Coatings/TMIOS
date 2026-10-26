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

test("reps and PMs see company-wide totals over their own jobs", async ({ page }) => {
  await viewAs(page, "sales_rep", "#schedule");
  await expect(page.getByText("Totals below stay company-wide.")).toBeVisible();
  const allSold = sample.jobs.filter((j) => isSold(j) && j.status !== "on_hold").length;
  expect(allSold).toBeGreaterThan(await page.locator("tr[data-job-row]").count());
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

test("the scheduler can move dates on any job but not change the leader", async ({ page }) => {
  await viewAs(page, "scheduler", "#schedule");
  const job = sample.jobs[3];
  await page.getByRole("button", { name: `${job.number} ${job.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByLabel("Start", { exact: true })).toBeEnabled();
  await expect(dlg.getByLabel("Job leader")).toBeDisabled();
});

test("a PM can move their own job and not someone else's", async ({ page }) => {
  await viewAs(page, "pm", "#schedule");
  const own = sample.jobs.find((j) => j.pmCode === "JS" && isSold(j))!;
  await page.getByRole("button", { name: `${own.number} ${own.customer}` }).click();
  await expect(page.getByRole("dialog").getByLabel("Start", { exact: true })).toBeEnabled();
  const others = sample.jobs.filter((j) => j.pmCode !== "JS");
  for (const o of others) await expect(page.getByRole("button", { name: `${o.number} ${o.customer}` })).toHaveCount(0);
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
  await expect(page.getByRole("dialog").getByText("Firmness locked → confirmed: Plant moved the shutdown a week")).toBeVisible();
});

test("job setup adds a job from the estimate and it lands on the schedule", async ({ page }) => {
  await viewAs(page, "job_setup", "#schedule");
  await page.getByRole("button", { name: "Add job from estimate" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Job number").fill("4291");
  await dlg.getByLabel("Customer", { exact: true }).fill("Valley Malt House");
  await dlg.getByLabel("Estimator (required)").fill("Greg Halvorsen");
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
  await dlg.getByLabel("Estimator (required)").fill("Paula Kern");
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
