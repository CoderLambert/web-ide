import { describe, expect, it } from "vite-plus/test";

import { isConfiguredValue } from "../../../src/server/configuration";

describe("server configuration", () => {
  it.each([
    { value: undefined, configured: false },
    { value: "", configured: false },
    { value: "   ", configured: false },
    { value: "configured", configured: true },
    { value: "  configured  ", configured: true },
  ])("recognizes $value as configured=$configured", ({ value, configured }) => {
    expect(isConfiguredValue(value)).toBe(configured);
  });
});
