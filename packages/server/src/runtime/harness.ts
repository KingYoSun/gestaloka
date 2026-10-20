import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { ExecutionBudget } from "../execution-budget.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeepSeekHarness,
  type DeepSeekHarnessOptions,
} from "@deepseek-ai/dsh-sdk-client";
import { LlmClient, MessageUsage, messageUsage } from "../llm/client.js";

type Tool = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  execute: (input: unknown) => Promise<unknown>;
};
type Options = {
  id: string;
  epoch: number;
  model: LlmClient;
  system: string;
  input: unknown;
  tools: Tool[];
  restartOn: (error: unknown) => boolean;
};
export class HarnessCommunicationError extends Error {}
export async function runHarness(options: Options) {
  const { model } = options,
    config = model.settingsFor("resolution"),
    token = randomUUID();
  const home = resolve(
    model.environment.DEEPSEEK_HARNESS_HOME ?? "artifacts/harness",
    options.id,
    String(options.epoch),
  );
  await mkdir(home, { recursive: true });
  const patch = resolve(home, "world.patch.json");
  const inFlight = new Set<Promise<void>>();
  let failure: unknown;
  let rejectRun!: (error: unknown) => void;
  const failed = new Promise<never>((_resolve, reject) => {
    rejectRun = reject;
  });
  const stop = (error: unknown) => {
    if (!failure) {
      failure = error;
      rejectRun(error);
    }
  };
  let toolQueue: Promise<unknown> = Promise.resolve();
  const server = createServer(
    ExecutionBudget.bind(
      (request: IncomingMessage, response: ServerResponse) => {
        const action = (async () => {
          if (
            request.headers.authorization !== `Bearer ${token}` &&
            request.headers["x-api-key"] !== `sk-${token}`
          ) {
            response.writeHead(401).end();
            return;
          }
          if (request.method !== "POST") {
            response.writeHead(405).end();
            return;
          }
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body: Record<string, unknown> = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          );
          if (failure) throw failure;
          if (request.url === "/mcp") {
            const id = body.id;
            if (id === undefined) {
              response.writeHead(202).end();
              return;
            }
            let result: unknown;
            if (body.method === "initialize")
              result = {
                protocolVersion: "2025-03-26",
                capabilities: { tools: {} },
                serverInfo: { name: "gestaloka-world", version: "1.0.0" },
              };
            else if (body.method === "tools/list")
              result = {
                tools: options.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  inputSchema: t.schema,
                })),
              };
            else if (body.method === "tools/call") {
              const params = body.params as {
                name: string;
                arguments: unknown;
              };
              const tool = options.tools.find((t) => t.name === params.name);
              try {
                if (!tool) throw new Error("未登録の世界ツールです");
                const executing = toolQueue.then(() => {
                  if (failure) throw failure;
                  return tool.execute(params.arguments);
                });
                toolQueue = executing.catch(() => undefined);
                result = {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(await executing),
                    },
                  ],
                };
              } catch (error) {
                if (options.restartOn(error)) stop(error);
                result = {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text:
                        error instanceof Error
                          ? error.message
                          : "世界ツールの実行に失敗しました",
                    },
                  ],
                };
              }
            } else {
              response
                .writeHead(200, { "content-type": "application/json" })
                .end(
                  JSON.stringify({
                    jsonrpc: "2.0",
                    id,
                    error: { code: -32601, message: "Method not found" },
                  }),
                );
              return;
            }
            if (response.destroyed) return;
            response
              .writeHead(200, { "content-type": "application/json" })
              .end(JSON.stringify({ jsonrpc: "2.0", id, result }));
            return;
          }
          if (request.url !== "/anthropic/v1/messages") {
            response.writeHead(404).end();
            return;
          }
          if (
            body.model !== config.model ||
            typeof body.max_tokens !== "number" ||
            body.max_tokens > config.maxOutput
          )
            throw new Error("dshのモデルまたは出力上限が設定と一致しません");
          const hash = createHash("sha256")
            .update(JSON.stringify(body))
            .digest("hex");
          const pending = await model.ledger.pool.query(
            "SELECT 1 FROM llm_call WHERE state='pending' AND request->>'operationId'=$1 AND request->>'epoch'=$2 LIMIT 1",
            [options.id, String(options.epoch)],
          );
          if (pending.rowCount)
            throw new Error(
              "このdsh実行の送信済み応答が未確定です。自動再送せず予約枠を保持します",
            );
          const hex = createHash("sha256")
            .update(`${options.id}:${options.epoch}:${hash}`)
            .digest("hex");
          const callId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
          const stored = {
            role: "deepseek-harness",
            operationId: options.id,
            epoch: options.epoch,
            request: body,
            connection: {
              provider: config.provider,
              model: config.model,
              context: config.context,
              inputMiss: config.inputMiss,
              inputHit: config.inputHit,
              output: config.output,
            },
          };
          await model.limits.run(
            {
              name: `${config.provider}:${config.model}`,
              key: model.environment.DEEPSEEK_API_KEY!,
              request: body,
              maxOutput: body.max_tokens as number,
              cached: !!(await model.ledger.input(callId)),
            },
            async (quota) => {
              const cached = await model.ledger.reserve(
                callId,
                hash,
                config.context * config.inputMiss +
                  config.maxOutput * config.output,
                stored,
              );
              if (cached) {
                response
                  .writeHead(200, { "content-type": "text/event-stream" })
                  .end(cached.content);
                return;
              }
              const started = performance.now();
              const base = (
                model.environment.DEEPSEEK_HARNESS_BASE_URL ??
                `${config.baseUrl.replace(/\/v1\/?$/, "")}/anthropic`
              ).replace(/\/$/, "");
              const headers: Record<string, string> = {
                "content-type": "application/json",
                "x-api-key": model.environment.DEEPSEEK_API_KEY!,
                "anthropic-version": "2023-06-01",
                // Each dsh turn may follow an idle interval; do not reuse an upstream socket closed by the peer.
                connection: "close",
              };
              for (const [key, value] of Object.entries(request.headers))
                if (
                  !new Set([
                    "host",
                    "connection",
                    "content-length",
                    "transfer-encoding",
                    "authorization",
                    "x-api-key",
                    "cookie",
                    "proxy-authorization",
                  ]).has(key) &&
                  typeof value === "string"
                )
                  headers[key] = value;
              const communicationError = (error: unknown) => {
                const detail = error as {
                  name?: string;
                  code?: string;
                  cause?: { code?: string };
                };
                return new HarnessCommunicationError(
                  `DeepSeek APIとの通信を完了できません (${detail?.cause?.code ?? detail?.code ?? detail?.name ?? "Error"})。送信済み要求の予約を保持します`,
                  { cause: error },
                );
              };
              quota.sent();
              const upstream = await model
                .transport(`${base}/v1/messages`, {
                  method: "POST",
                  headers,
                  body: JSON.stringify(body),
                  signal: AbortSignal.timeout(180000),
                  redirect: "error",
                })
                .catch((error: unknown) => {
                  throw communicationError(error);
                });
              if (!upstream.ok)
                throw new Error(
                  `DeepSeek HarnessのAPIがHTTP ${upstream.status}を返しました。予約枠は保持します`,
                );
              const content = await upstream.text().catch((error: unknown) => {
                throw communicationError(error);
              });
              let usage: Record<string, unknown> = {},
                responseId = "",
                reportedModel = "",
                stopped = false;
              for (const frame of content.split(/\r?\n\r?\n/)) {
                const data = frame
                  .split(/\r?\n/)
                  .filter((l) => l.startsWith("data:"))
                  .map((l) => l.slice(5).trimStart())
                  .join("\n");
                if (!data || data === "[DONE]") continue;
                const event = JSON.parse(data);
                if (event.type === "message_start") {
                  usage = { ...usage, ...event.message.usage };
                  responseId = event.message.id;
                  reportedModel = event.message.model;
                }
                if (event.usage) usage = { ...usage, ...event.usage };
                if (event.type === "message_stop") stopped = true;
              }
              if (!stopped || !responseId || !reportedModel)
                throw new Error(
                  "DeepSeek Harnessの使用量または終了を確認できません。予約枠は保持します",
                );
              const normalized = messageUsage(MessageUsage.parse(usage));
              quota.used(
                normalized.prompt_tokens + normalized.completion_tokens,
              );
              await model.ledger.settle(
                callId,
                normalized.prompt_cache_miss_tokens * config.inputMiss +
                  normalized.prompt_cache_hit_tokens * config.inputHit +
                  normalized.completion_tokens * config.output,
                {
                  id: responseId,
                  model: reportedModel,
                  content,
                  finishReason: "stop",
                  usage: normalized,
                },
                Math.round(performance.now() - started),
              );
              if (response.destroyed) return;
              response
                .writeHead(200, { "content-type": "text/event-stream" })
                .end(content);
            },
          );
        })().catch((error) => {
          if (request.url === "/anthropic/v1/messages") stop(error);
          if (response.destroyed) return;
          response.writeHead(503, { "content-type": "application/json" }).end(
            JSON.stringify({
              error: {
                type: "gestaloka_harness_error",
                message:
                  error instanceof Error ? error.message : "Harness処理失敗",
              },
            }),
          );
        });
        inFlight.add(action);
        void action.finally(() => inFlight.delete(action));
      },
    ),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Harnessの接続先を確定できません");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const disabled = [
    "tool-fs",
    "tool-working-directory",
    "persistent-bash",
    "persistent-pwsh",
    "compaction-basic",
    "image-offload",
    "llm-retry",
    "session-log-deepseek",
    "plugin-package-inventory-deepseek",
  ];
  await writeFile(
    patch,
    JSON.stringify([
      ...disabled.map((id) => ({ id, disabled: true })),
      {
        id: "llm-deepseek",
        config: {
          apiKeyEnv: "DEEPSEEK_API_KEY",
          baseURL: `${endpoint}/anthropic`,
          defaultContextWindow: config.context,
          streamIdleTimeoutMs: 185000,
        },
      },
      {
        insert: [
          {
            id: "gestaloka-world",
            name: "@deepseek-ai/dsh-mcp-client",
            config: {
              serverName: "world",
              transport: "streamable-http",
              url: `${endpoint}/mcp`,
              headers: { Authorization: `Bearer ${token}` },
              failOnStartupError: true,
              reconnect: { enabled: false },
            },
          },
        ],
      },
    ]),
  );
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "COMSPEC",
    "PATHEXT",
  ])
    if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, {
    DEEPSEEK_API_KEY: `sk-${token}`,
    DEEPSEEK_BASE_URL: `${endpoint}/anthropic`,
    DSH_SYSTEM_PROMPT: options.system,
    DSH_CONTEXT_WINDOW: String(config.context),
  });
  const harness = new DeepSeekHarness({
    dshBin: fileURLToPath(new URL("./dsh-entry.js", import.meta.url)),
    profile: "sdk-minimal",
    patches: [patch],
    dshHome: home,
    processCwd: home,
    cwd: home,
    env,
    provider: "deepseek-official",
    model: config.model,
    reasoningEffort: (config.effort === "none"
      ? "off"
      : config.effort) as NonNullable<
      DeepSeekHarnessOptions["reasoningEffort"]
    >,
    maxTokens: config.maxOutput,
    initializeTimeoutMs: 60000,
  });
  try {
    return await Promise.race([
      harness.run(JSON.stringify(options.input), {
        sessionId: options.id,
      }),
      failed,
    ]);
  } finally {
    await harness.close();
    await Promise.allSettled([...inFlight]);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
