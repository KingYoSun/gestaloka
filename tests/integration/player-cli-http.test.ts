import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { playerCli } from "../support/player-cli.js";

test("検索のHTML応答ではHTTPの情報を表示し、JSONエラーではAPIのエラーを表示する", async () => {
  const app = Fastify();
  const cli = await playerCli(app);
  try {
    const profile = join(cli.directory, "profile.json");
    await writeFile(
      profile,
      JSON.stringify({
        server: cli.base,
        worldId: randomUUID(),
        deviceId: randomUUID(),
        secret: "local-test",
      }),
    );
    app.post<{ Body: { query: { kind: string } } }>(
      "/api/worlds/:id/session",
      async (request, reply) => {
        const html = "<!DOCTYPE html><title>Proxy error</title>";
        if (request.body.query.kind === "self")
          return reply
            .code(502)
            .type("text/html")
            .header("cf-ray", "example-NRT")
            .send(html);
        if (request.body.query.kind === "surroundings")
          return reply.code(503).type("text/html").send(html);
        return reply.code(403).send({
          code: "LOGIN_REQUIRED",
          message: "ログインしてください",
        });
      },
    );
    const failure = { state: "error", requestId: expect.any(String) };
    expect(await cli.run(profile, "search", "--kind", "self")).toEqual({
      ...failure,
      code: "HTTP_ERROR",
      message:
        "サーバーの応答をJSONとして読み取れませんでした（HTTP 502、Content-Type text/html、cf-ray example-NRT）",
    });
    expect(await cli.run(profile, "search", "--kind", "surroundings")).toEqual({
      ...failure,
      code: "HTTP_ERROR",
      message:
        "サーバーの応答をJSONとして読み取れませんでした（HTTP 503、Content-Type text/html）",
    });
    expect(await cli.run(profile, "search", "--kind", "history")).toEqual({
      ...failure,
      code: "LOGIN_REQUIRED",
      message: "ログインしてください",
    });
  } finally {
    await cli.close();
    await app.close();
  }
});
