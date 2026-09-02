import { expect, test } from "playwright/test";

const baseUrl = (process.env.S0_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

test("parses the fixed SQL statement inside the Tree-sitter Worker", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(`${baseUrl}/ide`);

  await expect(page.locator('[data-testid="tree-sitter-status"]')).toHaveText("ready", {
    timeout: 30_000,
  });
  await expect(page.locator('[data-testid="tree-sitter-parse-source"]')).toHaveText(
    "SELECT id, name FROM users WHERE active = true;",
  );
  await expect(page.locator('[data-testid="tree-sitter-root-type"]')).toHaveText("program");
  await expect(page.locator('[data-testid="tree-sitter-has-error"]')).toHaveText("false");
  await expect(page.locator('[data-testid="tree-sitter-tree-string"]')).toContainText("(program");

  expect(consoleErrors, "console.error messages").toEqual([]);
  expect(pageErrors, "uncaught page errors").toEqual([]);
});
