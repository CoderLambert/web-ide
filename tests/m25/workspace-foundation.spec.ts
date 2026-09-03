import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page, type Response } from "playwright/test";

const baseUrl = (process.env.S0_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const workspaceId = requiredEnvironment("M25_WORKSPACE_ID");
const workspaceRoot = requiredEnvironment("M25_WORKSPACE_ROOT");
const workspaceToken = requiredEnvironment("M25_WORKSPACE_TOKEN");
const workspacePath = "src/query.sql";
const versionA = "SELECT '浏览器保存 A';\r\n-- exact content A\r\n";
const versionB = "SELECT 'browser save B';\n-- ordered content B\n";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is required for the M2.5 integration gate.`);
  }
  return value;
}

async function openProbe(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "web_ide_workspace_token",
      value: workspaceToken,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  await page.goto(`${baseUrl}/ide?m25WorkspaceTest=1`);
  await expect(page.locator('[data-testid="m25-workspace-state"]')).toHaveText("ready", {
    timeout: 30_000,
  });
}

async function clickAndWait(page: Page, action: string): Promise<void> {
  const probe = page.locator('[data-testid="m25-workspace-probe"]');
  const completedBefore = Number(await probe.getAttribute("data-completed-actions"));
  await page.locator(`[data-testid="m25-${action}"]`).click();
  await expect
    .poll(async () => Number(await probe.getAttribute("data-completed-actions")))
    .toBeGreaterThan(completedBefore);
}

async function readPersisted(): Promise<string> {
  return readFile(join(workspaceRoot, workspacePath), "utf8");
}

function isWorkspaceWrite(response: Response): boolean {
  return (
    response.url().endsWith("/api/workspace") &&
    response.request().postData()?.includes('"operation":"writeFile"') === true
  );
}

test("proves the production Browser to Backend workspace contract", async ({ page }) => {
  const workspaceResponses: Response[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith("/api/workspace")) {
      workspaceResponses.push(response);
    }
  });

  await openProbe(page);
  const probe = page.locator('[data-testid="m25-workspace-probe"]');

  await clickAndWait(page, "open");
  await expect(probe).toHaveAttribute("data-open", "true");
  await expect(probe).toHaveAttribute("data-uri", "file:///workspace/src/query.sql");
  await expect(probe).toHaveAttribute("data-content", "SELECT 'initial';\n");

  await page.locator('[data-testid="m25-edit-a"]').click();
  await expect(probe).toHaveAttribute("data-content", versionA);
  await expect(probe).toHaveAttribute("data-dirty", "true");
  await clickAndWait(page, "save");
  await expect(probe).toHaveAttribute("data-dirty", "false");
  expect(await readPersisted()).toBe(versionA);

  await clickAndWait(page, "close");
  await expect(probe).toHaveAttribute("data-open", "false");
  await clickAndWait(page, "open");
  await expect(probe).toHaveAttribute("data-content", versionA);
  await expect(probe).toHaveAttribute("data-created-models", "2");
  await expect(probe).toHaveAttribute("data-disposed-models", "1");

  let releaseWrite!: () => void;
  const delayedWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  let delayed = false;
  await page.route("**/api/workspace", async (route) => {
    if (!delayed && route.request().postData()?.includes('"operation":"writeFile"')) {
      delayed = true;
      await delayedWrite;
    }
    await route.continue();
  });

  await page.locator('[data-testid="m25-edit-a"]').click();
  await page.locator('[data-testid="m25-save"]').click();
  await expect.poll(() => delayed).toBe(true);
  await page.locator('[data-testid="m25-edit-b"]').click();
  releaseWrite();
  await expect(probe).toHaveAttribute("data-pending-actions", "0");
  await expect(probe).toHaveAttribute("data-dirty", "true");
  expect(await readPersisted()).toBe(versionA);
  await page.unroute("**/api/workspace");

  let releaseFirstQueuedWrite!: () => void;
  const queuedWrite = new Promise<void>((resolve) => {
    releaseFirstQueuedWrite = resolve;
  });
  let firstQueuedWrite = false;
  await page.route("**/api/workspace", async (route) => {
    if (!firstQueuedWrite && route.request().postData()?.includes('"operation":"writeFile"')) {
      firstQueuedWrite = true;
      await queuedWrite;
    }
    await route.continue();
  });
  await page.locator('[data-testid="m25-save"]').click();
  await expect.poll(() => firstQueuedWrite).toBe(true);
  await page.locator('[data-testid="m25-edit-a"]').click();
  await page.locator('[data-testid="m25-save"]').click();
  releaseFirstQueuedWrite();
  await expect(probe).toHaveAttribute("data-pending-actions", "0");
  await expect(probe).toHaveAttribute("data-dirty", "false");
  expect(await readPersisted()).toBe(versionA);
  await page.unroute("**/api/workspace");

  await page.locator('[data-testid="m25-edit-b"]').click();
  let abortedWrite = false;
  await page.route("**/api/workspace", async (route) => {
    if (!abortedWrite && route.request().postData()?.includes('"operation":"writeFile"')) {
      abortedWrite = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await clickAndWait(page, "save");
  await expect(probe).toHaveAttribute("data-dirty", "true");
  await expect(probe).toHaveAttribute("data-error-code", "IO_ERROR");
  await page.unroute("**/api/workspace");
  await clickAndWait(page, "save");
  await expect(probe).toHaveAttribute("data-dirty", "false");
  expect(await readPersisted()).toBe(versionB);

  await clickAndWait(page, "filesystem-cycle");
  await expect(probe).toHaveAttribute("data-filesystem-result", "workspace operations passed");

  await page.locator('[data-testid="m25-edit-a"]').click();
  await clickAndWait(page, "rename-file");
  await expect(probe).toHaveAttribute("data-error-code", "FORBIDDEN");
  await clickAndWait(page, "delete-file");
  await expect(probe).toHaveAttribute("data-error-code", "FORBIDDEN");
  await clickAndWait(page, "save");
  await clickAndWait(page, "rename-directory");
  await expect(probe).toHaveAttribute("data-error-code", "FORBIDDEN");
  await clickAndWait(page, "delete-directory");
  await expect(probe).toHaveAttribute("data-error-code", "FORBIDDEN");

  await clickAndWait(page, "rename-file");
  await expect(probe).toHaveAttribute("data-uri", "file:///workspace/src/renamed.sql");
  await expect(probe).toHaveAttribute("data-created-models", "3");
  await expect(probe).toHaveAttribute("data-disposed-models", "2");
  await expect(probe).toHaveAttribute("data-disposed-bindings", "2");
  await clickAndWait(page, "delete-file");
  await expect(probe).toHaveAttribute("data-open", "false");
  await expect(probe).toHaveAttribute("data-disposed-models", "3");
  await expect(probe).toHaveAttribute("data-disposed-bindings", "3");

  const boundaryResults = await page.evaluate(
    async ({ id }) => {
      async function post(body: unknown) {
        const response = await fetch("/api/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.text() };
      }
      return Promise.all([
        post({ workspaceId: `${id}-unauthorized`, operation: "list", path: "" }),
        post({ workspaceId: id, operation: "list", path: "", root: "/client/root" }),
        post({ workspaceId: id, operation: "readFile", path: "../outside/secret.txt" }),
        post({ workspaceId: id, operation: "readFile", path: "src\\query.sql" }),
        post({ workspaceId: id, operation: "readFile", path: "src\u0000query.sql" }),
        post({ workspaceId: id, operation: "readFile", path: "escape-link" }),
      ]);
    },
    { id: workspaceId },
  );

  expect(boundaryResults.map((result) => result.status)).toEqual([403, 422, 400, 400, 400, 422]);
  for (const result of boundaryResults) {
    expect(result.body).not.toContain(workspaceRoot);
  }
  expect(await readFile(join(workspaceRoot, "../outside/secret.txt"), "utf8")).toBe("outside");

  await expect.poll(() => workspaceResponses.filter(isWorkspaceWrite).length).toBeGreaterThan(0);
  const responsePayloads = await Promise.all(workspaceResponses.map((response) => response.text()));
  expect(responsePayloads.join("\n")).not.toContain(workspaceRoot);
  await expect(page.evaluate(() => Object.keys(localStorage))).resolves.toEqual([]);
  await expect(page.evaluate(() => Object.keys(sessionStorage))).resolves.toEqual([]);
});
