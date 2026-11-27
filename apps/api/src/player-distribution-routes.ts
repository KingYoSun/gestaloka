import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { micromark } from "micromark";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import { ApiError, PlayerCliRelease } from "@gestaloka/contracts";
import { AccessError } from "@gestaloka/server/access";
import type { Operations } from "@gestaloka/server/operations";
import {
  legalContact,
  legalContactUrl,
  legalOperator,
} from "@gestaloka/server/legal";

const root = new URL("../../../artifacts/player-cli/", import.meta.url);
const referenceGuide = z.enum([
  "join.md",
  "setup.md",
  "runtimes.md",
  "commands.md",
  "cli.md",
  "dice.md",
  "draw.md",
  "blueprints.md",
  "inventory.md",
  "sessions.md",
  "npcs.md",
  "vehicles.md",
  "health.md",
  "stories.md",
]);
type BackupReader = Pick<Operations["backups"], "call">;
async function readGuide(name: string, backups?: BackupReader) {
  const source = await readFile(new URL(name, root), "utf8");
  if (name !== "join.md") return source;
  const literal = (text: string) =>
    text.replace(/[\\`*_{}[\]()<>#!|&~]/g, "\\$&");
  const contact = legalContactUrl
    ? `[${literal(legalContact)}](<${legalContactUrl.replace(/[<>\\\s]/g, encodeURIComponent)}>)`
    : literal(legalContact || "未設定");
  const origin = process.env.ORY_APP_URL?.replace(/\/$/, "") ?? "";
  const policy = z
    .object({
      configured: z.boolean(),
      configuration: z.object({ retentionDays: z.number().int().positive() }),
    })
    .safeParse(await backups?.call("read").catch(() => undefined));
  const days =
    policy.success && policy.data.configured
      ? policy.data.configuration.retentionDays
      : null;
  return source.replace(/^<!-- 運営情報 -->.*$/m, () =>
    [
      `運営者：${literal(legalOperator || "未設定")}。個人データの削除請求窓口：${contact}`,
      `登録前に[利用規約](${origin}/auth/terms)と[プライバシーポリシー](${origin}/auth/privacy)の全文を読めます。`,
      `[退会の申請](${origin}/auth/withdraw)はアカウントの持ち主が行います。` +
        (days !== null
          ? ` このサーバーのバックアップ保存期限は取得から${days}日以内です。退会者の削除対象データは、バックアップを含めて退会確定から最長${30 + days}日以内に消去します。`
          : policy.success
            ? " このサーバーにはバックアップの保存先が設定されていません。"
            : " バックアップの保持日数は現在取得できません。運営窓口にお問い合わせください。"),
    ].join("\n\n"),
  );
}
const sendGuide = async (
  reply: FastifyReply,
  name: string,
  backups?: BackupReader,
) =>
  reply
    .type("text/markdown; charset=utf-8")
    .header("Cache-Control", "no-store")
    .header("Referrer-Policy", "no-referrer")
    .send(await readGuide(name, backups));
export async function playerCliRelease() {
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

export async function playerDistributionRoutes(
  instance: FastifyInstance,
  backups?: BackupReader,
) {
  const app = instance.withTypeProvider<ZodTypeProvider>();
  app.get(
    "/api/player-cli/",
    { schema: { hide: true } },
    async (_request, reply) => {
      const [index, guide] = await Promise.all([
        readFile(new URL("../player-cli-index.html", import.meta.url), "utf8"),
        readGuide("join.md", backups),
      ]);
      const notice = guide
        .split(/(?=^## )/m)
        .find((section) => section.startsWith("## 参加する前に"));
      if (!notice) throw new Error("参加案内に「参加する前に」がありません");
      return reply
        .type("text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer")
        .send(index.replace("<!-- 参加する前に -->", () => micromark(notice)));
    },
  );
  for (const file of [...referenceGuide.options, "SKILL.md"]) {
    for (const path of [basename(file, ".md"), file, `references/${file}`]) {
      app.get(
        `/api/player-cli/${path}`,
        { schema: { hide: true } },
        async (_request, reply) => sendGuide(reply, file, backups),
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
          guide: referenceGuide,
        }),
      },
    },
    async (request, reply) => {
      const current = await playerCliRelease();
      if (request.params.version !== current.version)
        return reply
          .header("Cache-Control", "no-store")
          .header("Referrer-Policy", "no-referrer")
          .redirect(
            `/api/player-cli/docs/${current.version}/${request.params.guide}${new URL(request.url, "http://localhost").search}`,
          );
      return sendGuide(reply, request.params.guide, backups);
    },
  );
  app.get(
    "/api/player-cli/latest",
    {
      schema: { response: { 200: PlayerCliRelease, 503: ApiError } },
    },
    async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      return playerCliRelease();
    },
  );
  app.get<{ Params: { filename: string } }>(
    "/api/player-cli/download/:filename",
    {
      schema: { hide: true },
    },
    async (request, reply) => {
      const current = await playerCliRelease();
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
