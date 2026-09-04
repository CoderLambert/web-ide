import { expect, test } from "playwright/test";

const baseUrl = requiredEnvironment("S0_BASE_URL").replace(/\/$/, "");

interface SqlCountResponse {
  ok: boolean;
  value?: {
    operation: "execute";
    execution: {
      results: Array<{ kind: string; rows?: unknown[][] }>;
      status: string;
    };
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for the local SQL Lab smoke gate.`);
  }
  return value;
}

async function readDemoCounts(page: import("playwright/test").Page, workspaceId: string) {
  const response = await page.evaluate(async (id) => {
    const result = await fetch("/api/sql-lab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "execute",
        workspaceId: id,
        sql: `SELECT COUNT(*) AS value FROM customers;
SELECT COUNT(*) AS value FROM products;
SELECT COUNT(*) AS value FROM orders;
SELECT COUNT(*) AS value FROM order_items;`,
      }),
    });
    return (await result.json()) as SqlCountResponse;
  }, workspaceId);

  expect(response.ok).toBe(true);
  expect(response.value?.execution.status).toBe("completed");
  return response.value?.execution.results.map((result) => Number(result.rows?.[0]?.[0]));
}

test("opens SQL Lab with clean local runtime defaults", async ({ page }) => {
  const workspaceListPaths: string[] = [];
  let releaseRootList!: () => void;
  const rootListPending = new Promise<void>((resolve) => {
    releaseRootList = resolve;
  });
  let runtimeWorkspaceId: string | undefined;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/workspace") && request.method() === "POST") {
      const payload = request.postDataJSON() as { operation?: unknown; path?: unknown };
      if (payload.operation === "list" && typeof payload.path === "string") {
        workspaceListPaths.push(payload.path);
      }
    }
    if (request.url().endsWith("/api/sql-lab") && request.method() === "POST") {
      const payload = request.postDataJSON() as { workspaceId?: unknown };
      if (typeof payload.workspaceId === "string") {
        runtimeWorkspaceId = payload.workspaceId;
      }
    }
  });
  await page.route("**/api/workspace", async (route) => {
    const payload = route.request().postDataJSON() as { operation?: unknown; path?: unknown };
    if (payload.operation === "list" && payload.path === "") {
      await rootListPending;
    }
    await route.continue();
  });
  const schemaResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/sql-lab") && response.request().method() === "POST",
  );
  await page.goto(`${baseUrl}/sql-lab`);
  expect((await schemaResponse).status()).toBe(200);
  const newButton = page.locator('[data-testid="sql-lab-new"]');
  await expect(newButton).toBeVisible();
  await expect(newButton).toBeDisabled();
  releaseRootList();
  await expect(page.locator('[data-testid="sql-lab-state"]')).toHaveText("ready", {
    timeout: 30_000,
  });
  expect(workspaceListPaths).toEqual([""]);

  const sessionCookie = (await page.context().cookies(baseUrl)).find((cookie) =>
    /^web_ide_workspace_token_[a-f0-9]{16}$/.test(cookie.name),
  );
  expect(sessionCookie).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Strict",
  });

  await expect(page.locator('[data-testid="sql-lab-schema"]')).not.toContainText(
    "DATABASE_UNAVAILABLE",
  );

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('[data-testid="sql-lab-reset"]').click();
  await expect(page.locator('[data-testid="sql-lab-schema"]')).toContainText("customers");
  expect(runtimeWorkspaceId).toBeDefined();
  const countsBeforeRun = await readDemoCounts(page, runtimeWorkspaceId as string);
  expect(countsBeforeRun).toEqual([4, 5, 6, 8]);

  await expect(page.getByRole("button", { name: "query.sql", exact: true })).toBeVisible();
  await page.locator('[data-testid="sql-lab-run-all"]').click();
  await expect(page.locator('[data-testid="sql-lab-execution-summary"]')).toContainText(
    "completed",
    { timeout: 30_000 },
  );
  await expect(page.locator('[data-testid="sql-lab-schema"]')).toContainText("customers");
  await expect(readDemoCounts(page, runtimeWorkspaceId as string)).resolves.toEqual(
    countsBeforeRun,
  );
});
