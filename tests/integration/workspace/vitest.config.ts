import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["tests/integration/workspace/**/*.test.ts"],
  },
});
