import { expect, test } from "playwright/test";

const baseUrl = (process.env.S0_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

test("binds a real Monaco model to the syntax worker", async ({ page }) => {
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

  const probe = page.locator('[data-testid="m1-monaco-syntax-binding"]');
  const state = page.locator('[data-testid="m1-monaco-syntax-state"]');
  const editor = page.locator('[data-testid="m1-monaco-syntax-editor-host"] .monaco-editor');

  await expect(state).toHaveText("ready", { timeout: 30_000 });
  await expect(probe).toHaveAttribute("data-document-version", "1");
  await expect(probe).toHaveAttribute("data-has-errors", "false");

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" ");

  await expect
    .poll(async () => Number(await probe.getAttribute("data-document-version")))
    .toBeGreaterThan(1);
  await expect(state).toHaveText("ready", { timeout: 30_000 });
  await expect(probe).toHaveAttribute("data-parse-time-ms", /\d/);

  await page.waitForTimeout(250);
  expect(consoleErrors, "console.error messages").toEqual([]);
  expect(pageErrors, "uncaught page errors").toEqual([]);
});
