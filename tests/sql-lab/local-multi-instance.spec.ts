import { expect, test } from "playwright/test";

const instanceA = requiredEnvironment("LOCAL_INSTANCE_A_URL").replace(/\/$/, "");
const instanceB = requiredEnvironment("LOCAL_INSTANCE_B_URL").replace(/\/$/, "");

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for the local multi-instance SQL Lab gate.`);
  }
  return value;
}

test("isolates local sessions for multiple ports in one browser context", async ({ page }) => {
  const sessionStatuses: number[] = [];
  page.on("response", (response) => {
    if (
      response.url().endsWith("/api/workspace/session") &&
      response.request().method() === "POST"
    ) {
      sessionStatuses.push(response.status());
    }
  });

  for (const baseUrl of [instanceA, instanceB, instanceA, instanceB]) {
    await page.goto(`${baseUrl}/sql-lab`);
    await expect(page.locator('[data-testid="sql-lab-state"]')).toHaveText("ready", {
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="sql-lab-schema"]')).not.toContainText(
      "DATABASE_UNAVAILABLE",
    );
  }

  expect(sessionStatuses.length).toBeGreaterThanOrEqual(4);
  expect(sessionStatuses.every((status) => status === 204)).toBe(true);
  const cookies = await page.context().cookies([instanceA, instanceB]);
  const sessionCookies = cookies.filter((cookie) =>
    /^web_ide_workspace_token_[a-f0-9]{16}$/.test(cookie.name),
  );
  expect(sessionCookies).toHaveLength(2);
  expect(new Set(sessionCookies.map((cookie) => cookie.name)).size).toBe(2);
  expect(sessionCookies.every((cookie) => cookie.httpOnly && cookie.path === "/")).toBe(true);
});
