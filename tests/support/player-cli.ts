import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { createApp } from "../../apps/api/src/app.js";
import { expect } from "vitest";

export async function playerCli(app: Awaited<ReturnType<typeof createApp>>) {
  const directory = await mkdtemp(join(tmpdir(), "gestaloka-cli-"));
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
    throw new Error("試験用ディレクトリーの外側です");
  let drop: string | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString();
    const result = await app.inject({
      method: request.method as "GET" | "POST" | "PUT",
      url: request.url!,
      headers: request.headers,
      ...(body ? { payload: body } : {}),
    });
    const sent = body ? JSON.parse(body) : {};
    if (
      drop &&
      (sent.command === drop ||
        sent.command?.operation === drop ||
        request.url === drop)
    ) {
      drop = undefined;
      response.destroy();
    } else {
      response.writeHead(result.statusCode, result.headers);
      response.end(result.rawPayload);
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return {
    directory,
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    dropNextResponse(value: string) {
      drop = value;
    },
    async run(profile: string, ...args: string[]) {
      try {
        const { stdout } = await promisify(execFile)(process.execPath, [
          resolve("packages/player-cli/dist/main.js"),
          ...args,
          "--profile",
          profile,
        ]);
        return JSON.parse(stdout);
      } catch (error) {
        const failure = error as { stdout?: string };
        if (failure.stdout) return JSON.parse(failure.stdout);
        throw error;
      }
    },
    async approve(
      cookie: string,
      code: string,
      choice: string,
    ): Promise<{ statusCode: number; body: string }> {
      const page = await app.inject({
        url: `/auth/player?code=${code}`,
        headers: { cookie },
      });
      expect(page.statusCode, page.body).toBe(200);
      expect(page.body).toContain(code);
      const csrf = page.body.match(/name="csrf" value="([a-f0-9]+)"/)![1]!;
      return app.inject({
        method: "POST",
        url: "/auth/player",
        headers: {
          cookie: `${cookie}; gestaloka_player_form=${csrf}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: new URLSearchParams({ csrf, code, choice }).toString(),
      });
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
