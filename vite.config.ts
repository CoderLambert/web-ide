import { defineConfig, lazyPlugins, type Connect, type Plugin } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { createLocalWorkspaceSessionBootstrapMiddleware } from "./src/server/workspace/local-session-bootstrap";

const CHROME_DEVTOOLS_WORKSPACE_PATH = "/.well-known/appspecific/com.chrome.devtools.json";
const CHROME_DEVTOOLS_WORKSPACE_UUID = "f1a2b3c4-5678-4abc-9def-0123456789ab";
const responseBody = JSON.stringify({
  workspace: {
    root: process.cwd(),
    uuid: CHROME_DEVTOOLS_WORKSPACE_UUID,
  },
});

const chromeDevToolsWorkspaceMiddleware: Connect.NextHandleFunction = (request, response, next) => {
  const requestPath = request.url?.split("?", 1)[0];
  if (
    requestPath !== CHROME_DEVTOOLS_WORKSPACE_PATH ||
    (request.method !== "GET" && request.method !== "HEAD")
  ) {
    next();
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(request.method === "HEAD" ? undefined : responseBody);
};

function chromeDevToolsWorkspacePlugin(): Plugin {
  const localWorkspaceSessionBootstrap = createLocalWorkspaceSessionBootstrapMiddleware({
    enabled: process.env.WEB_IDE_LOCAL_SESSION_BOOTSTRAP,
    workspaceId: process.env.WEB_IDE_WORKSPACE_ID,
    token: process.env.WEB_IDE_WORKSPACE_TOKEN,
  });

  return {
    name: "web-ide:chrome-devtools-workspace",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(localWorkspaceSessionBootstrap);
      server.middlewares.use(chromeDevToolsWorkspaceMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(localWorkspaceSessionBootstrap);
      server.middlewares.use(chromeDevToolsWorkspaceMiddleware);
    },
  };
}

export default defineConfig({
  run: {
    tasks: {
      validate: {
        command: ["vp check", "vp test run tests/unit"],
        cache: false,
      },
      "verify:language-assets": {
        command: "node scripts/verify-language-assets.mjs",
        dependsOn: ["validate"],
        cache: false,
      },
      "verify:sql-lab": {
        command: "node scripts/verify-sql-lab.mjs",
        dependsOn: ["verify:language-assets"],
        cache: false,
      },
      "verify:m2": {
        command: "node scripts/verify-m2.mjs",
        dependsOn: ["verify:language-assets"],
        cache: false,
      },
      "verify:m25": {
        command: "node scripts/verify-m25.mjs",
        dependsOn: ["verify:language-assets"],
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
  plugins: lazyPlugins(() => [chromeDevToolsWorkspacePlugin(), tanstackStart(), viteReact()]),
});
