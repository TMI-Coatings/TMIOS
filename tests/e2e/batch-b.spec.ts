import { expect, test } from "@playwright/test";
import { sample, viewAs } from "./helpers";

const mva = sample.jobs[13]; // Minnesota Valley Ag: waiting on estimator Stephen Bazant
const owatonna = sample.jobs[11]; // City of Owatonna: waiting on rep Eric Rich
const awaiting = sample.jobs[18]; // Riverbend Ethanol phase 2: awaiting a draft

test("the estimator's queue shows their draft; signing off moves it to the rep", async ({ page }) => {
  await viewAs(page, "estimator", "#wo");
  await expect(page.getByRole("heading", { name: "Your queue: drafts to check against the estimate" })).toBeVisible();
  const queue = page.locator("table").first();
  await queue.getByRole("button", { name: `${mva.number} ${mva.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Sign off: hours and scope" }).click();
  await expect(page.getByText("Signed off.")).toBeVisible();
  await expect(page.locator(`tr[data-wo-row="${mva.number}"]`).first()).toContainText(/Rep /);
});

test("sending back needs a comment, then goes back to Lori", async ({ page }) => {
  await viewAs(page, "sales_rep", "#wo");
  await page.locator("table").first().getByRole("button", { name: `${owatonna.number} ${owatonna.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Send back to Lori" }).click();
  await expect(page.getByRole("alert")).toContainText("comment");
  await dlg.getByLabel("Work order comment").fill("Retainage terms don't match the contract.");
  await dlg.getByRole("button", { name: "Send back to Lori" }).click();
  await expect(page.getByText("Sent back to Lori.")).toBeVisible();
  await viewAs(page, "job_setup", "#wo");
  await expect(page.locator("table").first().getByRole("button", { name: `${owatonna.number} ${owatonna.customer}` })).toBeVisible();
});

test("Lori uploads a draft and the estimator is alerted", async ({ page }) => {
  await viewAs(page, "job_setup", "#wo");
  await page.locator("table").first().getByRole("button", { name: `${awaiting.number} ${awaiting.customer}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Upload draft" }).click();
  await expect(page.getByText("Draft uploaded. The estimator is up first.")).toBeVisible();
  await viewAs(page, "admin", "#alerts");
  await expect(page.getByText(new RegExp(`Draft work order ready for review: ${awaiting.number}`))).toBeVisible();
});

test("work order status shows on the schedule", async ({ page }) => {
  await viewAs(page, "admin", "#schedule");
  await expect(page.locator(`tr[data-job-row="${sample.jobs[14].number}"]`)).toContainText("Work order: returned");
});

test("the journey board, a PM ticking a checkpoint, and an admin re-timing one", async ({ page }) => {
  await viewAs(page, "pm", "#journey");
  await expect(page.locator('[data-stage="sold"]')).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your checkpoints, next 2 weeks" })).toBeVisible();
  const first = page.locator("table").first().getByRole("button", { name: "Mark done" }).first();
  await first.click();
  await expect(page.getByText("Marked done.")).toBeVisible();
  await viewAs(page, "admin", "#journey");
  const days = page.getByLabel("Lifts, rentals, trucks and hotels booked days");
  await days.fill("-10");
  await days.blur();
  await expect(page.getByText("Checkpoint saved.")).toBeVisible();
  await viewAs(page, "scheduler", "#journey");
  await expect(page.getByLabel("Lifts, rentals, trucks and hotels booked days")).toHaveCount(0);
});

test("the job window shows the journey and the work order", async ({ page }) => {
  await viewAs(page, "admin", "#schedule");
  await page.getByRole("button", { name: `${owatonna.number} ${owatonna.customer}` }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText(/^Job journey:/)).toBeVisible();
  await expect(dlg.getByLabel("Work order", { exact: true })).toContainText("Acting for Eric Rich");
});
