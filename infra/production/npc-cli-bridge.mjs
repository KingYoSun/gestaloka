import { createServer } from "node:http";
import { createServer as createSocket } from "node:net";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs, promisify } from "node:util";
import { pathToFileURL } from "node:url";

const reads = new Set([
  "help",
  "version",
  "status",
  "result",
  "search",
  "contents",
  "viewers",
  "applications",
  "history",
  "players",
  "promotions",
  "notices",
]);
const writes = new Set([
  "start",
  "contact",
  "say",
  "comment",
  "receive",
  "withdraw",
  "exchange",
  "end-turn",
  "leave",
  "finish",
  "play",
  "memo",
  "explore",
  "promote-npc",
  "draw-configure",
  "draw",
  "bundle",
  "home-set",
  "team",
  "companion",
  "vehicle",
  "friend",
  "report",
  "recover",
]);
const fileCommands = new Set([
  "play",
  "bundle",
  "say",
  "comment",
  "memo",
  "explore",
  "draw",
  "companion",
]);
const options = {
  ...Object.fromEntries(
    (
      "participants to from label source index text author title story episode " +
      "episode-title player since until sort description expected-sp after view " +
      "before scene kind vehicle-after passenger-after target team place " +
      "application deferred-until offer payment table-version request"
    )
      .split(" ")
      .map((name) => [name, { type: "string" }]),
  ),
  ...Object.fromEntries(
    (
      "help full-ids nonverbal bookmarked stealth depart-alone-on-timeout " +
      "quote oppose clear accept reject"
    )
      .split(" ")
      .map((name) => [name, { type: "boolean" }]),
  ),
  npc: { type: "string", multiple: true },
};
const tool = {
  name: "npc_cli",
  description:
    "Run the GESTALOKA player CLI for the NPC bound to this wake lease. " +
    "Supply the usual CLI arguments as args without the node executable or " +
    "profile, instance, or file flags. Use input for text or JSON file contents. " +
    "Never display or save the lease.",
  inputSchema: {
    type: "object",
    properties: {
      npc: { type: "string" },
      lease: { type: "string" },
      callId: {
        type: "string",
        description:
          "Unique for each CLI invocation in this wake. Reuse it only to recover an interrupted response.",
      },
      args: { type: "array", items: { type: "string" } },
      input: { anyOf: [{ type: "object" }, { type: "string" }] },
    },
    required: ["npc", "lease", "callId", "args"],
    additionalProperties: false,
  },
};
const directTool = {
  ...tool,
  name: "npc_cli_direct",
  description:
    "Use the GESTALOKA CLI for the NPC bound to this connection. After a " +
    "direct request from your owner, read status, then use start if there " +
    "is no current session. Reuse callId when retrying a call.",
  inputSchema: {
    ...tool.inputSchema,
    properties: {
      callId: {
        type: "string",
        description:
          "Use a fresh UUID for each invocation. Reuse it only to retry the same invocation.",
      },
      args: tool.inputSchema.properties.args,
      input: tool.inputSchema.properties.input,
    },
    required: ["callId", "args"],
  },
};

export function validateInvocation(args, input, turn, receive = false) {
  if (
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== "string" || arg === "--")
  )
    throw new Error("INVALID_ARGUMENTS");
  const { positionals, values } = parseArgs({
    args,
    options,
    allowPositionals: true,
  });
  const [command, subcommand] = positionals;
  const read =
    reads.has(command) ||
    (command === "stories" && ["list", "read"].includes(subcommand));
  if (
    !read &&
    !(turn && writes.has(command)) &&
    !(receive && command === "receive")
  )
    throw new Error("COMMAND_DENIED");
  if (input !== undefined && !fileCommands.has(command))
    throw new Error("INPUT_DENIED");
  if (command === "play" && input?.command !== "apply")
    throw new Error("INPUT_DENIED");
  if (command === "recover" && !/^[a-f0-9-]{36}$/i.test(values.request ?? ""))
    throw new Error("REQUEST_ID_REQUIRED");
  return { command, request: values.request };
}

