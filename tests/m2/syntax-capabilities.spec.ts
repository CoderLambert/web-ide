import { expect, test, type Locator } from "playwright/test";

const baseUrl = (process.env.S0_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

async function expectCurrentCapabilities(probe: Locator) {
  await expect
    .poll(async () => {
      const attributes = await probe.evaluate((element) => ({
        document: element.getAttribute("data-document-version"),
        highlight: element.getAttribute("data-highlight-version"),
        folding: element.getAttribute("data-folding-version"),
      }));
      return attributes.document !== null &&
        attributes.document === attributes.highlight &&
        attributes.document === attributes.folding
        ? attributes.document
        : "";
    })
    .toMatch(/\d/);
}

test("runs highlight, folding, and selection capabilities on a real SQL model", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/ide`);
  const probe = page.locator('[data-testid="m2-syntax-capabilities"]');
  await expect(page.locator('[data-testid="m2-syntax-state"]')).toHaveText("ready", {
    timeout: 30_000,
  });
  await expectCurrentCapabilities(probe);

  await probe.locator('[data-testid="m2-request-selection"]').click();
  await expect
    .poll(async () => Number(await probe.getAttribute("data-selection-count")))
    .toBeGreaterThan(0);
  await expect(probe).toHaveAttribute(
    "data-selection-version",
    (await probe.getAttribute("data-document-version")) ?? "",
  );
  expect(consoleErrors, "console.error messages").toEqual([]);
  expect(pageErrors, "uncaught page errors").toEqual([]);
});

test("keeps derived capability work bounded across edits, invalid SQL, and 100KB/1MB diagnostics", async ({
  page,
}) => {
  await page.goto(`${baseUrl}/ide`);
  const probe = page.locator('[data-testid="m2-syntax-capabilities"]');
  const state = page.locator('[data-testid="m2-syntax-state"]');
  await expect(state).toHaveText("ready", { timeout: 30_000 });

  await probe.locator('[data-testid="m2-rapid-edit"]').click();
  await expect
    .poll(async () => Number(await probe.getAttribute("data-document-version")))
    .toBeGreaterThan(1);
  await expectCurrentCapabilities(probe);
  expect(Number(await probe.getAttribute("data-derived-pending"))).toBeLessThanOrEqual(2);

  await probe.locator('[data-testid="m2-invalid-sql"]').click();
  await expect(probe).toHaveAttribute("data-has-errors", "true", { timeout: 30_000 });
  await expectCurrentCapabilities(probe);

  await probe.locator('[data-testid="m2-load-100kb"]').click();
  await expect(probe).toHaveAttribute("data-large-source-size", String(100 * 1024));
  await expectCurrentCapabilities(probe);
  await expect(probe).toHaveAttribute("data-derived-pending", "0", { timeout: 30_000 });

  await probe.locator('[data-testid="m2-load-1mb"]').click();
  await expect(probe).toHaveAttribute("data-large-source-size", String(1024 * 1024));
  await expectCurrentCapabilities(probe);
  await expect(probe).toHaveAttribute("data-derived-pending", "0", { timeout: 30_000 });
});

test("rebuilds capabilities after Worker recovery and route remount", async ({ page }) => {
  await page.goto(`${baseUrl}/ide?m2RecoveryTest=1`);
  const probe = page.locator('[data-testid="m2-syntax-capabilities"]');
  const state = page.locator('[data-testid="m2-syntax-state"]');
  await expect(state).toHaveText("ready", { timeout: 30_000 });
  await expect(probe).toHaveAttribute("data-worker-generation", "1");
  await expectCurrentCapabilities(probe);

  const versionBeforeRecovery = await probe.getAttribute("data-document-version");
  await probe.locator('[data-testid="m2-inject-worker-failure"]').click();
  await expect(probe).toHaveAttribute("data-worker-generation", "2", { timeout: 30_000 });
  await expect(state).toHaveText("ready", { timeout: 30_000 });
  if (versionBeforeRecovery === null) {
    throw new Error("M2 recovery probe did not expose a document version.");
  }
  await expect(probe).toHaveAttribute("data-document-version", versionBeforeRecovery);
  await expectCurrentCapabilities(probe);

  await page.goto(`${baseUrl}/`);
  await expect(probe).toHaveCount(0);
  await page.goto(`${baseUrl}/ide?m2RecoveryTest=1`);
  const remountedProbe = page.locator('[data-testid="m2-syntax-capabilities"]');
  await expect(page.locator('[data-testid="m2-syntax-state"]')).toHaveText("ready", {
    timeout: 30_000,
  });
  await expect(remountedProbe).toHaveAttribute("data-worker-generation", "1");
  await expectCurrentCapabilities(remountedProbe);
});
