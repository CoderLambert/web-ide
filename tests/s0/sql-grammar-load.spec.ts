import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "playwright/test";

const baseUrl = (process.env.S0_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const grammarPath = "/languages/sql/tree-sitter-sql.wasm";
const grammarLock: unknown = JSON.parse(
  readFileSync(new URL("../../scripts/sql-grammar.lock.json", import.meta.url), "utf8"),
);

if (
  typeof grammarLock !== "object" ||
  grammarLock === null ||
  !("wasmSha256" in grammarLock) ||
  typeof grammarLock.wasmSha256 !== "string"
) {
  throw new Error("SQL grammar lock must contain a WASM SHA256");
}

const grammarWasmSha256 = grammarLock.wasmSha256;

test("loads the pinned SQL grammar in the module Worker without parsing", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const grammarResponses: Array<{ contentType: string | undefined; status: number }> = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(grammarPath)) {
      grammarResponses.push({
        contentType: response.headers()["content-type"],
        status: response.status(),
      });
    }
  });

  await page.goto(`${baseUrl}/ide`);
  const status = page.locator('[data-testid="tree-sitter-status"]');
  await expect(status).not.toHaveText("loading", {
    timeout: 30_000,
  });
  expect(
    await status.textContent(),
    `console errors: ${JSON.stringify(consoleErrors)}; page errors: ${JSON.stringify(pageErrors)}`,
  ).toBe("ready");

  expect(grammarResponses.length).toBeGreaterThanOrEqual(1);
  expect(
    grammarResponses.some(
      (response) => response.status === 200 && response.contentType?.includes("application/wasm"),
    ),
    `SQL grammar responses: ${JSON.stringify(grammarResponses)}`,
  ).toBe(true);

  const grammarResponse = await page.request.get(`${baseUrl}${grammarPath}`);
  expect(grammarResponse.status()).toBe(200);
  expect(grammarResponse.headers()["content-type"]).toContain("application/wasm");
  expect(
    createHash("sha256")
      .update(await grammarResponse.body())
      .digest("hex"),
  ).toBe(grammarWasmSha256);

  expect(consoleErrors, "console.error messages").toEqual([]);
  expect(pageErrors, "uncaught page errors").toEqual([]);
});