export function createNpcBridge({
  roles,
  run,
  verify,
  clock = Date.now,
  ttl = 10 * 60_000,
}) {
  const leases = new Map();
  const directLeases = new Map();
  const busy = new Set();
  function issue(name, turn, receive = false) {
    if (!Object.hasOwn(roles, name)) throw new Error("UNKNOWN_NPC");
    const token = randomBytes(32).toString("base64url");
    leases.set(token, {
      name,
      turn,
      receive,
      expires: clock() + ttl,
      responses: new Map(),
    });
    setTimeout(() => leases.delete(token), ttl).unref();
    return token;
  }
  async function call(input) {
    const lease = leases.get(input?.lease);
    if (!lease || lease.expires <= clock()) throw new Error("LEASE_INVALID");
    if (lease.name !== input.npc) throw new Error("WRONG_NPC");
    const id = input.callId;
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))
      throw new Error("CALL_ID_REQUIRED");
    const existing = lease.responses.get(id);
    const invocation = JSON.stringify([input.args, input.input]);
    if (existing) {
      if (existing.invocation !== invocation)
        throw new Error("DUPLICATE_REQUEST_ID");
      return existing.response;
    }
    const parsed = validateInvocation(
      input.args,
      input.input,
      lease.turn,
      lease.receive,
    );
    if (busy.has(lease.name)) throw new Error("NPC_BUSY");
    busy.add(lease.name);
    const role = roles[lease.name];
    const response = (async () => {
      try {
        if (!lease.verified) {
          await verify(role);
          lease.verified = true;
        }
        return await run(role, input.args, input.input, parsed);
      } finally {
        busy.delete(lease.name);
      }
    })();
    lease.responses.set(id, { invocation, response });
    return response;
  }
  function callDirect(npc, { callId, args, input } = {}) {
    let lease = directLeases.get(npc);
    if ((leases.get(lease)?.expires ?? 0) <= clock()) {
      lease = issue(npc, true);
      directLeases.set(npc, lease);
    }
    return call({ npc, lease, callId, args, input });
  }
  return { issue, call, callDirect };
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function requestBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const exec = promisify(execFile);
async function runCli(cli, role, args, input, parsed) {
  if (parsed?.command === "recover") {
    const saved = JSON.parse(
      await readFile(
        join(role.profile + ".requests", parsed.request + ".json"),
        "utf8",
      ),
    );
    if (saved.authenticated !== true) throw new Error("REQUEST_DENIED");
  }
  const directory =
    input === undefined ? undefined : await mkdtemp(join(tmpdir(), "npc-cli-"));
  try {
    const file = directory && join(directory, "input");
    if (file)
      await writeFile(
        file,
        typeof input === "string" ? input : JSON.stringify(input),
        { mode: 0o600 },
      );
    const { stdout } = await exec(
      process.execPath,
      [
        cli,
        ...args,
        "--profile",
        role.profile,
        ...(file ? ["--file", file] : []),
      ],
      { timeout: 90000, maxBuffer: 8 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } catch (error) {
    const output = typeof error.stdout === "string" ? error.stdout : "";
    let failure;
    try {
      failure = JSON.parse(output);
    } catch {
      throw new Error("CLI_FAILED", { cause: error });
    }
    if (failure?.state === "error" && failure.code) return failure;
    throw new Error("CLI_FAILED", { cause: error });
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

async function serve(path) {
  process.umask(0o077);
  const config = JSON.parse(await readFile(path, "utf8"));
  const { version } = JSON.parse(
    await readFile(
      new URL("../package.json", pathToFileURL(config.cli)),
      "utf8",
    ),
  );
  const bridge = createNpcBridge({
    roles: config.roles,
    async run(role, args, input, parsed) {
      const result = await runCli(config.cli, role, args, input, parsed);
      console.log(
        JSON.stringify({
          npc: role.name,
          command: parsed.command,
          state: result.state,
          ...(result.code ? { code: result.code } : {}),
        }),
      );
      return result;
    },
    async verify(role) {
      const profile = JSON.parse(await readFile(role.profile, "utf8"));
      if (
        profile.deviceId !== role.deviceId ||
        profile.worldId !== role.worldId
      )
        throw new Error("PROFILE_MISMATCH");
      const origin = new URL(profile.server);
      if (
        origin.protocol !== "https:" ||
        origin.username ||
        origin.password ||
        !["api.gestaloka.com", "play.gestaloka.com"].includes(origin.hostname)
      )
        throw new Error("PROFILE_MISMATCH");
      const response = await fetch(new URL("/api/player-device", origin), {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          "x-gestaloka-cli-version": version,
          authorization: "Bearer " + profile.secret,
        },
      });
      if (!response.ok) throw new Error("PROFILE_MISMATCH");
      const status = await response.json();
      if (
        status.state !== "ready" ||
        status.id !== role.deviceId ||
        status.actorId !== role.actorId ||
        status.worldId !== role.worldId ||
        status.legalConsentRequired
      )
        throw new Error("PROFILE_MISMATCH");
    },
  });
  const server = createNpcMcpServer(bridge, config.roles);
  server.listen(config.port, config.address);
  for (const address of config.sockets) {
    const previous = await lstat(address).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (previous) {
      if (!previous.isSocket()) throw new Error("Invalid mint socket path");
      await unlink(address);
    }
    const socket = createSocket((client) => {
      client.setTimeout(2500, () => client.destroy());
      let data = "";
      client.on("error", () => client.destroy());
      client.on("data", (chunk) => {
        data += chunk;
        if (data.length > 256) return client.destroy();
        if (!data.endsWith("\n")) return;
        try {
          const { npc, turn, receive } = JSON.parse(data);
          client.end(bridge.issue(npc, turn === true, receive === true) + "\n");
        } catch {
          client.destroy();
        }
      });
    });
    socket.listen(address, () => {
      void chmod(address, 0o600);
    });
  }
}

export function createNpcMcpServer(bridge, roles) {
  const server = createServer(async (req, res) => {
    const npc = /^\/direct\/([a-z0-9_-]+)\/mcp$/.exec(req.url)?.[1];
    if (!npc && req.url !== "/mcp") return json(res, 404);
    if (req.headers.origin) return json(res, 403);
    if (req.method !== "POST") return json(res, 405);
    if (npc) {
      const hash = Object.hasOwn(roles, npc) && roles[npc].directTokenSha256;
      const token = /^Bearer ([\w-]{43})$/i.exec(
        req.headers.authorization,
      )?.[1];
      if (
        !token ||
        !hash ||
        !/^[a-f0-9]{64}$/.test(hash) ||
        !timingSafeEqual(
          Buffer.from(hash, "hex"),
          createHash("sha256").update(token).digest(),
        )
      )
        return json(res, 401);
    }
    const availableTool = npc ? directTool : tool;
    let msg;
    try {
      msg = await requestBody(req);
    } catch {
      return json(res, 400);
    }
    if (!msg || msg.jsonrpc !== "2.0") return json(res, 400);
    if (!Object.hasOwn(msg, "id")) return json(res, 202);
    if (typeof msg.id !== "string" && typeof msg.id !== "number")
      return json(res, 400);
    const result = (payload) =>
      json(res, 200, { jsonrpc: "2.0", id: msg.id, result: payload });
    if (msg.method === "initialize")
      return result({
        protocolVersion: ["2025-03-26", "2025-06-18", "2025-11-25"].includes(
          msg.params?.protocolVersion,
        )
          ? msg.params.protocolVersion
          : "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "gestaloka-npc-cli", version: "1" },
      });
    if (msg.method === "ping") return result({});
    if (msg.method === "tools/list") return result({ tools: [availableTool] });
    if (msg.method !== "tools/call" || msg.params?.name !== availableTool.name)
      return json(res, 200, {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "Method not found" },
      });
    try {
      const value = npc
        ? await bridge.callDirect(npc, msg.params.arguments)
        : await bridge.call(msg.params.arguments);
      return result({
        content: [{ type: "text", text: JSON.stringify(value) }],
        ...(value.code ? { isError: true } : {}),
      });
    } catch (error) {
      const code = /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "INVALID_ARGUMENTS";
      return result({
        content: [{ type: "text", text: JSON.stringify({ error: code }) }],
        isError: true,
      });
    }
  });
  server.requestTimeout = 10000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await serve(process.argv[2]);
