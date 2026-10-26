import { expect, test } from "@playwright/test";
import { tab, viewAs } from "./helpers";

test("the scorecard ranks leaders and a PM tags an overrun cause on their own job", async ({ page }) => {
  await viewAs(page, "pm", "#scorecard");
  await expect(page.getByRole("heading", { name: "Leader scorecard" })).toBeVisible();
  const leaderRow = page.locator("tr[data-leader]").first();
  await leaderRow.click();
  const select = page.getByLabel(/^Cause of overrun/).first();
  await select.selectOption("Weather");
  await expect(page.getByText("Cause tagged.")).toBeVisible();
});

test("a leader sees only their own scorecard", async ({ page }) => {
  await viewAs(page, "superintendent", "#scorecard");
  await expect(page.getByRole("heading", { name: "My scorecard" })).toBeVisible();
  await expect(page.locator("tr[data-leader]")).toHaveCount(1);
  await expect(page.locator("tr[data-leader]")).toHaveAttribute("data-leader", "Mike Ramirez");
});

test("the board view shows the four trends and exports the pack", async ({ page }) => {
  await viewAs(page, "ceo", "#board");
  for (const name of ["Crew utilization by week", "Sold backlog in weeks", "Forecast accuracy by week", "On-time completion by week"]) await expect(page.getByRole("img", { name })).toBeVisible();
  await expect(page.getByText("Changes logged with name and time")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { printed: boolean }).printed = false;
    window.print = () => {
      (window as unknown as { printed: boolean }).printed = true;
    };
  });
  await page.getByRole("button", { name: "Export board pack (PDF)" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: boolean }).printed)).toBe(true);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header.top")).toBeHidden();
  await expect(page.getByText("TMI Coatings · Board pack")).toBeVisible();
});

test("closing a week lands on the board as a real data point", async ({ page }) => {
  await viewAs(page, "scheduler", "#close");
  await page.getByRole("button", { name: "Import from time system" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Close week and roll forward" }).click();
  await expect(page.getByText(/Schedule rolled to week ending/)).toBeVisible();
  await viewAs(page, "admin", "#board");
  await expect(page.getByText(/the last 1 come from weeks closed in the app/)).toBeVisible();
  await tab(page, "Leader scorecard").click();
  await expect(page.getByRole("heading", { name: "Leader scorecard" })).toBeVisible();
});
