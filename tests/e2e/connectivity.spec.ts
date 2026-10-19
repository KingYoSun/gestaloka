import { expect, test } from "@playwright/test";

test("同一オリジンでWeb・HTTP・SSEへ接続する", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "gestaloka" })).toBeVisible();
  const result = await page.evaluate(async () => {
    const http = await fetch("/api/health").then((response) => response.json());
    const sse = await new Promise((resolve, reject) => {
      const source = new EventSource("/api/health/events");
      source.addEventListener("health", (event) => {
        source.close();
        resolve(JSON.parse(event.data));
      });
      source.onerror = () => {
        source.close();
        reject(new Error("SSE接続失敗"));
      };
    });
    return { http, sse };
  });
  expect(result.sse).toEqual({ type: "health", data: result.http });
});
