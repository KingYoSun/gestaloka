import Fastify from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { registerPlayerCliVersion } from "../../apps/api/src/player-cli-version.js";

const exec = promisify(execFile);
test("次のメジャーの公開で旧端末を止め、同じ起動先から更新してプレイを再開する", async () => {
  const app = Fastify(),
    tmp = await mkdtemp(join(tmpdir(), "gestaloka-major-")),
    current = JSON.parse(
      await readFile("artifacts/player-cli/latest.json", "utf8"),
    );
  current.version = "0.17.0"; // Baseline for the 0.x to 1.x transition, independent of future releases.
  let published = current.version,
    badDigest = false;
  registerPlayerCliVersion(app, async () => published);
  const received: string[] = [];
  const viewerId = randomUUID();
  app.get("/api/player-device", async (req) => {
    received.push(String(req.headers["x-gestaloka-cli-version"]));
    return {
      id: randomUUID(),
      worldId: randomUUID(),
      joinId: null,
      actorId: null,
      presetId: null,
      presetVersion: null,
      state: "authorization_pending",
    };
  });
  app.post("/api/player-devices", async () => ({ ok: true }));
  app.post("/api/operations", async () => ({ ok: true }));
  // Simulate deployment between the presence request and the SSE subscription.
  app.post("/api/worlds/:id/waiting", async () => {
    published = "1.0.0";
    return {
      state: "standby",
      viewerId,
      active: true,
      connected: true,
      actionable: false,
      wakeKey: null,
    };
  });
  app.get("/api/worlds/:id/waiting/events", async (req, reply) => {
    expect(req.headers["x-gestaloka-cli-version"]).toBe(published);
    return reply
      .type("text/event-stream")
      .send(
        "event: waiting\ndata: " +
          JSON.stringify({
            state: "inactive",
            viewerId,
            active: false,
            connected: false,
            actionable: false,
            wakeKey: null,
          }) +
          "\n\n",
      );
  });
  app.get("/api/worlds/:id/session", async () => ({ ok: true }));
  const source = resolve(
    "artifacts/player-cli",
    current.downloadUrl.split("/").pop(),
  );
  const cli = join(tmp, "package", "dist", "main.js"),
    profile = join(tmp, "profile.json");
  const run = async (...args: string[]) => {
    try {
      return JSON.parse(
        (await exec(process.execPath, [cli, ...args, "--profile", profile]))
          .stdout,
      );
    } catch (e) {
      return JSON.parse((e as { stdout: string }).stdout);
    }
  };
  try {
    await exec("tar", ["-xzf", source, "-C", tmp]);
    const installed = join(tmp, "package", "package.json");
    await writeFile(
      installed,
      JSON.stringify({
        ...JSON.parse(await readFile(installed, "utf8")),
        version: current.version,
      }),
    );
    const available = join(tmp, "future");
    await mkdir(available);
    await exec("tar", ["-xzf", source, "-C", available]);
    const pkg = join(available, "package", "package.json"),
      future = "1.0.0";
    const manifest = JSON.parse(await readFile(pkg, "utf8"));
    await writeFile(pkg, JSON.stringify({ ...manifest, version: future }));
    await writeFile(
      join(available, "package", "gameplay-changes.json"),
      JSON.stringify({
        [future]: ["新しい待機手順"],
        [current.version]: ["既読の変更"],
        "0.18.0": ["途中の版で追加された操作"],
        "0.19.0": [],
      }),
    );
    const archive = join(tmp, "future.tgz");
    await exec("tar", ["-czf", archive, "-C", available, "package"]);
    const bytes = await readFile(archive);
    const url = "/api/player-cli/download/cli.tgz";
    app.get("/api/player-cli/latest", async () => ({
      ...current,
      version: published,
      downloadUrl: url,
      sizeBytes: bytes.length,
      sha256: badDigest
        ? "0".repeat(64)
        : createHash("sha256").update(bytes).digest("hex"),
    }));
    app.get(url, async (req) => {
      expect(req.headers.authorization).toBeUndefined();
      return bytes;
    });
    const server = await app.listen({ host: "127.0.0.1", port: 0 });
    const original = JSON.stringify({
      deviceId: randomUUID(),
      server,
      worldId: randomUUID(),
      secret: "local-test",
      lastRequestId: randomUUID(),
    });
    await writeFile(profile, original);
    expect(
      (await app.inject({ method: "POST", url: "/api/player-devices" }))
        .statusCode,
    ).toBe(200);
    expect((await run("status")).state).toBe("authorization_pending");
    expect(received).toEqual([current.version]);
    const listen = await run("listen", "--resume", "--once");
    expect(listen).toMatchObject({
      state: "error",
      code: "PLAYER_CLI_UPDATE_REQUIRED",
    });
    expect(listen.message).toContain("gestaloka update");
    published = future;
    for (const [method, path] of [
      ["POST", "/api/player-devices"],
      ["POST", "/api/operations"],
      ["GET", "/api/worlds/example/waiting/events"],
    ] as const) {
      const res = await app.inject({
        method,
        url: path,
        headers:
          path === "/api/player-devices"
            ? {}
            : { authorization: "Bearer test" },
      });
      expect(res.statusCode).toBe(426);
      expect(res.json().message).toContain("/api/player-cli/setup.md");
    }
    const rejected = await run("status");
    expect(rejected).toMatchObject({
      state: "error",
      code: "PLAYER_CLI_UPDATE_REQUIRED",
    });
    expect(rejected.message).toContain("gestaloka update");
    expect(received).toHaveLength(1);
    expect(
      (
        await app.inject({
          url: "/api/worlds/example/session",
          headers: { cookie: "browser=owner" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/api/player-device",
          headers: { "x-gestaloka-cli-version": "1.2.3" },
        })
      ).statusCode,
    ).toBe(200);
    published = "1.4.0";
    expect(
      (
        await app.inject({
          url: "/api/player-device",
          headers: { "x-gestaloka-cli-version": "1.0.0" },
        })
      ).statusCode,
    ).toBe(200);
    published = future;
    badDigest = true;
    expect((await run("update")).message).toContain("SHA-256");
    expect((await run("version")).version).toBe(current.version);
    badDigest = false;
    const updates = await Promise.all([
      run("update"),
      run("update", "--server", server),
    ]);
    expect(
      updates.every((r) => ["updated", "up_to_date"].includes(r.state)),
    ).toBe(true);
    const result = updates.find((r) => r.state === "updated");
    expect(result).toMatchObject({
      state: "updated",
      fromVersion: current.version,
      version: future,
      changes: [
        { version: "0.18.0", items: ["途中の版で追加された操作"] },
        { version: future, items: ["新しい待機手順"] },
      ],
    });
    expect(await readFile(result.skillPath, "utf8")).toContain("GESTALOKA");
    expect((await run("version")).version).toBe(future);
    expect((await run("status")).state).toBe("authorization_pending");
    expect(received.at(-1)).toBe(future);
    expect((await run("listen", "--resume", "--once")).state).toBe("inactive");
    expect(await run("update")).toMatchObject({
      state: "up_to_date",
      changes: [],
    });
    expect(await readFile(profile, "utf8")).toBe(original);
  } finally {
    await app.close();
    await rm(tmp, { recursive: true, force: true });
  }
}, 60000);
