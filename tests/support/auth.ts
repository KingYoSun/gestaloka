import { randomUUID } from "node:crypto";
import type pg from "pg";
import { OryIdentity } from "@gestaloka/server/identity";
import { Operations } from "@gestaloka/server/operations";

/** Isolated test identities; never bootstrap or change a real application's membership. */
export async function fixtureAuth(
  pool: pg.Pool,
  external?: (
    token: string,
  ) => Promise<{ ory: string; session: string } | undefined>,
  mcpOptions?: ConstructorParameters<typeof Operations>[3],
  modelTransport: typeof fetch = fetch,
) {
  const sessions = new Map<string, { ory: string; session: string }>();
  const ids: string[] = [];
  const identity = new OryIdentity(
    pool,
    "http://ory.invalid",
    async (_url, options) => {
      const cookie = new Headers(options?.headers).get("cookie") ?? "";
      const token = cookie
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("test_ory="));
      const entry = token
        ? (sessions.get(token) ?? (await external?.(token)))
        : undefined;
      return entry
        ? Response.json({
            id: entry.session,
            active: true,
            expires_at: new Date(Date.now() + 60000).toISOString(),
            identity: { id: entry.ory, state: "active" },
          })
        : new Response(null, { status: 401 });
    },
  );
  await identity.setup();
  const operations = new Operations(
    pool,
    "2".repeat(64),
    modelTransport,
    mcpOptions,
  );
  await operations.setup();
  return {
    identity,
    operations,
    async worldInvite(admin: string, worldId: string, maxUses = 1) {
      const result = await operations.execute(admin, randomUUID(), {
        operation: "invites.create",
        worldId,
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        maxUses,
        reason: "テスト用の参加招待",
      });
      return String(result.token);
    },
    async person(role: "admin" | "user" = "admin") {
      const id = randomUUID(),
        ory = randomUUID(),
        cookie = `test_ory=${id}`;
      await pool.query("INSERT INTO app_identity(id,ory_id) VALUES($1,$2)", [
        id,
        ory,
      ]);
      await pool.query("INSERT INTO app_user(id,role) VALUES($1,$2)", [
        id,
        role,
      ]);
      ids.push(id);
      sessions.set(cookie, { ory, session: randomUUID() });
      return { id, cookie };
    },
    logout(cookie: string) {
      sessions.delete(cookie);
    },
    async cleanup() {
      await pool.query(
        "DELETE FROM invite_use WHERE user_id=ANY($1) OR invite_id IN (SELECT id FROM app_invite WHERE created_by=ANY($1))",
        [ids],
      );
      await pool.query("DELETE FROM app_invite WHERE created_by=ANY($1)", [
        ids,
      ]);
      await pool.query(
        "DELETE FROM world_participation WHERE user_id=ANY($1)",
        [ids],
      );
      await pool.query("DELETE FROM player_preset WHERE updated_by=ANY($1)", [
        ids,
      ]);
      await pool.query(
        "DELETE FROM operation_audit WHERE request_id IN (SELECT id FROM operation_request WHERE actor_id=ANY($1))",
        [ids],
      );
      await pool.query("DELETE FROM operation_request WHERE actor_id=ANY($1)", [
        ids,
      ]);
      await pool.query("DELETE FROM app_user WHERE id=ANY($1)", [ids]);
      await pool.query("DELETE FROM app_identity WHERE id=ANY($1)", [ids]);
    },
  };
}
