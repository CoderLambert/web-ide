import { expect, test } from "playwright/test";

const baseUrl = (process.env.S0_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

test("initializes web-tree-sitter in a disposable module Worker", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const workerUrls: string[] = [];
  const wasmResponses: Array<{ contentType: string | undefined; status: number; url: string }> = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("worker", (worker) => {
    if (worker.url().includes("tree-sitter-runtime.worker")) {
      workerUrls.push(worker.url());
    }
  });
  page.on("response", (response) => {
    if (/tree-sitter(?:-[^/?]+)?\.wasm(?:\?|$)/.test(response.url())) {
      wasmResponses.push({
        contentType: response.headers()["content-type"],
        status: response.status(),
        url: response.url(),
      });
    }
  });

  await page.goto(`${baseUrl}/ide`);

  const probe = page.locator('[data-testid="tree-sitter-runtime-probe"]');
  const status = page.locator('[data-testid="tree-sitter-status"]');
  const toggle = page.locator('[data-testid="tree-sitter-toggle"]');

  await expect(status).toHaveText("ready", { timeout: 30_000 });
  const initialInitializedCount = Number(await probe.getAttribute("data-initialized-count"));
  const initialTerminatedCount = Number(await probe.getAttribute("data-terminated-count"));
  const initialWorkerCount = workerUrls.length;

  expect(initialInitializedCount).toBeGreaterThanOrEqual(1);
  expect(initialWorkerCount).toBeGreaterThanOrEqual(1);
  expect(wasmResponses.length).toBeGreaterThanOrEqual(1);
  expect(
    wasmResponses.some(
      (response) => response.status === 200 && response.contentType?.includes("application/wasm"),
    ),
    `actual WASM responses: ${JSON.stringify(wasmResponses)}`,
  ).toBe(true);

  await toggle.click();

  await expect(status).toHaveText("terminated");
  await expect
    .poll(async () => Number(await probe.getAttribute("data-terminated-count")))
    .toBeGreaterThan(initialTerminatedCount);

  await toggle.click();
  await toggle.click();

  await expect(status).toHaveText("terminated");
  await page.waitForTimeout(250);
  await expect(status).toHaveText("terminated");

  await toggle.click();

  await expect(status).toHaveText("ready", { timeout: 30_000 });
  await expect
    .poll(async () => Number(await probe.getAttribute("data-initialized-count")))
    .toBeGreaterThan(initialInitializedCount);
  expect(workerUrls.length).toBeGreaterThan(initialWorkerCount);

  expect(consoleErrors, "console.error messages").toEqual([]);
  expect(pageErrors, "uncaught page errors").toEqual([]);
});
