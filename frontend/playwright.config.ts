import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../tests/e2e",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
  },
});
