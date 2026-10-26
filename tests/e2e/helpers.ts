import type { Page } from "@playwright/test";
import type { Role } from "../../src/domain/types";
import { ROLE_LABEL } from "../../src/domain/types";
import { currentWeek } from "../../src/domain/weeks";
import { buildSample } from "../../src/sample/seed";

export const sample = buildSample(currentWeek());
export const userFor = (role: Role) => sample.users.find((u) => u.role === role)!;

export async function viewAs(page: Page, role: Role, hash = "") {
  await page.goto("/" + hash);
  const u = userFor(role);
  await page.getByLabel("Viewing as").selectOption({ label: `${u.name} (${ROLE_LABEL[role]})` });
}

export const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name, exact: true });
