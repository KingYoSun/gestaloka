import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";

const Session = z.object({
  id: z.uuid(),
  active: z.literal(true),
  expires_at: z.iso.datetime({ offset: true }),
  identity: z.object({ id: z.uuid(), state: z.literal("active") }),
});

export class IdentityError extends Error {
  constructor(readonly status: 401 | 503) {
    super(
      status === 401 ? "ログインしてください" : "認証サービスに接続できません",
    );
  }
}

/** Kratos verifies credentials. Application roles never come from identity traits. */
export class OryIdentity {
  constructor(
    readonly pool: pg.Pool,
    readonly publicUrl: string,
    readonly transport: typeof fetch = fetch,
    readonly internalUrl: string = publicUrl,
  ) {}

  async setup() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS app_identity (
      id uuid PRIMARY KEY, ory_id uuid UNIQUE NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now())`);
  }

  async session(cookie?: string) {
    if (!cookie) throw new IdentityError(401);
    let response: Response;
    try {
      response = await this.transport(
        new URL("sessions/whoami", `${this.internalUrl.replace(/\/$/, "")}/`),
        {
          headers: { cookie, accept: "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch {
      throw new IdentityError(503);
    }
    if (response.status === 401 || response.status === 403)
      throw new IdentityError(401);
    if (!response.ok) throw new IdentityError(503);
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      throw new IdentityError(503);
    }
    const parsed = Session.safeParse(raw);
    if (!parsed.success) throw new IdentityError(401);
    const session = parsed.data;
    if (Date.parse(session.expires_at) <= Date.now())
      throw new IdentityError(401);
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO app_identity(id,ory_id) VALUES($1,$2)
       ON CONFLICT(ory_id) DO UPDATE SET ory_id=EXCLUDED.ory_id RETURNING id`,
      [randomUUID(), session.identity.id],
    );
    return {
      userId: result.rows[0]!.id,
      sessionId: session.id,
      identityId: session.identity.id,
    };
  }
}
