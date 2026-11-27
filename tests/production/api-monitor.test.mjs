import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../../infra/production/api-monitor/worker.mjs";

const HEALTH_URL = "https://api.example.test/api/health";

test("公開APIの障害と復旧を記録し、トンネルの切断と再接続の時刻を照合できる", async (t) => {
  const observed = t.mock.method(console, "log", () => {});
  const healthy = () => Response.json({ service: "gestaloka", status: "ok" });
  const fetch = t.mock.method(globalThis, "fetch", healthy);
  fetch.mock.mockImplementationOnce(
    () =>
      new Response("<!DOCTYPE html>", {
        status: 502,
        headers: { "cf-ray": "test-ray" },
      }),
    1,
  );
  const times = [
    "2030-01-02T00:00:00.000Z",
    "2030-01-02T00:01:00.000Z",
    "2030-01-02T00:02:00.000Z",
  ];
  t.mock.timers.enable({ apis: ["Date"] });
  for (const at of times) {
    t.mock.timers.setTime(Date.parse(at));
    await worker.scheduled({}, { HEALTH_URL });
  }

  assert.equal(fetch.mock.callCount(), 3);
  for (const {
    arguments: [url, options],
  } of fetch.mock.calls) {
    assert.equal(url, HEALTH_URL);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "manual");
  }
  const records = observed.mock.calls.map(({ arguments: [record] }) => record);
  assert.deepEqual(records, [
    {
      event: "api_probe",
      at: times[0],
      ok: true,
      status: 200,
      cfRay: null,
      failure: null,
    },
    {
      event: "api_probe",
      at: times[1],
      ok: false,
      status: 502,
      cfRay: "test-ray",
      failure: "http_status",
    },
    {
      event: "api_probe",
      at: times[2],
      ok: true,
      status: 200,
      cfRay: null,
      failure: null,
    },
  ]);

  const disconnectedAt = "2030-01-02T00:00:40.000Z";
  const reconnectedAt = "2030-01-02T00:01:40.000Z";
  const [before, failed, recovered] = records;
  assert.ok(before.at < disconnectedAt && disconnectedAt < failed.at);
  assert.ok(failed.at < reconnectedAt && reconnectedAt < recovered.at);
});

test("HTTP 200 のHTMLとHTTP応答を得られない障害を記録する", async (t) => {
  const observed = t.mock.method(console, "log", () => {});
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new TypeError("fetch failed");
  });
  fetch.mock.mockImplementationOnce(
    () =>
      new Response("<!DOCTYPE html>", { headers: { "cf-ray": "test-ray" } }),
    0,
  );

  await worker.scheduled({}, { HEALTH_URL });
  await worker.scheduled({}, { HEALTH_URL });

  assert.deepEqual(
    observed.mock.calls.map(
      ({ arguments: [{ ok, status, cfRay, failure }] }) => [
        ok,
        status,
        cfRay,
        failure,
      ],
    ),
    [
      [false, 200, "test-ray", "invalid_health"],
      [false, null, null, "fetch_error"],
    ],
  );
});
