import { randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import {
  legalConfigured,
  legalEdition,
  legalVersion,
  terms,
  privacy,
} from "./legal.js";

const Session = z.object({
  id: z.uuid(),
  active: z.literal(true),
  expires_at: z.iso.datetime({ offset: true }),
  identity: z.object({
    id: z.uuid(),
    state: z.literal("active"),
    metadata_public: z
      .object({
        registrationConsent: z
          .object({ version: z.string(), acceptedAt: z.iso.datetime() })
          .optional(),
      })
      .nullish(),
  }),
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
      created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS app_legal_edition (
        version text PRIMARY KEY, effective_on date NOT NULL, terms text NOT NULL, privacy text NOT NULL);
      CREATE TABLE IF NOT EXISTS app_legal_consent (
        user_id uuid NOT NULL REFERENCES app_identity(id) ON DELETE CASCADE,
        version text NOT NULL, accepted_at timestamptz NOT NULL,
        PRIMARY KEY(user_id,version));
      CREATE TABLE IF NOT EXISTS app_legal_registration (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), flow_id uuid,
        version text NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS app_legal_registration_time ON app_legal_registration(accepted_at)`);
    if (legalConfigured)
      await this.pool.query(
        "INSERT INTO app_legal_edition(version,effective_on,terms,privacy) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [legalVersion, legalEdition, terms, privacy],
      );
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
    const receipt = session.identity.metadata_public?.registrationConsent;
    const result = await this.pool.query<{ id: string }>(
      `WITH subject AS (
         INSERT INTO app_identity(id,ory_id) VALUES($1,$2)
         ON CONFLICT(ory_id) DO UPDATE SET ory_id=EXCLUDED.ory_id RETURNING id
       ), initial_consent AS (
         INSERT INTO app_legal_consent(user_id,version,accepted_at)
         SELECT id,$3,$4 FROM subject WHERE $3::text IS NOT NULL ON CONFLICT DO NOTHING
       ) SELECT id FROM subject`,
      [
        randomUUID(),
        session.identity.id,
        receipt?.version ?? null,
        receipt?.acceptedAt ?? null,
      ],
    );
    return {
      userId: result.rows[0]!.id,
      sessionId: session.id,
      identityId: session.identity.id,
    };
  }
}
