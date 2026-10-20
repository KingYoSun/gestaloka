import { createHash, createHmac, randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { AccessError } from "./access.js";

import { Member, Operation, LegacyClaimPage } from "@gestaloka/contracts";

type Input = z.infer<typeof Operation>;
type UserRow = {
  id: string;
  role: "admin" | "user";
  banned: boolean;
  created_at: Date;
};
const member = (row: UserRow) =>
  Member.parse({ ...row, createdAt: row.created_at.toISOString() });
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Database = Pick<pg.Pool, "query">;
type Context = { legacyToken?: string | undefined };

export async function requireMember(
  database: Database,
  userId: string,
  admin = false,
) {
  const row = (
    await database.query<UserRow>(
      "SELECT * FROM app_user WHERE id=$1 FOR SHARE",
      [userId],
    )
  ).rows[0];
  if (!row)
    throw new AccessError(403, "REGISTRATION_REQUIRED", "利用登録が必要です");
  if (row.banned)
    throw new AccessError(403, "USER_BANNED", "利用が停止されています");
  if (admin && row.role !== "admin")
    throw new AccessError(403, "ADMIN_REQUIRED", "管理者の権限が必要です");
  return member(row);
}

/** Shared by HTTP, local recovery, and the later MCP adapter. */
export class Operations {
  constructor(
    readonly pool: pg.Pool,
    readonly tokenSecret: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(tokenSecret))
      throw new Error(
        "OPERATIONS_TOKEN_SECRETを設定してください（pnpm auth:init）",
      );
  }
  async setup() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS app_user (
      id uuid PRIMARY KEY REFERENCES app_identity(id),role text NOT NULL CHECK(role IN ('admin','user')),
      banned boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS operation_state (singleton boolean PRIMARY KEY CHECK(singleton),
        bootstrapped boolean NOT NULL DEFAULT false,invite_required boolean NOT NULL DEFAULT true);
      INSERT INTO operation_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
      CREATE TABLE IF NOT EXISTS app_invite (id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL,
        expires_at timestamptz NOT NULL,max_uses bigint NOT NULL CHECK(max_uses>0),uses bigint NOT NULL DEFAULT 0,
        revoked boolean NOT NULL DEFAULT false,created_by uuid NOT NULL REFERENCES app_user(id),created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS invite_use(invite_id uuid NOT NULL REFERENCES app_invite(id),user_id uuid NOT NULL REFERENCES app_user(id),
        used_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(invite_id,user_id));
      CREATE TABLE IF NOT EXISTS operation_request(id uuid PRIMARY KEY,actor_id uuid REFERENCES app_identity(id),
        operation text NOT NULL,input_hash text NOT NULL,result jsonb,error jsonb,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS operation_audit(id bigserial PRIMARY KEY,request_id uuid NOT NULL REFERENCES operation_request(id),
        actor_id uuid REFERENCES app_identity(id),operation text NOT NULL,outcome text NOT NULL,details jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS operation_audit_request ON operation_audit(request_id,id);`);
  }
  async state(userId: string) {
    const user = (
      await this.pool.query<UserRow>("SELECT * FROM app_user WHERE id=$1", [
        userId,
      ])
    ).rows[0];
    const state = (
      await this.pool.query<{
        bootstrapped: boolean;
        invite_required: boolean;
      }>("SELECT * FROM operation_state WHERE singleton")
    ).rows[0]!;
    return {
      member: user ? member(user) : null,
      inviteRequired: state.invite_required,
      bootstrapAvailable: !state.bootstrapped,
    };
  }
  async authorize(
    userId: string,
    admin = false,
    database: Database = this.pool,
  ) {
    return requireMember(database, userId, admin);
  }
  #token(id: string) {
    return `${id}.${createHmac("sha256", this.tokenSecret).update(`invite:${id}`).digest("base64url")}`;
  }
  async #legacySource(
    userId: string,
    token: string | undefined,
    db: Database,
    lock = false,
  ) {
    const source = token
      ? (
          await db.query<{ id: string; user_id: string | null }>(
            `SELECT id,user_id FROM world_subject WHERE token_hash=$1 AND active${lock ? " FOR UPDATE" : ""}`,
            [hash(token)],
          )
        ).rows[0]
      : undefined;
    if (!source)
      throw new AccessError(
        401,
        "LEGACY_COOKIE_REQUIRED",
        "このブラウザーで引き継げるデータが見つかりません",
      );
    if (source.user_id && source.user_id !== userId)
      throw new AccessError(
        403,
        "LEGACY_ALREADY_CLAIMED",
        "このデータは別のユーザーへ引き継ぎ済みです",
      );
    return source;
  }
  async #legacySnapshot(id: string, db: Database) {
    const row = (
      await db.query<{ total: string; version: string }>(
        `SELECT count(DISTINCT construction_id)::text AS total,
        md5($1::text||coalesce(string_agg(construction_id::text||':'||role||':'||coalesce(actor_id::text,''),',' ORDER BY construction_id,role),'')) AS version
        FROM world_access WHERE subject_id=$1::uuid`,
        [id],
      )
    ).rows[0]!;
    return { total: Number(row.total), version: row.version };
  }
  async legacyPreview(userId: string, token?: string, before?: string) {
    await this.authorize(userId);
    const source = await this.#legacySource(userId, token, this.pool);
    const snapshot = await this.#legacySnapshot(source.id, this.pool);
    const rows = (
      await this.pool.query<{
        id: string;
        prompt: string;
        actorId: string | null;
      }>(
        `SELECT a.construction_id AS id,b.initial_prompt AS prompt,max(a.actor_id::text)::uuid AS "actorId"
       FROM world_access a JOIN world_build b ON b.run_id=a.construction_id
       WHERE a.subject_id=$1 AND ($2::uuid IS NULL OR a.construction_id<$2)
       GROUP BY a.construction_id,b.initial_prompt ORDER BY a.construction_id DESC LIMIT 51`,
        [source.id, before ? z.uuid().parse(before) : null],
      )
    ).rows;
    return LegacyClaimPage.parse({
      subjectId: source.id,
      linked: source.user_id === userId,
      ...snapshot,
      items: rows.slice(0, 50),
      next: rows.length > 50 ? rows[49]!.id : null,
    });
  }
  async execute(
    actor: string,
    requestId: string,
    input: Input,
    context: Context = {},
  ) {
    return this.#execute(
      z.uuid().parse(actor),
      requestId,
      Operation.parse(input),
      context,
    );
  }
  async recover(userId: string, requestId: string, reason: string) {
    return this.#execute(null, z.uuid().parse(requestId), {
      operation: "recovery.admin",
      userId: z.uuid().parse(userId),
      reason: z.string().trim().min(1).parse(reason),
    });
  }
  async #execute(
    actor: string | null,
    requestId: string,
    input:
      Input | { operation: "recovery.admin"; userId: string; reason: string },
    context: Context = {},
  ) {
    z.uuid().parse(requestId);
    const database = await this.pool.connect();
    const digest = hash(JSON.stringify(input));
    let result: Record<string, unknown> = {},
      failure: AccessError | undefined;
    try {
      await database.query("BEGIN");
      await database.query(
        "SELECT singleton FROM operation_state WHERE singleton FOR UPDATE",
      );
      const saved = (
        await database.query<{
          actor_id: string | null;
          input_hash: string;
          result: Record<string, unknown>;
          error: {
            status: 403 | 404 | 409;
            code: string;
            message: string;
          } | null;
        }>("SELECT * FROM operation_request WHERE id=$1", [requestId])
      ).rows[0];
      if (saved && (saved.actor_id !== actor || saved.input_hash !== digest)) {
        await this.#audit(
          database,
          actor,
          requestId,
          input.operation,
          "conflict",
          {},
        );
        await database.query("COMMIT");
        throw new AccessError(
          409,
          "REQUEST_CONFLICT",
          "同じ要求IDに異なる内容は使用できません",
        );
      }
      if (!saved)
        await database.query(
          "INSERT INTO operation_request(id,actor_id,operation,input_hash) VALUES($1,$2,$3,$4)",
          [requestId, actor, input.operation, digest],
        );
      await database.query("SAVEPOINT operation");
      try {
        if (actor && input.operation !== "account.register")
          await this.authorize(
            actor,
            input.operation !== "account.claim",
            database,
          );
        if (actor && input.operation === "account.register") {
          const current = (
            await database.query<UserRow>(
              "SELECT * FROM app_user WHERE id=$1",
              [actor],
            )
          ).rows[0];
          if (current?.banned)
            throw new AccessError(403, "USER_BANNED", "利用が停止されています");
        }
        if (saved) {
          if (saved.error)
            throw new AccessError(
              saved.error.status,
              saved.error.code,
              saved.error.message,
            );
          result = saved.result;
        } else result = await this.#perform(database, actor, input, context);
      } catch (error) {
        if (!(error instanceof AccessError)) throw error;
        await database.query("ROLLBACK TO SAVEPOINT operation");
        failure = error;
      }
      if (!saved)
        await database.query(
          "UPDATE operation_request SET result=$2,error=$3 WHERE id=$1",
          [
            requestId,
            failure ? null : JSON.stringify(result),
            failure
              ? JSON.stringify({
                  status: failure.status,
                  code: failure.code,
                  message: failure.message,
                })
              : null,
          ],
        );
      await this.#audit(
        database,
        actor,
        requestId,
        input.operation,
        failure ? "denied" : saved ? "replayed" : "accepted",
        failure
          ? { code: failure.code }
          : saved ||
              input.operation.endsWith(".list") ||
              input.operation === "invites.uses" ||
              input.operation === "settings.read"
            ? {}
            : {
                ...result,
                ...("reason" in input ? { reason: input.reason } : {}),
              },
      );
      await database.query("COMMIT");
    } catch (error) {
      if (!(error instanceof AccessError && error.code === "REQUEST_CONFLICT"))
        await database.query("ROLLBACK");
      throw error;
    } finally {
      database.release();
    }
    if (failure) throw failure;
    if (input.operation === "invites.create")
      return { ...result, token: this.#token(result.id as string) };
    return result;
  }
  async #audit(
    database: Database,
    actor: string | null,
    request: string,
    operation: string,
    outcome: string,
    details: unknown,
  ) {
    await database.query(
      "INSERT INTO operation_audit(request_id,actor_id,operation,outcome,details) VALUES($1,$2,$3,$4,$5)",
      [request, actor, operation, outcome, JSON.stringify(details)],
    );
  }
  async #perform(
    db: pg.PoolClient,
    actor: string | null,
    input:
      Input | { operation: "recovery.admin"; userId: string; reason: string },
    context: Context,
  ): Promise<Record<string, unknown>> {
    switch (input.operation) {
      case "account.claim": {
        const source = await this.#legacySource(
          actor!,
          context.legacyToken,
          db,
          true,
        );
        const snapshot = await this.#legacySnapshot(source.id, db);
        if (snapshot.version !== input.version)
          throw new AccessError(
            409,
            "CLAIM_CHANGED",
            "引き継ぐ対象が変わりました。一覧を確認し直してください",
          );
        await db.query("UPDATE world_subject SET user_id=$2 WHERE id=$1", [
          source.id,
          actor,
        ]);
        return {
          subjectId: source.id,
          worldCount: snapshot.total,
          linked: true,
        };
      }
      case "account.register": {
        const known = (
          await db.query<UserRow>("SELECT * FROM app_user WHERE id=$1", [actor])
        ).rows[0];
        if (known) {
          if (known.banned)
            throw new AccessError(403, "USER_BANNED", "利用が停止されています");
          return { member: member(known) };
        }
        const state = (
          await db.query<{ bootstrapped: boolean; invite_required: boolean }>(
            "SELECT * FROM operation_state WHERE singleton",
          )
        ).rows[0]!;
        let invite: string | undefined;
        if (state.bootstrapped && state.invite_required) {
          const row = (
            await db.query<{ id: string }>(
              "SELECT id FROM app_invite WHERE token_hash=$1 AND NOT revoked AND expires_at>now() AND uses<max_uses FOR UPDATE",
              [hash(input.invitation ?? "")],
            )
          ).rows[0];
          if (!row)
            throw new AccessError(
              403,
              "INVITATION_REQUIRED",
              "有効な招待トークンが必要です",
            );
          invite = row.id;
        }
        const row = (
          await db.query<UserRow>(
            "INSERT INTO app_user(id,role) VALUES($1,$2) RETURNING *",
            [actor, state.bootstrapped ? "user" : "admin"],
          )
        ).rows[0]!;
        if (!state.bootstrapped)
          await db.query(
            "UPDATE operation_state SET bootstrapped=true WHERE singleton",
          );
        if (invite) {
          await db.query("UPDATE app_invite SET uses=uses+1 WHERE id=$1", [
            invite,
          ]);
          await db.query(
            "INSERT INTO invite_use(invite_id,user_id) VALUES($1,$2)",
            [invite, actor],
          );
        }
        return { member: member(row) };
      }
      case "settings.read":
        return {
          inviteRequired: (
            await db.query(
              "SELECT invite_required FROM operation_state WHERE singleton",
            )
          ).rows[0].invite_required,
        };
      case "settings.invites":
        await db.query(
          "UPDATE operation_state SET invite_required=$1 WHERE singleton",
          [input.enabled],
        );
        return { inviteRequired: input.enabled };
      case "users.list": {
        const rows = (
          await db.query<UserRow>(
            "SELECT * FROM app_user WHERE ($1::uuid IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",
            [input.before ?? null],
          )
        ).rows;
        return {
          items: rows.slice(0, 50).map(member),
          next: rows.length > 50 ? rows[49]!.id : null,
        };
      }
      case "recovery.admin":
      case "users.role":
      case "users.ban": {
        const before = (
          await db.query<UserRow>(
            "SELECT * FROM app_user WHERE id=$1 FOR UPDATE",
            [input.userId],
          )
        ).rows[0];
        if (!before && input.operation === "recovery.admin") {
          const row = (
            await db.query<UserRow>(
              "INSERT INTO app_user(id,role) SELECT id,'admin' FROM app_identity WHERE id=$1 RETURNING *",
              [input.userId],
            )
          ).rows[0];
          if (!row)
            throw new AccessError(
              404,
              "USER_NOT_FOUND",
              "先に本人がログインしてアプリIDを確認してください",
            );
          await db.query(
            "UPDATE operation_state SET bootstrapped=true WHERE singleton",
          );
          return { before: null, member: member(row) };
        }
        if (!before)
          throw new AccessError(
            404,
            "USER_NOT_FOUND",
            "ユーザーが見つかりません",
          );
        const role =
          input.operation === "users.ban"
            ? before.role
            : input.operation === "recovery.admin"
              ? "admin"
              : input.role;
        const banned =
          input.operation === "users.ban"
            ? input.banned
            : input.operation === "recovery.admin"
              ? false
              : before.banned;
        if (
          before.role === "admin" &&
          !before.banned &&
          (banned || role !== "admin")
        ) {
          const count = Number(
            (
              await db.query(
                "SELECT count(*) FROM app_user WHERE role='admin' AND NOT banned",
              )
            ).rows[0].count,
          );
          if (count === 1)
            throw new AccessError(
              409,
              "LAST_ADMIN",
              "最後の有効な管理者は降格・BANできません",
            );
        }
        const after = (
          await db.query<UserRow>(
            "UPDATE app_user SET role=$2,banned=$3 WHERE id=$1 RETURNING *",
            [input.userId, role, banned],
          )
        ).rows[0]!;
        return { before: member(before), member: member(after) };
      }
      case "invites.create": {
        if (Date.parse(input.expiresAt) <= Date.now())
          throw new AccessError(
            409,
            "INVITE_EXPIRY",
            "招待の有効期限は未来の日時にしてください",
          );
        const id = randomUUID();
        await db.query(
          "INSERT INTO app_invite(id,token_hash,expires_at,max_uses,created_by) VALUES($1,$2,$3,$4,$5)",
          [id, hash(this.#token(id)), input.expiresAt, input.maxUses, actor],
        );
        return { id, expiresAt: input.expiresAt, maxUses: input.maxUses };
      }
      case "invites.revoke": {
        const row = await db.query(
          "UPDATE app_invite SET revoked=true WHERE id=$1 RETURNING id",
          [input.inviteId],
        );
        if (!row.rowCount)
          throw new AccessError(
            404,
            "INVITE_NOT_FOUND",
            "招待が見つかりません",
          );
        return { id: input.inviteId, revoked: true };
      }
      case "invites.list": {
        const rows = (
          await db.query(
            "SELECT id,expires_at,max_uses,uses,revoked,created_by,created_at FROM app_invite WHERE ($1::uuid IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",
            [input.before ?? null],
          )
        ).rows;
        return {
          items: rows.slice(0, 50).map((row) => ({
            id: row.id,
            expiresAt: row.expires_at.toISOString(),
            maxUses: Number(row.max_uses),
            uses: Number(row.uses),
            revoked: row.revoked,
            createdBy: row.created_by,
            createdAt: row.created_at.toISOString(),
          })),
          next: rows.length > 50 ? rows[49]!.id : null,
        };
      }
      case "invites.uses": {
        const rows = (
          await db.query(
            "SELECT user_id,used_at FROM invite_use WHERE invite_id=$1 AND ($2::uuid IS NULL OR user_id<$2) ORDER BY user_id DESC LIMIT 51",
            [input.inviteId, input.before ?? null],
          )
        ).rows;
        return {
          items: rows.slice(0, 50).map((row) => ({
            userId: row.user_id,
            usedAt: row.used_at.toISOString(),
          })),
          next: rows.length > 50 ? rows[49]!.user_id : null,
        };
      }
      case "audit.list": {
        const rows = (
          await db.query(
            "SELECT id::text,request_id,actor_id,operation,outcome,details,created_at FROM operation_audit WHERE ($1::bigint IS NULL OR id<$1) ORDER BY id DESC LIMIT 51",
            [input.before ?? null],
          )
        ).rows;
        return {
          items: rows.slice(0, 50),
          next: rows.length > 50 ? rows[49]!.id : null,
        };
      }
    }
  }
}
