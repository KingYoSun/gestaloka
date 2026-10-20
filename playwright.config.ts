import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
process.env.E2E_SCOPE ??= randomUUID();

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  globalTeardown: "./tests/e2e/teardown.ts",
  timeout: 60000,
  webServer: [
    {
      command:
        "node --env-file-if-exists=.env --import tsx tests/e2e/api-server.ts",
      url: "http://127.0.0.1:3001/api/health",
    },
    {
      command:
        "node --env-file-if-exists=.env --import tsx tests/e2e/worker.ts",
      wait: { stdout: /E2E worker ready/ },
    },
    {
      command: "pnpm --filter @gestaloka/web dev --port 4173",
      env: {
        API_PROXY_TARGET: "http://127.0.0.1:3001",
        VITE_USER_APP_URL: "http://127.0.0.1:4173",
        VITE_ADMIN_APP_URL: "http://127.0.0.1:4174",
      },
      url: "http://127.0.0.1:4173",
    },
    {
      command: "pnpm --filter @gestaloka/admin dev --port 4174",
      env: {
        API_PROXY_TARGET: "http://127.0.0.1:3001",
        VITE_USER_APP_URL: "http://127.0.0.1:4173",
        VITE_ADMIN_APP_URL: "http://127.0.0.1:4174",
      },
      url: "http://127.0.0.1:4174",
    },
  ],
});
