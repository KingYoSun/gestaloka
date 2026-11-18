import { playerCliRelease } from "./player-distribution-routes.js";
import type { FastifyInstance } from "fastify";
import { parse } from "semver";

export function registerPlayerCliVersion(
  app: FastifyInstance,
  published = async () => (await playerCliRelease()).version,
) {
  app.addHook("onRequest", async (req, reply) => {
    const route = req.routeOptions.url ?? "";
    if (!(
      route === "/api/player-devices" ||
      route === "/api/player-device" ||
      (req.headers.authorization &&
        (route.startsWith("/api/worlds/") || route === "/api/operations"))
    ))
      return;
    const version = await published(),
      current = parse(version);
    if (!current) throw new Error("配布CLIの版番号が不正です");
    const header = req.headers["x-gestaloka-cli-version"];
    // All clients shipped before 0.17 belonged to major 0 and sent no header.
    const client =
      header === undefined
        ? 0
        : typeof header === "string"
          ? parse(header)?.major
          : undefined;
    if (client !== undefined && client >= current.major) return;
    return reply.code(426).send({
      code: "PLAYER_CLI_UPDATE_REQUIRED",
      message: `この接続先のプレイヤーCLIは ${version} です。gestaloka update で更新してください。操作の返答を失った場合は更新後に recover で照合できます。update がない旧版は、この接続先の /api/player-cli/setup.md に従って最新版を導入してください。`,
    });
  });
}
