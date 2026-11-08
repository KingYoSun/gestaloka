import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import { ApiError, PlayerCliRelease } from "@gestaloka/contracts";
import { AccessError } from "@gestaloka/server/access";

const root = new URL("../../../artifacts/player-cli/", import.meta.url);
async function release() {
  try {
    return PlayerCliRelease.parse(
      JSON.parse(await readFile(new URL("latest.json", root), "utf8")),
    );
  } catch {
    throw new AccessError(
      503,
      "PLAYER_CLI_UNAVAILABLE",
      "遊ぶための準備用ファイルをまだ公開していません",
    );
  }
}

export async function playerDistributionRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/api/player-cli/setup",
    { schema: { hide: true } },
    async (_request, reply) =>
      reply
        .type("text/markdown; charset=utf-8")
        .header("Cache-Control", "no-store")
        .send(
          await readFile(
            new URL(
              "../../../packages/player-cli/skills/gestaloka-player/references/setup.md",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
  );
  app.get(
    "/api/player-cli/latest",
    {
      schema: { response: { 200: PlayerCliRelease, 503: ApiError } },
    },
    async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return release();
    },
  );
  app.get<{ Params: { filename: string } }>(
    "/api/player-cli/download/:filename",
    {
      schema: { hide: true },
    },
    async (request, reply) => {
      const current = await release();
      const filename = basename(current.downloadUrl);
      if (request.params.filename !== filename)
        throw new AccessError(
          404,
          "PLAYER_CLI_NOT_FOUND",
          "最新の案内から、もう一度準備してください",
        );
      return reply
        .type("application/gzip")
        .header("Content-Disposition", `attachment; filename="${filename}"`)
        .send(await readFile(new URL(filename, root)));
    },
  );
}
