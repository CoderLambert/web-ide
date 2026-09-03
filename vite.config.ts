import { defineConfig, lazyPlugins } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  run: {
    tasks: {
      validate: {
        command: ["vp check", "vp test run tests/unit"],
        cache: false,
      },
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
  },
  staged: {
    "*": "vp check --no-error-on-unmatched-pattern",
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: lazyPlugins(() => [tanstackStart(), viteReact()]),
});
