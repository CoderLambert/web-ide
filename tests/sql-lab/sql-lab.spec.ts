import { expect, test, type APIRequestContext, type Page } from "playwright/test";

const baseUrl = requiredEnvironment("S0_BASE_URL").replace(/\/$/, "");
const workspaceId = requiredEnvironment("SQL_LAB_WORKSPACE_ID");
const workspaceToken = requiredEnvironment("SQL_LAB_WORKSPACE_TOKEN");

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for the SQL Lab production gate.`);
  }
  return value;
}

async function postSqlLab(
  request: APIRequestContext,
  payload: Record<string, unknown>,
): Promise<{ response: Awaited<ReturnType<APIRequestContext["post"]>>; body: any }> {
  const response = await request.post("/api/sql-lab", {
    headers: {
      "content-type": "application/json",
      cookie: `web_ide_workspace_token=${workspaceToken}`,
    },
    data: payload,
  });
  return { response, body: await response.json() };
}

async function openSqlLab(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: "web_ide_workspace_token",
      value: workspaceToken,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  await page.goto(`${baseUrl}/sql-lab`);
  await expect(page.locator('[data-testid="sql-lab-state"]')).toHaveText("ready", {
    timeout: 30_000,
  });
}

test("proves the production SQL Lab API and browser flow", async ({ page, request }) => {
  const reset = await postSqlLab(request, { operation: "reset", workspaceId });
  expect(reset.response.status()).toBe(200);
  expect(reset.body).toMatchObject({ ok: true, value: { operation: "reset" } });

  const schema = await postSqlLab(request, { operation: "schema", workspaceId });
  expect(schema.response.status()).toBe(200);
  expect(schema.body.value.schema.tables.map((table: { name: string }) => table.name)).toEqual([
    "customers",
    "order_items",
    "orders",
    "products",
  ]);

  const execution = await postSqlLab(request, {
    operation: "execute",
    workspaceId,
    sql: "SELECT COUNT(*) AS count FROM customers; SELECT SUM(quantity) AS quantity FROM order_items;",
  });
  expect(execution.response.status()).toBe(200);
  expect(execution.body).toMatchObject({
    ok: true,
    value: { operation: "execute", execution: { status: "completed" } },
  });
  expect(execution.body.value.execution.results).toHaveLength(2);

  const explain = await postSqlLab(request, {
    operation: "explain",
    workspaceId,
    sql: "SELECT * FROM customers WHERE id = 1;",
  });
  expect(explain.response.status()).toBe(200);
  expect(explain.body).toMatchObject({
    ok: true,
    value: { operation: "explain", result: { kind: "query" } },
  });

  const dangerous = await postSqlLab(request, {
    operation: "execute",
    workspaceId,
    sql: "ATTACH ':memory:' AS escape;",
  });
  expect(dangerous.body.value.execution).toMatchObject({
    status: "failed",
    results: [{ kind: "error", code: "SQL_ERROR" }],
  });

  const timeout = await postSqlLab(request, {
    operation: "execute",
    workspaceId,
    sql: `WITH RECURSIVE counter(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM counter WHERE value < 1000000000
    ) SELECT sum(value) FROM counter;`,
  });
  expect(timeout.response.status()).toBe(200);
  expect(timeout.body).toMatchObject({
    ok: true,
    value: { operation: "execute", execution: { status: "timeout" } },
  });

  const afterTimeout = await postSqlLab(request, {
    operation: "execute",
    workspaceId,
    sql: "SELECT 43 AS answer;",
  });
  expect(afterTimeout.body.value.execution.results[0].rows).toEqual([[43]]);

  const unauthorized = await request.post("/api/sql-lab", {
    data: { operation: "schema", workspaceId },
  });
  expect(unauthorized.status()).toBe(403);

  const extraField = await postSqlLab(request, {
    operation: "schema",
    workspaceId,
    databasePath: "/tmp/client-controlled.sqlite",
  });
  expect(extraField.response.status()).toBe(400);

  await openSqlLab(page);
  await expect(page.locator('[data-testid="sql-lab-schema"]')).toContainText("customers");
  const runAll = page.locator('[data-testid="sql-lab-run-all"]');
  await expect(runAll).toBeEnabled({ timeout: 30_000 });
  await runAll.click();
  await expect(page.locator('[data-testid="sql-lab-execution-summary"]')).toContainText(
    "completed",
    { timeout: 30_000 },
  );

  await page.locator('[data-testid="sql-lab-explain-current"]').click();
  await expect(page.locator('[data-testid="sql-lab-execution-summary"]')).toContainText(
    "completed",
    { timeout: 30_000 },
  );

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('[data-testid="sql-lab-reset"]').click();
  await expect(page.locator('[data-testid="sql-lab-results"]')).toContainText("No results yet.", {
    timeout: 30_000,
  });
});
