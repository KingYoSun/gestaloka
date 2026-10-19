import { afterEach, expect, test } from "vitest";
import { Health, HealthEvent } from "@gestaloka/contracts";
import { createApp } from "../../apps/api/src/app.js";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

test("公開Zodスキーマに従うHTTP応答とSSEメッセージを返す", async () => {
  const app = await createApp();
  apps.push(app);
  const response = await app.inject("/api/health");
  expect(response.statusCode).toBe(200);
  expect(Health.parse(response.json())).toEqual({
    service: "gestaloka",
    status: "ok",
  });
  const stream = await app.inject({
    url: "/api/health/events",
    headers: { accept: "text/event-stream" },
  });
  expect(stream.headers["content-type"]).toContain("text/event-stream");
  const data = stream.body
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.slice(5);
  expect(HealthEvent.parse(JSON.parse(data!))).toEqual({
    type: "health",
    data: response.json(),
  });
});

test("SSEを受け付けないクライアントには明示的に406を返す", async () => {
  const app = await createApp();
  apps.push(app);
  const response = await app.inject({
    url: "/api/health/events",
    headers: { accept: "application/json" },
  });
  expect(response.statusCode).toBe(406);
});
