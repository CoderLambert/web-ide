import { expect, test, type Page } from "playwright/test";

const baseUrl = (process.env.S0_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function navigateClientSide(page: Page, pathname: string) {
  await page.evaluate((nextPathname) => {
    const key = crypto.randomUUID();
    const currentIndex = history.state?.__TSR_index ?? 0;

    history.pushState(
      {
        ...history.state,
        __TSR_index: currentIndex + 1,
        __TSR_key: key,
        key,
      },
      "",
      nextPathname,
    );
  }, pathname);
}

test("creates, disposes, and remounts Monaco without browser errors", async ({ page }) => {
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

  const lifecyclePage = page.locator('[data-testid="monaco-lifecycle-page"]');
  const toggle = page.locator('[data-testid="monaco-toggle"]');
  const status = page.locator('[data-testid="monaco-status"]');
  const host = page.locator('[data-testid="monaco-editor-host"]');

  await expect(status).toHaveText("ready", { timeout: 30_000 });
  await expect(lifecyclePage).toHaveAttribute("data-created-count", "1");
  await expect(lifecyclePage).toHaveAttribute("data-disposed-count", "0");
  await expect(host).toHaveCount(1);

  await toggle.click();

  await expect(status).toHaveText("disposed");
  await expect(lifecyclePage).toHaveAttribute("data-created-count", "1");
  await expect(lifecyclePage).toHaveAttribute("data-disposed-count", "1");
  await expect(host).toHaveCount(0);

  await toggle.click();

  await expect(status).toHaveText("ready", { timeout: 30_000 });
  await expect(lifecyclePage).toHaveAttribute("data-created-count", "2");
  await expect(lifecyclePage).toHaveAttribute("data-disposed-count", "1");
  await expect(host).toHaveCount(1);

  await navigateClientSide(page, "/");

  await expect(page).toHaveURL(`${baseUrl}/`);
  await expect(lifecyclePage).toHaveCount(0);

  await navigateClientSide(page, "/ide");

  await expect(page).toHaveURL(`${baseUrl}/ide`);
  await expect(status).toHaveText("ready", { timeout: 30_000 });
  await expect(lifecyclePage).toHaveAttribute("data-created-count", "1");
  await expect(lifecyclePage).toHaveAttribute("data-disposed-count", "0");
  await expect(host).toHaveCount(1);

  await page.waitForTimeout(250);
  expect(consoleErrors, "console.error messages").toEqual([]);
  expect(pageErrors, "uncaught page errors").toEqual([]);
});
