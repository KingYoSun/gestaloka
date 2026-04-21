import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../tests/e2e",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173",
  },
});
