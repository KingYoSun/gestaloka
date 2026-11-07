#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  PlayerDeviceCode,
  PlayerDeviceStatus,
  SceneResponse,
  SceneCommand,
  KnowledgePage,
  SceneRecordPage,
  JoinWorld,
  PlayerIconInput,
  WorldPlayerPage,
} from "@gestaloka/contracts";

const help = `GESTALOKA プレイヤーCLI（Node.js 22.23.4以上）
gestaloka connect --server <公開URL> --world <村のURLまたはID>
  表示する認可URLを持ち主に渡し、ブラウザーで確認コードと対象人物を確認して許可します。
gestaloka status                         認可・参加・現在のシーンを照会
gestaloka join [--icon <画像ファイル>]    許可された新規参加を開始
gestaloka icon [--file <画像> | --clear]  許可された人物のアイコンを確認・更新・解除
gestaloka prepare --purpose <目的>       シーンのあらすじを準備
gestaloka start                          準備したシーンを開始
gestaloka act --text <自由記述>           一手を送信（--file <UTF-8ファイル>も可）
gestaloka finish                         シーンを終了しリザルトを準備
gestaloka result                         現在のリザルトを照会
gestaloka resume                         保留中の参加・シーンを明示再開
gestaloka knowledge [--since <checkpoint>] 本人の観測・解釈の履歴。前回取得時との差分を取得
gestaloka history --scene <id> --kind <events|actions> [--before <cursor>]
gestaloka recover [--request <要求ID>]    保存した同じ要求を照合して最新状態を取得
全コマンド: --profile <ファイル>。既定はXDG_STATE_HOMEまたは~/.local/stateのgestaloka/default.json。
出力はJSON、成功は終了コード0、エラーは1。照会では世界を進めません。
応答喪失時は表示したrequestIdまたは最後の要求をrecoverで照合してください。
許可の解除: 公開URLの/auth/player。サーバー・DB・モデルのAPIキーは不要です。
`;
const Profile = z.object({
  server: z.url(),
  worldId: z.uuid(),
  deviceId: z.uuid(),
  secret: z.string(),
  lastRequestId: z.uuid().optional(),
  knowledgeCheckpoint: z.uuid().optional(),
  joinIconRequestId: z.uuid().optional(),
});
const Request = z.object({
  id: z.uuid(),
  path: z.string(),
  body: z.record(z.string(), z.unknown()),
  authenticated: z.boolean(),
  method: z.enum(["POST", "PUT"]).default("POST"),
});
type Profile = z.infer<typeof Profile>;
const parse = () =>
  parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      server: { type: "string" },
      world: { type: "string" },
      profile: { type: "string" },
      purpose: { type: "string" },
      text: { type: "string" },
      file: { type: "string" },
      after: { type: "string" },
      before: { type: "string" },
      scene: { type: "string" },
      kind: { type: "string" },
      request: { type: "string" },
      since: { type: "string" },
      icon: { type: "string" },
      clear: { type: "boolean" },
    },
  });
