import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:5173" },
  webServer: [
    {
      command: "pnpm --filter @gestaloka/api start",
      url: "http://127.0.0.1:3000/api/health",
    },
    {
      command: "pnpm --filter @gestaloka/web dev",
      url: "http://127.0.0.1:5173",
    },
  ],
});
