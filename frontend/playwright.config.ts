import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../tests/e2e",
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    locale: "ja-JP",
  },
});
