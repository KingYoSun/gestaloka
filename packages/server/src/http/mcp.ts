import { randomUUID, createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { Operation, McpClientConfiguration } from "@gestaloka/contracts";
import { AccessError } from "./access.js";
import type { McpPermission } from "./mcp-origin.js";
export const MCP_CONNECT = "mcp.connect";
const operationNames: readonly string[] = Operation.options.map(
  (s) => s.shape.operation.value,
);
type Database = Pick<pg.Pool, "query">;
export type McpPrincipal = McpPermission & {
  userId: string;
  clientId: string;
  scopes: string[];
  worldIds: string[] | null;
};
export type Consent = {
  subject: string;
  request_url: string;
  requested_scope: string[];
  requested_access_token_audience: string[];
  client: { client_id: string; client_name?: string };
};
export class McpAuthorization {
  readonly resource: string;
  constructor(
    readonly pool: pg.Pool,
    readonly options: {
      resource?: string | undefined;
      issuer?: string | undefined;
      hydraAdminUrl?: string | undefined;
      transport?: typeof fetch;
    } = {},
  ) {
    this.resource =
      options.resource ??
      process.env.MCP_RESOURCE_URL ??
      new URL("/mcp", process.env.ORY_AUTH_URL ?? "http://127.0.0.1:3000").href;
  }
  async hydra(path: string, method = "GET", body?: unknown) {
    const base = this.options.hydraAdminUrl ?? process.env.ORY_HYDRA_ADMIN_URL;
    if (!base)
      throw new AccessError(
        503,
        "MCP_NOT_CONFIGURED",
        "Hydraの接続先を設定してください",
      );
    let response: Response;
    try {
      response = await (this.options.transport ?? fetch)(
        new URL(path, base.endsWith("/") ? base : `${base}/`),
        {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          ...(body === undefined
            ? {}
            : {
                headers: {
                  "content-type":
                    body instanceof URLSearchParams
                      ? "application/x-www-form-urlencoded"
                      : "application/json",
                },
                body:
                  body instanceof URLSearchParams ? body : JSON.stringify(body),
              }),
        },
      );
    } catch {
      throw new AccessError(
        503,
        "MCP_AUTH_UNAVAILABLE",
        "認可サービスに接続できません",
      );
    }
    if (!response.ok)
      throw new AccessError(
        response.status >= 500 ? 503 : 409,
        response.status === 404 ? "MCP_AUTH_NOT_FOUND" : "MCP_AUTH_REJECTED",
        "認可サービスの設定と要求を確認してください",
      );
    return response.status === 204
      ? {}
      : ((await response.json()) as Record<string, unknown>);
  }
  async clients(db: Database, before?: string) {
    const rows = (
      await db.query(
        "SELECT id,configuration,version,updated_by,updated_at FROM mcp_client WHERE ($1::uuid IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",
        [before ?? null],
      )
    ).rows;
    return {
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49].id : null,
    };
  }
  async put(
    db: Database,
    id: string,
    configuration: z.infer<typeof McpClientConfiguration>,
    expectedVersion: number,
    actor: string,
  ) {
    if (configuration.scopes.some((s) => !operationNames.includes(s)))
      throw new AccessError(
        409,
        "MCP_SCOPE_UNKNOWN",
        "共通操作のscopeを指定してください",
      );
    const targeted = [
      "worlds.list",
      "worlds.read",
      "worlds.records",
      "worlds.command",
      "worlds.graph",
      "worlds.edit",
      "worlds.configure",
      "worlds.join",
      "worlds.resumeJoin",
      "worldBudgets.read",
      "worldBudgets.put",
      "costs.read",
      "jobs.list",
      "jobs.read",
      "jobs.resume",
    ];
    if (
      configuration.worldIds !== null &&
      configuration.scopes.some((s) => !targeted.includes(s))
    )
      throw new AccessError(
        409,
        "MCP_TARGET_SCOPE_MISMATCH",
        "世界を限定する場合は、世界・世界予算・費用・ジョブの操作だけをscopeに指定してください",
      );
    const previous = (
      await db.query("SELECT version FROM mcp_client WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows[0];
    if ((previous?.version ?? 0) !== expectedVersion)
      throw new AccessError(
        409,
        "SETTINGS_CHANGED",
        "クライアントの設定版を読み直してください",
      );
    const client = {
      client_id: id,
      client_name: configuration.name,
      redirect_uris: configuration.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: [MCP_CONNECT, "offline_access", ...configuration.scopes].join(" "),
      audience: [this.resource],
    };
    try {
      await this.hydra(`admin/clients/${id}`, "PUT", client);
    } catch (error) {
      if (
        !(error instanceof AccessError) ||
        error.code !== "MCP_AUTH_NOT_FOUND"
      )
        throw error;
      await this.hydra("admin/clients", "POST", client);
    }
    await db.query(
      `INSERT INTO mcp_client(id,configuration,version,updated_by) VALUES($1,$2,1,$3)
      ON CONFLICT(id) DO UPDATE SET configuration=$2,version=mcp_client.version+1,updated_by=$3,updated_at=now()`,
      [id, configuration, actor],
    );
    return { clientId: id, version: expectedVersion + 1, configuration };
  }
  async consent(data: Consent) {
    const row = (
      await this.pool.query(
        `SELECT c.configuration,u.role,u.banned FROM mcp_client c JOIN app_user u ON u.id=$2 WHERE c.id::text=$1`,
        [data.client.client_id, data.subject],
      )
    ).rows[0];
    const url = new URL(data.request_url),
      resources = url.searchParams.getAll("resource");
    if (
      !row ||
      row.role !== "admin" ||
      row.banned ||
      !row.configuration.enabled
    )
      throw new AccessError(
        403,
        "MCP_CLIENT_DENIED",
        "このクライアントを管理者として利用できません",
      );
    if (
      resources.length !== 1 ||
      resources[0] !== this.resource ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("code_challenge") ?? "")
    )
      throw new AccessError(
        403,
        "MCP_AUTH_PARAMETERS",
        "対象リソースとPKCE S256を指定してください",
      );
    const allowed = [
      MCP_CONNECT,
      "offline_access",
      ...row.configuration.scopes,
    ];
    if (
      !data.requested_scope.includes(MCP_CONNECT) ||
      data.requested_scope.some((s) => !allowed.includes(s)) ||
      data.requested_access_token_audience.some((s) => s !== this.resource)
    )
      throw new AccessError(
        403,
        "MCP_SCOPE_DENIED",
        "登録したscopeと対象だけを要求してください",
      );
    return McpClientConfiguration.parse(row.configuration);
  }
  async approve(data: Consent, challenge: string) {
    const config = await this.consent(data),
      id = randomUUID(),
      digest = createHash("sha256").update(challenge).digest("hex");
    const row = (
      await this.pool.query(
        `INSERT INTO mcp_grant(id,client_id,user_id,scopes,world_ids,consent_hash) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(consent_hash) DO UPDATE SET consent_hash=excluded.consent_hash RETURNING id`,
        [
          id,
          data.client.client_id,
          data.subject,
          data.requested_scope,
          config.worldIds,
          digest,
        ],
      )
    ).rows[0];
    return row.id as string;
  }
  async verify(authorization?: string): Promise<McpPrincipal> {
    const bearer = authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer)
      throw new AccessError(
        401,
        "MCP_TOKEN_REQUIRED",
        "MCP用のアクセストークンが必要です",
      );
    const raw = await this.hydra(
      "admin/oauth2/introspect",
      "POST",
      new URLSearchParams({ token: bearer }),
    );
    const parsed = z
      .object({
        active: z.literal(true),
        sub: z.uuid(),
        client_id: z.uuid(),
        aud: z.array(z.string()),
        scope: z.string(),
        exp: z.number(),
        ext: z.object({ gestaloka_grant: z.uuid() }),
      })
      .safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.exp * 1000 <= Date.now() ||
      !parsed.data.aud.includes(this.resource) ||
      !parsed.data.scope.split(" ").includes(MCP_CONNECT)
    )
      throw new AccessError(
        401,
        "MCP_TOKEN_INVALID",
        "アクセストークンの有効性と対象を確認してください",
      );
    const token = parsed.data,
      grant = (
        await this.pool.query(
          "SELECT client_id,user_id,scopes,world_ids FROM mcp_grant WHERE id=$1",
          [token.ext.gestaloka_grant],
        )
      ).rows[0];
    if (
      !grant ||
      grant.client_id !== token.client_id ||
      grant.user_id !== token.sub
    )
      throw new AccessError(401, "MCP_TOKEN_INVALID", "認可を確認できません");
    const principal = {
      userId: token.sub,
      clientId: token.client_id,
      grantId: token.ext.gestaloka_grant,
      scope: MCP_CONNECT,
      scopes: token.scope.split(" "),
      worldIds: grant.world_ids,
    };
    await this.check(this.pool, principal, MCP_CONNECT);
    return principal;
  }
  async check(
    db: Database,
    p: McpPrincipal,
    scope: string,
    worldId?: string,
    lock = false,
  ) {
    const row = (
      await db.query(
        `SELECT c.configuration,g.scopes,g.world_ids,g.revoked,u.role,u.banned FROM mcp_grant g JOIN mcp_client c ON c.id=g.client_id JOIN app_user u ON u.id=g.user_id
      WHERE g.id=$1 AND g.user_id=$2 AND c.id=$3${lock ? " FOR SHARE OF g,c,u" : ""}`,
        [p.grantId, p.userId, p.clientId],
      )
    ).rows[0];
    if (
      !row ||
      row.revoked ||
      row.banned ||
      row.role !== "admin" ||
      !row.configuration.enabled
    )
      throw new AccessError(
        403,
        "MCP_AUTH_REVOKED",
        "MCPの認可が失効しています",
      );
    if (
      !p.scopes.includes(scope) ||
      !row.scopes.includes(scope) ||
      (scope !== MCP_CONNECT && !row.configuration.scopes.includes(scope))
    )
      throw new AccessError(403, "MCP_SCOPE_DENIED", `必要なscope: ${scope}`);
    for (const ids of [MCP_CONNECT, "worlds.list"].includes(scope)
      ? []
      : [p.worldIds, row.world_ids, row.configuration.worldIds])
      if (ids !== null && (worldId === undefined || !ids.includes(worldId)))
        throw new AccessError(
          403,
          "MCP_TARGET_DENIED",
          "許可された世界IDを指定してください",
        );
  }
  async worlds(db: Database, p: McpPrincipal) {
    const row = (
      await db.query(
        "SELECT g.world_ids,c.configuration->'worldIds' AS client_worlds FROM mcp_grant g JOIN mcp_client c ON c.id=g.client_id WHERE g.id=$1",
        [p.grantId],
      )
    ).rows[0];
    let ids: string[] | null = null;
    for (const allowed of [p.worldIds, row.world_ids, row.client_worlds])
      if (allowed !== null)
        ids = ids === null ? allowed : ids.filter((id) => allowed.includes(id));
    return ids;
  }
  async grants(db: Database, before?: string) {
    const rows = (
      await db.query(
        "SELECT id,client_id,user_id,scopes,world_ids,revoked,created_at FROM mcp_grant WHERE ($1::uuid IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",
        [before ?? null],
      )
    ).rows;
    return {
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49].id : null,
    };
  }
}
