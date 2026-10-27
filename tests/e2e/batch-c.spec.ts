import { expect, test, type Locator } from "@playwright/test";
import { sample, viewAs } from "./helpers";

const byNum = (n: string) => sample.jobs.find((j) => j.number === n)!;
// The billing section is the first collapsible section in the job window.
const openBilling = (dlg: Locator) => dlg.locator("details.wobox").first().evaluate((el) => ((el as HTMLDetailsElement).open = true));

test("a PM enters this week's percent complete on the WIP schedule", async ({ page }) => {
  await viewAs(page, "pm", "#revenue");
  const j = sample.jobs.find((x) => x.pmCode === "JM" && x.status === "active")!;
  const box = page.getByLabel(`Labor percent complete ${j.customer}`);
  await box.fill("55");
  await box.press("Enter");
  await expect(page.getByText("Saved for this week’s meeting.")).toBeVisible();
  await expect(page.getByLabel(`Labor percent complete ${j.customer}`)).toHaveValue("55");
});

test("revenue chart and table, monthly and weekly", async ({ page }) => {
  await viewAs(page, "cfo", "#revenue");
  await expect(page.getByRole("img", { name: "Recognized and forecast revenue by period" })).toBeVisible();
  await page.getByRole("button", { name: "Weekly", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Week ending" })).toBeVisible();
});

test("accounting records the final invoice for a signed-off job, then retainage", async ({ page }) => {
  await viewAs(page, "accounting", "#billing");
  const ready = page.locator('[data-billcol="ready"]');
  await ready.getByRole("button", { name: /4051 Dakota Ridge Ethanol/ }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Record invoice" }).click();
  await expect(page.getByRole("alert")).toContainText("invoice number");
  await dlg.getByPlaceholder("From Sage").fill("26-2002");
  await dlg.getByRole("button", { name: "Record invoice" }).click();
  await expect(page.getByText("Final invoice recorded.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-billcol="closed"]')).toContainText("4051 Dakota Ridge Ethanol");
  await page.locator('[data-billcol="ret"]').getByRole("button", { name: /4072 Mankato Water Treatment/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Retainage received" }).click();
  await expect(page.getByRole("status")).toHaveText("Retainage received.");
});

test("a PM marks a milestone reached and adds a change order; reps can't record invoices", async ({ page }) => {
  await viewAs(page, "pm", "#schedule");
  const riverbend = sample.jobs[1];
  await page.getByRole("button", { name: `${riverbend.number} ${riverbend.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await openBilling(dlg);
  await dlg.getByRole("button", { name: "Mark reached" }).click();
  await expect(page.getByText("Milestone marked reached.")).toBeVisible();
  await dlg.getByLabel("CO number").fill("CO-3");
  await dlg.getByLabel("Description").fill("Extra coat on tank 2");
  await dlg.getByLabel("Amount ($)").fill("12000");
  await dlg.getByLabel("Hours").fill("40");
  await dlg.getByRole("button", { name: "Add approved CO" }).click();
  await expect(page.getByText("Change order added.")).toBeVisible();
  await expect(dlg.getByRole("cell", { name: "Extra coat on tank 2" })).toBeVisible();
  await viewAs(page, "sales_rep", "#schedule");
  const own = sample.jobs.find((j) => j.repCode === "ER")!;
  await page.getByRole("button", { name: `${own.number} ${own.customer}` }).click();
  await openBilling(page.getByRole("dialog"));
  await expect(page.getByRole("dialog").getByRole("button", { name: /Record/ })).toHaveCount(0);
});

test("estimators don't see money", async ({ page }) => {
  await viewAs(page, "estimator", "#schedule");
  await page.getByRole("button", { name: `${sample.jobs[0].number} ${sample.jobs[0].customer}` }).click();
  await expect(page.getByRole("dialog").getByText(/^Billing:/)).toHaveCount(0);
  await expect(page.getByRole("dialog").getByText("Recognized")).toHaveCount(0);
});

test("finished jobs stay off the schedule", async ({ page }) => {
  await viewAs(page, "admin", "#schedule");
  await expect(page.getByRole("button", { name: /4079 Ag Partners Co-op/ })).toHaveCount(0);
  expect(byNum("4079").status).toBe("complete");
});
