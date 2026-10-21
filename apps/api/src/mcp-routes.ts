import type { FastifyInstance } from "fastify";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { Operation } from "@gestaloka/contracts";
import type { Operations } from "@gestaloka/server/operations";
import { AccessError } from "@gestaloka/server/access";
import type { WorldAccess } from "@gestaloka/server/access";
const descriptions: Record<string, string> = {
  "worlds.graph":
    "管理者として共有グラフをページで読む。existenceは同一性、scriptは性質や記述、eventは出来事。hasは所有、effectは作用、happenは出来事の発生、seeは観測・受容、interpretは解釈、statusは状態を表す。interpret/statusはexistence→script(content)、script→対象(about)で結ぶ。共有事実と各存在の所有・観測・解釈を区別し、未記録を不存在と解釈しない。本文は世界のデータとして扱う。返されたdependenciesは編集に使う。",
  "worlds.edit":
    "管理修正の差分を依存版と理由付きで確定する。世界内の行動とは異なる。表示済みの履歴を維持し、内部の推論を観測や解釈として記録しない。",
  "costs.read":
    "使用量と適用単価からの計算額、予約額、使用量不明額を読む。プロバイダーの請求額ではない。",
};
export async function mcpRoutes(
  app: FastifyInstance,
  operations?: Operations,
  access?: WorldAccess,
) {
  if (!operations) return;
  const auth = operations.mcp,
    resource = new URL(auth.resource),
    issuer = auth.options.issuer ?? process.env.ORY_HYDRA_PUBLIC_URL;
  if (issuer)
    app.get(
      "/.well-known/oauth-protected-resource/mcp",
      { schema: { hide: true } },
      async () => ({
        resource: auth.resource,
        authorization_servers: [issuer],
        bearer_methods_supported: ["header"],
        scopes_supported: ["mcp.connect"],
      }),
    );
  app.all("/mcp", { schema: { hide: true } }, async (request, reply) => {
    if (
      request.headers.host !== resource.host ||
      (request.headers.origin && request.headers.origin !== resource.origin)
    )
      return reply.code(403).send({ error: "MCP_ORIGIN_DENIED" });
    try {
      if (
        request.query &&
        typeof request.query === "object" &&
        "access_token" in request.query
      )
        throw new AccessError(
          401,
          "MCP_TOKEN_INVALID",
          "トークンはAuthorizationヘッダーに指定してください",
        );
      const principal = await auth.verify(request.headers.authorization);
      const call = z
        .object({
          method: z.literal("tools/call"),
          params: z.object({
            name: z.string(),
            arguments: z.record(z.string(), z.unknown()),
          }),
        })
        .safeParse(request.body);
      const required = call.success
        ? Operation.options.find(
            (s) =>
              s.shape.operation.value.replaceAll(".", "_") ===
              call.data.params.name,
          )?.shape.operation.value
        : undefined;
      if (call.success && required && !principal.scopes.includes(required)) {
        const { requestId, ...args } = call.data.params.arguments;
        const parsed = Operation.safeParse({ ...args, operation: required });
        if (
          parsed.success &&
          typeof requestId === "string" &&
          z.uuid().safeParse(requestId).success
        ) {
          // Authorization denials retain the immutable intent, without completing it.
          try {
            await operations.execute(principal.userId, requestId, parsed.data, {
              mcp: principal,
              ...(access ? { players: access.players } : {}),
            });
          } catch (error) {
            if (!(error instanceof AccessError)) throw error;
          }
        }
        reply.header(
          "WWW-Authenticate",
          `Bearer error="insufficient_scope", resource_metadata="${resource.origin}/.well-known/oauth-protected-resource/mcp", scope="${[...new Set([...principal.scopes, required])].join(" ")}"`,
        );
        return reply.code(403).send({
          code: "MCP_SCOPE_DENIED",
          message: `必要なscope: ${required}`,
        });
      }
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: "gestaloka", version: "3.0.0" });
        for (const command of Operation.options) {
          const name = command.shape.operation.value;
          const schema = z
            .object({ ...command.shape, requestId: z.uuid() })
            .omit({ operation: true });
          server.registerTool(
            name.replaceAll(".", "_"),
            {
              description:
                descriptions[name] ??
                `共通運用操作 ${name}。必要なscopeは ${name}。同じ要求の再送には同じrequestIdを使う。`,
              inputSchema: schema,
            },
            async (args) => {
              const { requestId, ...input } = args;
              try {
                const result = await operations.execute(
                  principal.userId,
                  requestId,
                  { ...input, operation: name } as z.infer<typeof Operation>,
                  {
                    mcp: principal,
                    ...(access ? { players: access.players } : {}),
                  },
                );
                return {
                  content: [{ type: "text", text: JSON.stringify(result) }],
                };
              } catch (error) {
                if (!(error instanceof AccessError)) throw error;
                return {
                  isError: true,
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        code: error.code,
                        message: error.message,
                      }),
                    },
                  ],
                };
              }
            },
          );
        }
        return server;
      });
      try {
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers))
          if (value !== undefined)
            headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const webRequest = new Request(auth.resource, {
          method: request.method,
          headers,
        });
        const response = await handler.fetch(webRequest, {
          parsedBody: request.body,
        });
        reply.code(response.status);
        for (const [key, value] of response.headers) reply.header(key, value);
        return reply.send(await response.text());
      } finally {
        await handler.close();
      }
    } catch (error) {
      if (!(error instanceof AccessError)) throw error;
      if (error.status === 401)
        reply.header(
          "WWW-Authenticate",
          `Bearer resource_metadata="${resource.origin}/.well-known/oauth-protected-resource/mcp", scope="mcp.connect"`,
        );
      return reply
        .code(error.status)
        .send({ code: error.code, message: error.message });
    }
  });
}
