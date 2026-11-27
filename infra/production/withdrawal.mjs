import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { redact, reviewRule } from "./withdrawal-review.mjs";

const require = createRequire(
  new URL("../../packages/server/package.json", import.meta.url),
);
const { Pool } = require("pg");
const neo4j = require("neo4j-driver");
const originKey = (secret) =>
  createHash("sha256")
    .update("withdrawal-ledger:")
    .update(secret)
    .digest("hex");

// The control database is outside the three databases replaced by restore.
export class Withdrawals {
  constructor(engine) {
    this.engine = engine;
    this.db = new Pool({
      connectionString:
        engine.env.WITHDRAWAL_LEDGER_DATABASE_URL ||
        `postgres://ory:${engine.env.ORY_DATABASE_PASSWORD}@identity-postgres:5432/ory`,
      connectionTimeoutMillis: 5000,
      allowExitOnIdle: true,
    });
    this.db.on("error", () => {});
  }
  async authority(secret, register = false) {
    const source = originKey(secret);
    if (register) {
      await this.db.query(`CREATE TABLE IF NOT EXISTS withdrawal_authority (
        source text PRIMARY KEY, id uuid UNIQUE NOT NULL, restore_after timestamptz);
        CREATE TABLE IF NOT EXISTS withdrawal_legacy_backup(authority uuid NOT NULL REFERENCES withdrawal_authority(id),
          job uuid NOT NULL, PRIMARY KEY(authority,job));
        CREATE TABLE IF NOT EXISTS withdrawal_receipt (
        authority uuid NOT NULL REFERENCES withdrawal_authority(id), receipt uuid PRIMARY KEY,
        user_id uuid, identity_id uuid, keep uuid[] NOT NULL, confirmed_at timestamptz NOT NULL DEFAULT now(),
        retention_days bigint NOT NULL, origin_host text NOT NULL, structured_at timestamptz, reviewed_at timestamptz,
        rules jsonb NOT NULL DEFAULT '[]', erased_at timestamptz, finished_at timestamptz, UNIQUE(authority,user_id));
        CREATE INDEX IF NOT EXISTS withdrawal_pending ON withdrawal_receipt(authority,confirmed_at) WHERE erased_at IS NULL`);
      const marker = `withdrawal-authority-${source}.json`;
      const expected = await this.engine.load(marker, null);
      if (!expected) {
        await this.db.query(
          "INSERT INTO withdrawal_authority(source,id) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [source, randomUUID()],
        );
      }
      const id = await this.authority(secret);
      if (expected && expected !== id)
        throw new Error("WITHDRAWAL_LEDGER_MISMATCH");
      if (!expected) {
        // Legacy manifests have no authority ID. Bind only generations for
        // which this installation has an independent completed capture receipt.
        for (const name of await readdir(join(this.engine.root, "jobs"))) {
          if (!name.endsWith(".json")) continue;
          const job = await this.engine.load("jobs/" + name, null);
          if (job?.operation === "backups.create" && job.state === "complete")
            await this.db.query(
              "INSERT INTO withdrawal_legacy_backup VALUES($1,$2) ON CONFLICT DO NOTHING",
              [id, job.id],
            );
        }
        await this.engine.save(marker, id);
      }
      return id;
    }
    const id = (
      await this.db.query(
        "SELECT id FROM withdrawal_authority WHERE source=$1",
        [source],
      )
    ).rows[0]?.id;
    if (!id) throw new Error("WITHDRAWAL_LEDGER_UNAVAILABLE");
    return id;
  }
  async accept(input) {
    const { user, identity, keep } = z
      .object({ user: z.uuid(), identity: z.uuid(), keep: z.array(z.uuid()) })
      .parse(input);
    const authority = await this.authority(
      this.engine.env.OPERATIONS_TOKEN_SECRET,
      true,
    );
    const db = await this.engine.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(
        "SELECT singleton FROM operation_state WHERE singleton FOR UPDATE",
      );
      const account = (
        await db.query(
          `SELECT u.role,u.banned FROM app_identity i LEFT JOIN app_user u ON i.id=u.id
      WHERE i.id=$1 AND i.ory_id=$2`,
          [user, identity],
        )
      ).rows[0];
      if (!account) throw new Error("WITHDRAWAL_ACCOUNT_UNAVAILABLE");
      if (
        account.role === "admin" &&
        !account.banned &&
        !(
          await db.query(
            "SELECT 1 FROM app_user WHERE role='admin' AND NOT banned AND id<>$1 LIMIT 1",
            [user],
          )
        ).rowCount
      )
        throw new Error("LAST_ADMIN");
      const retention =
        (await this.engine.settings()).configuration?.retentionDays ?? 0;
      const row = (
        await this.db.query(
          `INSERT INTO withdrawal_receipt(authority,receipt,user_id,identity_id,keep,retention_days,origin_host)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(authority,user_id) DO UPDATE SET user_id=excluded.user_id
      RETURNING receipt,confirmed_at,retention_days`,
          [
            authority,
            randomUUID(),
            user,
            identity,
            keep,
            retention,
            this.engine.project,
          ],
        )
      ).rows[0];
      await this.hide(db, user, keep);
      await db.query("COMMIT");
      return row;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async hide(db, user, keep) {
    await db.query(
      "UPDATE app_user SET banned=true,public_spectating=false WHERE id=$1",
      [user],
    );
    await db.query("UPDATE world_subject SET active=false WHERE user_id=$1", [
      user,
    ]);
    await db.query("UPDATE player_device SET revoked=true WHERE user_id=$1", [
      user,
    ]);
    await db.query("UPDATE player_waiting SET active=false WHERE user_id=$1", [
      user,
    ]);
    await db.query(
      "UPDATE player_story SET deleted_at=coalesce(deleted_at,now()) WHERE author_id=$1 AND NOT(id=ANY($2::uuid[]))",
      [user, keep],
    );
  }
  async status(receipt) {
    const { rows } = await this.db.query(
      "SELECT confirmed_at,retention_days,structured_at,reviewed_at,erased_at,finished_at FROM withdrawal_receipt WHERE receipt=$1",
      [z.uuid().parse(receipt)],
    );
    return rows[0] ?? {};
  }
  async checkRestore(secret, manifest, resume) {
    const id = await this.authority(secret);
    const db = await this.db.connect();
    try {
      await db.query("BEGIN");
      const { rows } = await db.query(
        "SELECT 1 FROM withdrawal_authority WHERE id=$1 AND (restore_after IS NULL OR restore_after < $2::timestamptz) FOR UPDATE",
        [id, manifest.at],
      );
      if (
        !rows.length ||
        (manifest.withdrawalAuthority && manifest.withdrawalAuthority !== id)
      )
        throw new Error("WITHDRAWAL_LEDGER_MISMATCH");
      if (
        !manifest.withdrawalAuthority &&
        !(
          await db.query(
            "SELECT 1 FROM withdrawal_legacy_backup WHERE authority=$1 AND job=$2",
            [id, manifest.id],
          )
        ).rowCount
      )
        throw new Error("WITHDRAWAL_LEDGER_UNAVAILABLE");
      if (resume) await resume(id);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async review(input) {
    const { receipt, rules } = z
      .object({
        receipt: z.uuid(),
        rules: z.array(reviewRule),
        confirmed: z.literal(true),
      })
      .parse(input);
    const authority = await this.authority(
      this.engine.env.OPERATIONS_TOKEN_SECRET,
    );
    const row = (
      await this.db.query(
        "SELECT * FROM withdrawal_receipt WHERE authority=$1 AND receipt=$2 AND finished_at IS NULL",
        [authority, receipt],
      )
    ).rows[0];
    if (!row?.structured_at) throw new Error("WITHDRAWAL_REVIEW_NOT_READY");
    const db = await this.engine.pool.connect();
    try {
      await db.query("BEGIN");
      await redact(db, rules, true);
      const allRules = [
        ...new Set([...row.rules, ...rules].map((r) => JSON.stringify(r))),
      ].map((s) => JSON.parse(s));
      // Commit the replay instructions first. A retry recognizes the edited hash.
      await this.db.query(
        "UPDATE withdrawal_receipt SET rules=$2,reviewed_at=now(),erased_at=NULL WHERE receipt=$1",
        [receipt, JSON.stringify(allRules)],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
    return { receipt };
  }
  async finish(authority, oldestSnapshot) {
    // After dropping the personal identifiers, refuse snapshots that would need them.
    await this.db.query(
      `WITH locked AS MATERIALIZED (SELECT id FROM withdrawal_authority WHERE id=$1 FOR UPDATE), finished AS (
      UPDATE withdrawal_receipt SET user_id=NULL,identity_id=NULL,keep='{}',rules='[]',finished_at=now()
      WHERE authority=(SELECT id FROM locked) AND origin_host=$3 AND finished_at IS NULL AND erased_at < $2::timestamptz RETURNING erased_at)
      UPDATE withdrawal_authority SET restore_after=greatest(restore_after,(SELECT max(erased_at) FROM finished))
      WHERE id=$1 AND EXISTS(SELECT 1 FROM finished)`,
      [authority, oldestSnapshot ?? "infinity", this.engine.project],
    );
  }
  async deadlines(authority, times) {
    if (!times.length) return [];
    const { rows } = await this.db.query(
      `SELECT (SELECT min(confirmed_at + (30+retention_days)*interval '1 day')
      FROM withdrawal_receipt WHERE authority=$1 AND origin_host=$3 AND finished_at IS NULL AND (erased_at IS NULL OR erased_at>=s.at)) AS deadline
      FROM unnest($2::timestamptz[]) WITH ORDINALITY s(at,ord) ORDER BY ord`,
      [authority, times, this.engine.project],
    );
    return rows.map((r) => r.deadline);
  }
  async apply(authority, replay = false) {
    let after = null;
    for (;;) {
      const rows = (
        await this.db.query(
          `SELECT * FROM withdrawal_receipt WHERE authority=$1
        AND user_id IS NOT NULL AND ($2 OR structured_at IS NULL OR (reviewed_at IS NOT NULL AND erased_at IS NULL)) AND ($3::uuid IS NULL OR user_id>$3) ORDER BY user_id LIMIT 16`,
          [authority, replay, after],
        )
      ).rows;
      for (const row of rows) {
        try {
          await this.erase(row, replay);
          await this.db.query(
            "UPDATE withdrawal_receipt SET structured_at=coalesce(structured_at,now()),erased_at=CASE WHEN reviewed_at IS NOT NULL THEN coalesce(erased_at,now()) END WHERE receipt=$1",
            [row.receipt],
          );
          if (replay && !row.reviewed_at)
            throw new Error("WITHDRAWAL_REVIEW_PENDING");
        } catch (error) {
          if (replay) throw error;
          console.error(
            "退会受付の削除処理を再試行します",
            row.receipt,
            error.code ?? error.name,
          );
        }
        after = row.user_id;
      }
      if (rows.length < 16) return;
    }
  }
  async erase(row, replay) {
    const { user_id: user, identity_id: identity, keep } = row;
    const pool = this.engine.pool;
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await redact(db, row.rules);
      if (
        !replay &&
        (
          await db.query(
            `SELECT 1 FROM runtime_execution r
        WHERE r.state IN ('running','waiting') AND (r.user_id=$1 OR r.id IN (SELECT id FROM world_join WHERE subject_id=$1))
        AND (r.job_id IS NULL OR EXISTS(SELECT 1 FROM pgboss.job j WHERE j.id=r.job_id AND j.state='active')) LIMIT 1`,
            [user],
          )
        ).rowCount
      )
        throw new Error("WITHDRAWAL_WAITING_FOR_ACTIVE_JOB");
      await db.query("SELECT id FROM app_user WHERE id=$1 FOR UPDATE", [user]);
      await db.query(
        "UPDATE app_user SET banned=true,public_spectating=false WHERE id=$1",
        [user],
      );
      const actors = (
        await db.query(
          `SELECT DISTINCT a.actor_id AS actor,c.world_id AS graph
        FROM world_access a JOIN world_subject s ON s.id=a.subject_id JOIN world_construction c ON c.id=a.construction_id
        WHERE s.user_id=$1 AND a.role='player' AND a.actor_id IS NOT NULL
        UNION SELECT j.actor_id,c.world_id FROM world_join j JOIN world_construction c ON c.id=j.construction_id
        WHERE j.subject_id=$1 AND j.actor_id IS NOT NULL`,
          [user],
        )
      ).rows;
      const ids = actors.map((a) => a.actor);
      await db.query(
        `UPDATE operation_request r SET result=NULL,
        error='{"status":410,"code":"WITHDRAWN","message":"退会に伴い、この記録の公開を終了しました"}'
        WHERE result IS NOT NULL AND (actor_id=$1 OR id IN (
          SELECT cached.id FROM player_story s JOIN operation_request cached ON
            (cached.operation='stories.read' AND cached.result->'story'->>'id'=s.id::text) OR
            (cached.operation='stories.list' AND cached.result->'items' @> jsonb_build_array(jsonb_build_object('id',s.id)))
          WHERE s.author_id=$1))`,
        [user],
      );
      await db.query(
        "DELETE FROM player_story WHERE author_id=$1 AND NOT (id=ANY($2::uuid[]))",
        [user, keep],
      );
      // Kept works remain readable but no longer identify the former account.
      await db.query(
        "UPDATE player_story SET author='退会済み',author_id=gen_random_uuid() WHERE author_id=$1",
        [user],
      );
      for (const table of [
        "player_story_bookmark",
        "player_device",
        "player_waiting",
        "player_initial_presentation",
        "inspection_manifest",
        "invite_use",
        "world_participation",
        "player_report_usage",
        "app_legal_consent",
        "mcp_grant",
      ]) {
        await db.query(`DELETE FROM ${table} WHERE user_id=$1`, [user]);
      }
      await db.query(
        "DELETE FROM player_friend WHERE proposer=ANY($1::uuid[]) OR recipient=ANY($1::uuid[])",
        [ids],
      );
      await db.query(
        "DELETE FROM player_notice WHERE actor_id=ANY($1::uuid[])",
        [ids],
      );
      await db.query(
        "DELETE FROM inspection_manifest WHERE actor_id=ANY($1::uuid[])",
        [ids],
      );
      await db.query(
        "DELETE FROM player_initial_presentation WHERE actor_id=ANY($1::uuid[])",
        [ids],
      );
      await db.query("UPDATE world_scene SET user_id=NULL WHERE user_id=$1", [
        user,
      ]);
      await db.query(
        "DELETE FROM api_request USING world_subject s WHERE subject_id=s.id AND s.user_id=$1",
        [user],
      );
      await db.query(
        "DELETE FROM world_event USING world_subject s WHERE subject_id=s.id AND s.user_id=$1",
        [user],
      );
      await db.query(
        `DELETE FROM world_player_icon WHERE player_id IN (
        SELECT a.id FROM world_access a JOIN world_subject s ON s.id=a.subject_id WHERE s.user_id=$1
        UNION SELECT id FROM world_join WHERE subject_id=$1)`,
        [user],
      );
      await db.query(
        `UPDATE llm_call SET request='{}',response=NULL,user_id=NULL WHERE user_id=$1 OR operation_id IN
        (SELECT operation_id FROM world_join WHERE subject_id=$1)`,
        [user],
      );
      await db.query(
        `UPDATE world_operation SET request=request-'actionText'-'participantName',messages=NULL,candidate=NULL,result=NULL
        WHERE id IN (SELECT operation_id FROM world_join WHERE subject_id=$1)`,
        [user],
      );
      for (const table of [
        "checkpoint_writes",
        "checkpoint_blobs",
        "checkpoints",
      ])
        await db.query(
          `DELETE FROM ${table} t USING world_join j WHERE j.subject_id=$1 AND t.thread_id LIKE j.operation_id::text||':%'`,
          [user],
        );
      await db.query("DELETE FROM world_join WHERE subject_id=$1", [user]);
      await db.query(
        `DELETE FROM world_access USING world_subject s WHERE subject_id=s.id AND s.user_id=$1`,
        [user],
      );
      await db.query(
        "UPDATE world_subject SET active=false,token_hash=NULL,user_id=NULL WHERE user_id=$1",
        [user],
      );
      await db.query(
        "UPDATE bot_npc SET controller=NULL,user_id=NULL WHERE user_id=$1",
        [user],
      );
      await db.query("DELETE FROM bot_request WHERE user_id=$1", [user]);
      if (ids.length) {
        await db.query(
          `UPDATE bot_chat SET payload=jsonb_set(payload,'{entries}',
          (SELECT jsonb_agg(CASE WHEN e->>'actorId'=ANY($1::text[]) THEN e||'{"label":"退会済み"}'::jsonb ELSE e END ORDER BY ord)
            FROM jsonb_array_elements(payload->'entries') WITH ORDINALITY AS items(e,ord)))
          WHERE jsonb_path_query_array(payload,'$.entries[*].actorId') ?| $1::text[]`,
          [ids],
        );
        const driver = neo4j.driver(
          "bolt://neo4j:7687",
          neo4j.auth.basic("neo4j", this.engine.env.NEO4J_PASSWORD),
        );
        try {
          const session = driver.session();
          try {
            await session.executeWrite(async (tx) => {
              const found = await tx.run(
                `UNWIND $actors AS actor
            CALL (actor) {
              MATCH (n:WorldNode {worldId:actor.graph,id:actor.actor}) RETURN n
              UNION ALL MATCH (n:WorldRevision {worldId:actor.graph,nodeId:actor.actor}) RETURN n
            }
            RETURN elementId(n) AS key,n.data AS data`,
                { actors },
              );
              await tx.run(
                `UNWIND $rows AS row MATCH (n) WHERE elementId(n)=row.key
              SET n.data=row.data REMOVE n.judgmentLong,n.judgmentExcerpt,n.judgmentSourceHash,n.judgmentClaim,n.judgmentAvailableAt`,
                {
                  rows: found.records.map((r) => ({
                    key: r.get("key"),
                    data: JSON.stringify({
                      ...JSON.parse(r.get("data")),
                      text: "退会済み",
                    }),
                  })),
                },
              );
            });
          } finally {
            await session.close();
          }
        } finally {
          await driver.close();
        }
      }
      // Kratos owns password hashes, OIDC links and browser sessions. A 404
      // also occurs when replaying against a snapshot from before registration.
      const result = await fetch(
        `http://kratos:4434/admin/identities/${identity}`,
        { method: "DELETE", signal: AbortSignal.timeout(10000) },
      );
      if (!result.ok && result.status !== 404)
        throw new Error("WITHDRAWAL_IDENTITY_UNAVAILABLE");
      await db.query(
        "UPDATE app_identity SET ory_id=gen_random_uuid() WHERE id=$1 AND ory_id=$2",
        [user, identity],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
}
