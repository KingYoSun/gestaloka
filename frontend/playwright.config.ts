import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../tests/e2e",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "/tmp/gestaloka-playwright-results",
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    locale: "ja-JP",
  },
});
