import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import { ApiError, PlayerCliRelease } from "@gestaloka/contracts";
import { AccessError } from "@gestaloka/server/access";

const root = new URL("../../../artifacts/player-cli/", import.meta.url);
const sendGuide = async (reply: FastifyReply, name: string) =>
  reply
    .type("text/markdown; charset=utf-8")
    .header("Cache-Control", "no-store")
    .header("Referrer-Policy", "no-referrer")
    .send(await readFile(new URL(name, root), "utf8"));
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
  for (const name of ["join", "setup"]) {
    for (const path of [name, `${name}.md`]) {
      app.get(
        `/api/player-cli/${path}`,
        { schema: { hide: true } },
        async (_request, reply) => sendGuide(reply, `${name}.md`),
      );
    }
  }
  app.get(
    "/api/player-cli/docs/:version/:guide",
    {
      schema: {
        hide: true,
        params: z.object({
          version: z.string(),
          guide: z.enum(["join.md", "setup.md"]),
        }),
      },
    },
    async (request, reply) => {
      const current = await release();
      if (request.params.version !== current.version)
        return reply
          .header("Cache-Control", "no-store")
          .header("Referrer-Policy", "no-referrer")
          .redirect(
            `/api/player-cli/docs/${current.version}/${request.params.guide}${new URL(request.url, "http://localhost").search}`,
          );
      return sendGuide(reply, request.params.guide);
    },
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
