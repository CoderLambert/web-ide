import { expect, test } from "playwright/test";

const baseUrl = (process.env.S0_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const recoveryUrl = `${baseUrl}/ide?m1RecoveryTest=1`;

test("recovers a real Worker and continues parsing the Monaco document", async ({ page }) => {
  await page.goto(recoveryUrl);

  const probe = page.locator('[data-testid="m1-monaco-syntax-binding"]');
  const state = page.locator('[data-testid="m1-monaco-syntax-state"]');
  const editor = page.locator('[data-testid="m1-monaco-syntax-editor-host"] .monaco-editor');
  const failureButton = page.locator('[data-testid="m1-inject-worker-failure"]');
  const applyEditButton = page.locator('[data-testid="m1-apply-probe-edit"]');
  const inspectButton = page.locator('[data-testid="m1-ast-inspect"]');
  const inspection = page.locator('[data-testid="m1-ast-inspect-result"]');

  await expect(state).toHaveText("ready", { timeout: 30_000 });
  await expect(probe).toHaveAttribute("data-worker-generation", "1");
  await expect(probe).toHaveAttribute("data-document-version", "1");

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" ");
  await expect
    .poll(async () => Number(await probe.getAttribute("data-document-version")))
    .toBeGreaterThan(1);
  const versionBeforeFailure = Number(await probe.getAttribute("data-document-version"));

  await failureButton.click();
  await expect(probe).toHaveAttribute("data-worker-generation", "2", { timeout: 30_000 });
  await expect(state).toHaveText("ready", { timeout: 30_000 });
  await expect(probe).toHaveAttribute("data-document-version", String(versionBeforeFailure));

  await page.waitForTimeout(250);
  await applyEditButton.click();
  await expect(probe).toHaveAttribute("data-model-version", String(versionBeforeFailure + 1));
  await expect
    .poll(async () => Number(await probe.getAttribute("data-document-version")))
    .toBeGreaterThan(versionBeforeFailure);
  await expect(state).toHaveText("ready", { timeout: 30_000 });

  await inspectButton.click();
  await expect(inspection).toContainText('"type": "InspectResult"', { timeout: 30_000 });
  await expect(inspection).toContainText('"type": "program"');
});

test("does not restore a Monaco model disposed during Worker recovery", async ({ page }) => {
  await page.goto(recoveryUrl);

  const probe = page.locator('[data-testid="m1-monaco-syntax-binding"]');
  const state = page.locator('[data-testid="m1-monaco-syntax-state"]');
  const failAndDisposeButton = page.locator('[data-testid="m1-fail-and-dispose-model"]');

  await expect(state).toHaveText("ready", { timeout: 30_000 });
  await expect(probe).toHaveAttribute("data-worker-generation", "1");

  await failAndDisposeButton.click();
  await expect(state).toHaveText("closed", { timeout: 30_000 });
  await expect(probe).toHaveAttribute("data-worker-generation", "2", { timeout: 30_000 });
  await page.waitForTimeout(500);
  await expect(state).toHaveText("closed");
});
