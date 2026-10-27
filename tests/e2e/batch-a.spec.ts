import { expect, test } from "@playwright/test";
import { sample, tab, userFor, viewAs } from "./helpers";

test("the dashboard shows KPIs, both charts and what needs attention", async ({ page }) => {
  await viewAs(page, "admin", "#dashboard");
  await expect(page.getByText("Leaders needed / available")).toBeVisible();
  await expect(page.getByRole("img", { name: "Scheduled hours against available hours by week" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Leaders needed against leaders available by week" })).toBeVisible();
  const att = page.locator("ul.att li");
  await expect(att.filter({ hasText: "Overrun" }).first()).toBeVisible();
  await att.filter({ hasText: "Overrun" }).first().getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("a PM enters hours for their own jobs only; the scheduler sees them at the close", async ({ page }) => {
  await viewAs(page, "pm", "#close");
  const pmRows = page.locator("tr[data-close-row]");
  const own = sample.jobs.filter((j) => j.pmCode === "JM");
  await expect(page.getByRole("heading", { name: /Hours for week ending/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close week and roll forward" })).toHaveCount(0);
  const first = pmRows.first();
  const num = (await first.getAttribute("data-close-row"))!;
  expect(own.map((j) => j.number)).toContain(num);
  await first.getByRole("spinbutton").fill("123");
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByText("Hours saved.")).toBeVisible();
  await viewAs(page, "scheduler", "#close");
  await expect(page.locator(`tr[data-close-row="${num}"]`).getByRole("spinbutton")).toHaveValue("123");
});

test("the scheduler imports, reviews and closes the week; the schedule rolls forward", async ({ page }) => {
  await viewAs(page, "scheduler", "#close");
  await page.getByRole("button", { name: "Import from time system" }).click();
  await expect(page.getByText(/Not on the schedule: 4999/)).toBeVisible();
  await expect(page.locator("tr.exc").first()).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Close week and roll forward" }).click();
  await expect(page.getByText(/closed\..*jobs entered/)).toBeVisible();
  await expect(page.getByText(/Schedule rolled to week ending/)).toBeVisible();
  await tab(page, "Alerts").click();
  await expect(page.getByText(/Monday digest for the week of/).first()).toBeVisible();
  await expect(page.getByText(/Overrun warning:/).first()).toBeVisible();
});

test("a leader confirms their crews and sees their week", async ({ page }) => {
  await viewAs(page, "superintendent", "#schedule");
  await page.getByRole("button", { name: "Confirm my crews" }).click();
  await expect(page.getByText("Crews confirmed.")).toBeVisible();
  await expect(page.locator(".panel .tag.grn", { hasText: "Confirmed" })).toBeVisible();
  await tab(page, "My week").click();
  await expect(page.getByRole("heading", { name: "Mike’s week" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open in Maps" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).first().click();
  await expect(page.getByText(/You acknowledged this week/)).toBeVisible();
});

test("alerts are filtered by role and each person can mute a rule", async ({ page }) => {
  await viewAs(page, "accounting", "#alerts");
  await expect(page.getByText(/Open capacity to sell/)).toHaveCount(0);
  await viewAs(page, "sales_rep", "#alerts");
  await expect(page.getByText(/Open capacity to sell/).first()).toBeVisible();
  await page.getByLabel("Open capacity alerts on").uncheck();
  await expect(page.getByText(/Open capacity to sell/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send Monday digest now" })).toHaveCount(0);
});

test("crew auto-fill shows a preview before assigning anyone", async ({ page }) => {
  await viewAs(page, "scheduler", "#crew");
  await page.getByRole("button", { name: "Preview auto-fill" }).click();
  const preview = page.getByRole("region", { name: "Auto-fill preview" });
  await expect(preview).toBeVisible();
  if (await preview.getByRole("button", { name: "Assign all" }).count()) {
    await preview.getByRole("button", { name: "Assign all" }).click();
    await expect(page.getByText(/people assigned for the week ending/)).toBeVisible();
  }
});

test("fill to crew size in the job window proposes, then adds on accept", async ({ page }) => {
  await viewAs(page, "admin", "#schedule");
  const job = sample.jobs.find((j) => j.status === "scheduled" && j.crewSize >= 6)!;
  await page.getByRole("button", { name: `${job.number} ${job.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Remove" }).first().click();
  await dlg.getByRole("button", { name: "Fill to crew size" }).click();
  await expect(dlg.getByRole("region", { name: "Proposed crew" })).toContainText("Nothing is assigned until you accept");
  await dlg.getByRole("button", { name: /Add these/ }).click();
  await expect(page.getByText(/added to the crew/)).toBeVisible();
});

test("field crew only get My week and Alerts", async ({ page }) => {
  await page.goto("/");
  expect(userFor("admin")).toBeTruthy();
  // Field crew sign-ins are leaders-only in Phase 1; the sample has none, so check the tab rules directly.
  const { tabsFor } = await import("../../src/domain/permissions");
  expect(tabsFor("field_crew").map((t) => t.id)).toEqual(["me", "alerts"]);
});

test("sales reps see company capacity to sell into, without other reps' jobs or money", async ({ page }) => {
  await viewAs(page, "sales_rep", "#dashboard");
  await expect(page.getByRole("heading", { name: "Capacity to sell" })).toBeVisible();
  await expect(page.getByText(/Open hrs in the sell window/)).toBeVisible();
  await expect(page.getByRole("img", { name: "Scheduled hours against available hours by week" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Open capacity by week" }).locator("tbody tr")).toHaveCount(13);
  const others = sample.jobs.filter((j) => j.repCode !== userFor("sales_rep").repCode);
  await expect(page.getByText(others[0].customer)).toHaveCount(0);
  await expect(page.getByText("$")).toHaveCount(0);
});

test("the import asks before replacing hours a PM typed in", async ({ page }) => {
  await viewAs(page, "pm", "#close");
  const first = page.locator("tr[data-close-row]").first();
  const num = (await first.getAttribute("data-close-row"))!;
  await first.getByRole("spinbutton").fill("123");
  await page.getByRole("button", { name: "Save hours" }).click();
  await expect(page.getByText("Hours saved.")).toBeVisible();
  await viewAs(page, "scheduler", "#close");
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.getByRole("button", { name: "Import from time system" }).click();
  await expect(page.getByText(/jobs matched/)).toBeVisible();
  expect(asked).toContain(`${num} (123 hrs)`);
  await expect(page.locator(`tr[data-close-row="${num}"]`).getByRole("spinbutton")).toHaveValue("123");
});

test("each person's alert rules list only what can reach them, with today's settings", async ({ page }) => {
  await viewAs(page, "superintendent", "#alerts");
  await expect(page.getByLabel("Billing alerts on")).toHaveCount(0);
  await expect(page.getByLabel("Work order alerts on")).toHaveCount(0);
  await expect(page.getByText(`expiring in ${sample.settings.certFirstDays} or ${sample.settings.certSecondDays} days`)).toBeVisible();
  await viewAs(page, "accounting", "#alerts");
  await expect(page.getByLabel("Billing alerts on")).toBeVisible();
  await expect(page.getByLabel("Capacity gap alerts on")).toHaveCount(0);
});

test("the scheduler enters a real expiry date for a certification", async ({ page }) => {
  await viewAs(page, "scheduler", "#crew");
  const p = sample.people.find((x) => Object.keys(x.quals).length > 0)!;
  const q = Object.keys(p.quals)[0];
  const box = page.getByLabel(`${p.name} ${q} expires`);
  await box.fill("2027-03-31");
  await box.blur();
  await expect(page.getByLabel(`${p.name} ${q} expires`)).toHaveValue("2027-03-31");
});
