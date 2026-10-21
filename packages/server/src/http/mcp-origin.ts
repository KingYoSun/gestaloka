import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
export type McpPermission = { grantId: string; scope: string };
const current = new AsyncLocalStorage<McpPermission | null>();
export class McpOrigin {
  static async setup(db: Pick<pg.Pool, "query">) {
    await db.query(`CREATE TABLE IF NOT EXISTS mcp_client(id uuid PRIMARY KEY,configuration jsonb NOT NULL,version integer NOT NULL,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS mcp_grant(id uuid PRIMARY KEY,client_id uuid NOT NULL REFERENCES mcp_client(id),user_id uuid NOT NULL,scopes text[] NOT NULL,world_ids uuid[],revoked boolean NOT NULL DEFAULT false,consent_hash text UNIQUE NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS mcp_execution(kind text NOT NULL,id uuid NOT NULL,permission jsonb,PRIMARY KEY(kind,id));`);
  }
  static get current() {
    return current.getStore();
  }
  static run<T>(permission: McpPermission | null, work: () => T) {
    return current.run(permission, work);
  }
  static async capture(db: Pick<pg.Pool, "query">, kind: string, id: string) {
    const permission = current.getStore();
    if (permission === undefined) return;
    if (permission === null) {
      await db.query("DELETE FROM mcp_execution WHERE kind=$1 AND id=$2", [
        kind,
        id,
      ]);
      return;
    }
    await db.query(
      "INSERT INTO mcp_execution(kind,id,permission) VALUES($1,$2,$3) ON CONFLICT(kind,id) DO UPDATE SET permission=excluded.permission",
      [kind, id, permission ?? null],
    );
  }
}
