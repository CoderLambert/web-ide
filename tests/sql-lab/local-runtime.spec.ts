import { expect, test } from "playwright/test";

const baseUrl = requiredEnvironment("S0_BASE_URL").replace(/\/$/, "");

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for the local SQL Lab smoke gate.`);
  }
  return value;
}

test("opens SQL Lab with clean local runtime defaults", async ({ page }) => {
  const schemaResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/sql-lab") && response.request().method() === "POST",
  );
  await page.goto(`${baseUrl}/sql-lab`);
  expect((await schemaResponse).status()).toBe(200);
  await expect(page.locator('[data-testid="sql-lab-state"]')).toHaveText("ready", {
    timeout: 30_000,
  });

  const sessionCookie = (await page.context().cookies(baseUrl)).find(
    (cookie) => cookie.name === "web_ide_workspace_token",
  );
  expect(sessionCookie).toMatchObject({
    httpOnly: true,
    name: "web_ide_workspace_token",
    path: "/",
    sameSite: "Strict",
  });

  await expect(page.locator('[data-testid="sql-lab-schema"]')).not.toContainText(
    "DATABASE_UNAVAILABLE",
  );
});
