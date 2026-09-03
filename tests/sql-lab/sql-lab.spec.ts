import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type APIRequestContext, type Page } from "playwright/test";

const baseUrl = requiredEnvironment("S0_BASE_URL").replace(/\/$/, "");
const workspaceId = requiredEnvironment("SQL_LAB_WORKSPACE_ID");
const workspaceRoot = requiredEnvironment("SQL_LAB_WORKSPACE_ROOT");
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

async function replaceEditorContent(page: Page, content: string): Promise<void> {
  const editor = page.locator('[data-testid="sql-lab-editor"] .monaco-editor');
  await editor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(content);
}

async function expectCompleted(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="sql-lab-execution-summary"]')).toContainText(
    "completed",
    { timeout: 30_000 },
  );
}

test("proves the production SQL Lab API and browser flow", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

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

  const specialValues = await postSqlLab(request, {
    operation: "execute",
    workspaceId,
    sql: "SELECT NULL AS empty, 9223372036854775807 AS large, X'0102' AS blob_value, printf('%.*c', 70000, 'x') AS long_text;",
  });
  expect(specialValues.body.value.execution.results[0].rows[0]).toMatchObject([
    null,
    { kind: "integer64", value: "9223372036854775807" },
    { kind: "blob", byteLength: 2 },
    { kind: "text", originalByteLength: 70_000, truncated: true },
  ]);

  const precedingResults = await postSqlLab(request, {
    operation: "execute",
    workspaceId,
    sql: "SELECT 41 AS before_error; SELECT * FROM missing_table;",
  });
  expect(precedingResults.body.value.execution).toMatchObject({
    status: "failed",
    results: [
      { kind: "query", rows: [[41]] },
      { kind: "error", code: "SQL_ERROR" },
    ],
  });

  const rollback = await postSqlLab(request, {
    operation: "execute",
    workspaceId,
    sql: "BEGIN; CREATE TABLE transient_gate (id INTEGER); INSERT INTO transient_gate VALUES (1); SELECT * FROM missing_table;",
  });
  expect(rollback.body.value.execution).toMatchObject({
    status: "failed",
    transactionRolledBack: true,
  });
  const rollbackSchema = await postSqlLab(request, { operation: "schema", workspaceId });
  expect(
    rollbackSchema.body.value.schema.tables.some(
      (table: { name: string }) => table.name === "transient_gate",
    ),
  ).toBe(false);

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
  await expect(page.locator('[data-testid="sql-lab-editor"] .monaco-editor')).toHaveCount(1);
  await expect(page.locator('[data-testid="sql-lab-schema"]')).toContainText("customers");

  await replaceEditorContent(page, "SELECT 41 AS answer;");
  await expect(page.locator('[data-testid="sql-lab-save"]')).toBeEnabled();
  await page.locator('[data-testid="sql-lab-run-current"]').click();
  await expectCompleted(page);
  await expect(page.locator('[data-testid="sql-lab-results"]')).toContainText("41");

  await page.locator('[data-testid="sql-lab-run-selection"]').click();
  await expectCompleted(page);
  await expect(page.locator('[data-testid="sql-lab-results"]')).toContainText("41");

  await page.locator('[data-testid="sql-lab-explain-selection"]').click();
  await expectCompleted(page);

  const runAll = page.locator('[data-testid="sql-lab-run-all"]');
  await expect(runAll).toBeEnabled({ timeout: 30_000 });
  await runAll.click();
  await expectCompleted(page);
  await page.locator('[data-testid="sql-lab-explain-current"]').click();
  await expectCompleted(page);
  await page.locator('[data-testid="sql-lab-save"]').click();
  await expect(page.locator('[data-testid="sql-lab-save"]')).toBeDisabled();
  await expect(readFile(join(workspaceRoot, "src/query.sql"), "utf8")).resolves.toBe(
    "SELECT 41 AS answer;",
  );

  await page.locator('[data-testid="sql-lab-new"]').click();
  const newFile = page.getByRole("button", { name: "query-1.sql", exact: true });
  await expect(newFile).toBeVisible();
  await replaceEditorContent(page, "SELECT 7 AS new_file;");
  await page.locator('[data-testid="sql-lab-save"]').click();
  await expect(page.locator('[data-testid="sql-lab-save"]')).toBeDisabled();
  await expect(readFile(join(workspaceRoot, "query-1.sql"), "utf8")).resolves.toBe(
    "SELECT 7 AS new_file;",
  );

  await page.getByRole("button", { name: "src/query.sql", exact: true }).click();
  await page.locator('[data-testid="sql-lab-run-all"]').click();
  await expectCompleted(page);
  await expect(page.locator('[data-testid="sql-lab-results"]')).toContainText("41");

  await replaceEditorContent(
    page,
    "SELECT NULL AS empty, 9223372036854775807 AS large, X'0102' AS blob_value, printf('%.*c', 70000, 'x') AS long_text;",
  );
  await page.locator('[data-testid="sql-lab-run-all"]').click();
  await expectCompleted(page);
  await expect(page.locator('[data-sql-value-kind="null"]')).toContainText("NULL");
  await expect(page.locator('[data-sql-value-kind="integer64"]')).toContainText(
    "9223372036854775807",
  );
  await expect(page.locator('[data-sql-value-kind="blob"]')).toContainText("BLOB (2 bytes)");
  await expect(page.locator('[data-sql-value-kind="text"]')).toContainText("truncated");

  await replaceEditorContent(page, "SELECT 41 AS before_error; SELECT * FROM missing_table;");
  await page.locator('[data-testid="sql-lab-run-all"]').click();
  await expect(page.locator('[data-testid="sql-lab-execution-summary"]')).toContainText("failed", {
    timeout: 30_000,
  });
  await expect(page.locator('[data-result-kind="query"]')).toContainText("41");
  await expect(page.locator('[data-result-kind="error"]')).toContainText("SQL_ERROR");

  await replaceEditorContent(
    page,
    "BEGIN; CREATE TABLE transient_browser (id INTEGER); INSERT INTO transient_browser VALUES (1); SELECT * FROM missing_table;",
  );
  await page.locator('[data-testid="sql-lab-run-all"]').click();
  await expect(page.locator('[data-testid="sql-lab-execution-summary"]')).toContainText(
    "transaction rolled back",
    { timeout: 30_000 },
  );

  page.once("dialog", (dialog) => void dialog.accept());
  await page.locator('[data-testid="sql-lab-reset"]').click();
  await expect(page.locator('[data-testid="sql-lab-results"]')).toContainText("No results yet.", {
    timeout: 30_000,
  });
  const afterBrowserReset = await postSqlLab(request, {
    operation: "execute",
    workspaceId,
    sql: "SELECT COUNT(*) AS count FROM customers;",
  });
  expect(afterBrowserReset.body.value.execution.results[0].rows).toEqual([[4]]);

  expect(consoleErrors, "console.error messages").toEqual([]);
  expect(pageErrors, "uncaught page errors").toEqual([]);
});
