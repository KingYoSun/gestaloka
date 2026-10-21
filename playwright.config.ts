import { defineConfig } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { connectDatabases } from "@gestaloka/server";
process.env.E2E_SCOPE ??= randomUUID();
const schema = `e2e_${process.env.E2E_SCOPE.replaceAll("-", "")}`;
if (!/^e2e_[a-f0-9]{32}$/.test(schema)) throw new Error("E2E_SCOPEが不正です");
const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set("options", `-c search_path=${schema}`);
process.env.DATABASE_URL = url.toString();
const database = connectDatabases();
try {
  await database.postgres.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
} finally {
  await database.close();
}

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
