// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { App } from "../../apps/web/src/App.js";

const server = setupServer(
  http.get("http://localhost/api/health", () =>
    HttpResponse.json({ service: "gestaloka", status: "ok" }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

test("Reactを描画し、生成されたHTTPクライアント型を通信に使用できる", async () => {
  const { api } = await import("../../apps/web/src/api.js");
  render(<App />);
  expect(screen.getByRole("heading", { name: "gestaloka" })).toBeTruthy();
  const { data } = await api.GET("/api/health", {
    baseUrl: "http://localhost",
  });
  expect(data?.status).toBe("ok");
});
