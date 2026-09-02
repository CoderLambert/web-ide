import { defineConfig } from "playwright/test";

const previewBaseUrl = process.env.S0_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    baseURL: previewBaseUrl ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  webServer: previewBaseUrl
    ? undefined
    : {
        command: "pnpm dev --host 127.0.0.1",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        url: "http://127.0.0.1:3000/ide",
      },
});