let values: ReturnType<typeof parse>["values"];
let profilePath: string, journal: string;
let requestId: string | undefined;
async function save(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(data) + "\n", { mode: 0o600 });
  await rename(temporary, path);
}
async function load() {
  return Profile.parse(JSON.parse(await readFile(profilePath, "utf8")));
}
async function http(
  profile: Profile,
  path: string,
  body?: unknown,
  authenticated = true,
  method = "POST",
) {
  const response = await fetch(new URL(path, profile.server), {
    method: body === undefined ? "GET" : method,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      ...(authenticated ? { authorization: `Bearer ${profile.secret}` } : {}),
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", "x-gestaloka-request": "1" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.message ?? `HTTP ${response.status}`), {
      code: data.code ?? "HTTP_ERROR",
    });
  return data;
}
async function status(profile: Profile) {
  const device = PlayerDeviceStatus.parse(
    await http(profile, "/api/player-device"),
  );
  if (device.state !== "ready") return { state: device.state, device };
  const { scene } = SceneResponse.parse(
    await http(
      profile,
      `/api/worlds/${profile.worldId}/scene?actorId=${device.actorId}`,
    ),
  );
  return {
    state: !scene
      ? "no_scene"
      : scene.state === "active"
        ? "waiting_input"
        : scene.state === "result"
          ? "finished"
          : scene.state === "ready"
            ? "prepared"
            : scene.state === "paused"
              ? "paused"
              : "processing",
    device,
    scene,
  };
}
async function send(
  profile: Profile,
  saved: z.infer<typeof Request>,
): Promise<Record<string, unknown>> {
  requestId = saved.id;
  const result = await http(
    profile,
    saved.path,
    saved.body,
    saved.authenticated,
    saved.method,
  );
  await save(join(journal, `${saved.id}.json`), { ...saved, result });
  if (profile.joinIconRequestId === saved.id) {
    delete profile.joinIconRequestId;
    await save(profilePath, profile);
  }
  if (!saved.authenticated) {
    const code = PlayerDeviceCode.parse(result);
    return {
      ...(await status(profile)),
      requestId,
      ...code,
      verificationUrl: new URL(code.verificationPath, profile.server).href,
    };
  }
  if (
    saved.body.command &&
    (saved.body.command as { operation?: string }).operation ===
      "worlds.join" &&
    profile.joinIconRequestId
  ) {
    profile.lastRequestId = profile.joinIconRequestId;
    await save(profilePath, profile);
    return {
      joinRequestId: saved.id,
      ...(await send(
        profile,
        Request.parse(
          JSON.parse(
            await readFile(
              join(journal, `${profile.joinIconRequestId}.json`),
              "utf8",
            ),
          ),
        ),
      )),
    };
  }
  return { requestId, result, ...(await status(profile)) };
}
async function submit(
  profile: Profile,
  path: string,
  body: Record<string, unknown>,
  authenticated = true,
  id: string = randomUUID(),
  method: "POST" | "PUT" = "POST",
) {
  requestId = id;
  const saved = {
    id,
    path,
    body: method === "PUT" ? body : { ...body, requestId: id },
    authenticated,
    method,
  };
  await save(join(journal, `${id}.json`), saved);
  await save(profilePath, { ...profile, lastRequestId: id });
  return send(profile, saved);
}
async function run() {
  const parsed = parse();
  values = parsed.values;
  const positionals = parsed.positionals,
    command = positionals[0] ?? "help";
  profilePath =
    values.profile ??
    join(
      process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
      "gestaloka",
      "default.json",
    );
  journal = `${profilePath}.requests`;
  if (command === "help" || values.help) return { help };
  if (positionals.length > 1)
    throw new Error("コマンドは1つ指定してください（helpを参照）");
  if (command === "connect") {
    if (!values.server || !values.world)
      throw new Error("--serverと--worldを指定してください");
    const server = new URL(values.server).origin;
    const worldId = z
      .uuid()
      .parse(
        URL.canParse(values.world)
          ? new URL(values.world).pathname.match(
              /\/worlds\/([a-f0-9-]{36})(?:\/|$)/i,
            )?.[1]
          : values.world,
      );
    let profile: Profile;
    try {
      profile = await load();
      if (profile.server !== server || profile.worldId !== worldId)
        throw new Error("別の接続には別の--profileを指定してください");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      profile = {
        server,
        worldId,
        deviceId: randomUUID(),
        secret: randomBytes(32).toString("hex"),
      };
      await save(profilePath, profile);
    }
    return submit(
      profile,
      "/api/player-devices",
      { worldId, secret: profile.secret },
      false,
      profile.deviceId,
    );
  }
  const profile = await load();
  if (["status", "result"].includes(command)) return status(profile);
  if (command === "recover") {
    const id = z.uuid().parse(values.request ?? profile.lastRequestId);
    return send(
      profile,
      Request.parse(
        JSON.parse(await readFile(join(journal, `${id}.json`), "utf8")),
      ),
    );
  }
  if (command === "knowledge" || command === "history") {
    const query = new URLSearchParams();
    for (const key of ["before", "after"] as const)
      if (values[key]) query.set(key, values[key]!);
    if (command === "history") {
      query.set("sceneId", z.uuid().parse(values.scene));
      query.set(
        "kind",
        z.enum(["events", "actions"]).parse(values.kind ?? "events"),
      );
    }
    const data = await http(
      profile,
      `/api/worlds/${profile.worldId}/${command === "history" ? "scene/records" : "knowledge"}?${query}`,
    );
    if (command === "history")
      return { state: "history", ...SceneRecordPage.parse(data) };
    const page = KnowledgePage.parse(data),
      since = values.since ? z.uuid().parse(values.since) : undefined;
    const readIds = async (id: string) =>
      new Set(
        z
          .array(z.uuid())
          .parse(
            JSON.parse(
              await readFile(join(journal, "knowledge", `${id}.json`), "utf8"),
            ),
          ),
      );
    const known = since ? await readIds(since) : new Set<string>();
    const checkpoint =
      values.before && profile.knowledgeCheckpoint
        ? profile.knowledgeCheckpoint
        : randomUUID();
    const accumulated =
      values.before && profile.knowledgeCheckpoint
        ? await readIds(checkpoint)
        : new Set(known);
    for (const item of page.items) accumulated.add(item.id);
    await save(join(journal, "knowledge", `${checkpoint}.json`), [
      ...accumulated,
    ]);
    await save(profilePath, { ...profile, knowledgeCheckpoint: checkpoint });
    return {
      state: "history",
      ...page,
      checkpoint,
      items: page.items.filter((item) => !known.has(item.id)),
    };
  }
  const device = PlayerDeviceStatus.parse(
    await http(profile, "/api/player-device"),
  );
  if (command === "icon") {
    const player = WorldPlayerPage.parse(
      await http(profile, `/api/worlds/${profile.worldId}/players`),
    ).items[0];
    if (!player)
      throw new Error("参加要求または許可された人物を確認してください");
    if (values.file && values.clear)
      throw new Error("--fileと--clearはどちらか一方を指定してください");
    if (!values.file && !values.clear) return { state: "icon", player };
    const body = PlayerIconInput.parse({
      image: values.clear
        ? null
        : (await readFile(values.file!)).toString("base64"),
    });
    delete profile.joinIconRequestId;
    return submit(
      profile,
      `/api/worlds/${profile.worldId}/players/${player.id}/icon`,
      body,
      true,
      randomUUID(),
      "PUT",
    );
  }
  if (command === "join") {
    const joinCommand = JoinWorld.parse({
      operation: "worlds.join",
      worldId: profile.worldId,
      presetId: device.presetId,
      presetVersion: device.presetVersion,
    });
    if (!device.joinId) throw new Error("新規参加が許可されていません");
    if (values.icon) {
      const icon = {
        id: randomUUID(),
        path: `/api/worlds/${profile.worldId}/players/${device.joinId}/icon`,
        body: PlayerIconInput.parse({
          image: (await readFile(values.icon)).toString("base64"),
        }),
        authenticated: true,
        method: "PUT" as const,
      };
      await save(join(journal, `${icon.id}.json`), icon);
      profile.joinIconRequestId = icon.id;
    }
    return submit(
      profile,
      "/api/operations",
      { command: joinCommand },
      true,
      device.joinId,
    );
  }
  if (command === "resume" && !device.actorId && device.joinId)
    return submit(profile, "/api/operations", {
      command: { operation: "worlds.resumeJoin", joinId: device.joinId },
    });
  const body = SceneCommand.parse({
    requestId: randomUUID(),
    command,
    ...(command === "prepare" ? { purpose: values.purpose } : {}),
    ...(command === "act"
      ? {
          actionText: values.file
            ? await readFile(values.file, "utf8")
            : values.text,
        }
      : {}),
  });
  return submit(
    profile,
    `/api/worlds/${profile.worldId}/scene`,
    body,
    true,
    body.requestId,
  );
}
try {
  console.log(JSON.stringify(await run()));
} catch (error) {
  console.log(
    JSON.stringify({
      state: "error",
      ...(requestId ? { requestId } : {}),
      code: (error as { code?: string }).code ?? "CLI_ERROR",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}
