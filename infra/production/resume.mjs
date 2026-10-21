import { randomUUID } from "node:crypto";
import { connectDatabases } from "@gestaloka/server";
import { Operations } from "@gestaloka/server/operations";
import { WorldAccess } from "@gestaloka/server/access";
import { WorldConstruction } from "@gestaloka/server/construction";
import { WorldBuilder } from "@gestaloka/server/build";
import { WorldAgent } from "@gestaloka/server/agent";
import { LlmClient } from "@gestaloka/server/llm";
const db = connectDatabases();
try {
  await db.queue.start();
  const model = await LlmClient.create(db.postgres),
    access = new WorldAccess(
      new WorldConstruction(
        new WorldBuilder(db.postgres, db.graph, db.checkpointer, model),
        new WorldAgent(db.postgres, db.graph, db.checkpointer, model),
        db.queue,
      ),
    ),
    operations = new Operations(
      db.postgres,
      process.env.OPERATIONS_TOKEN_SECRET,
    );
  for (const { kind, id } of JSON.parse(process.argv[2])) {
    const stopped = (
      await db.postgres.query(
        "SELECT 1 FROM runtime_execution WHERE kind=$1 AND id=$2 AND error_code='MAINTENANCE'",
        [kind, id],
      )
    ).rowCount;
    if (!stopped) continue;
    const continuation =
      (
        await db.postgres.query(
          "SELECT permission FROM mcp_execution WHERE kind=$1 AND id=$2",
          [kind, id],
        )
      ).rows[0]?.permission ?? null;
    const admin = (
      await db.postgres.query(
        "SELECT id FROM app_user WHERE role='admin' AND NOT banned ORDER BY created_at LIMIT 1",
      )
    ).rows[0];
    if (!admin) break;
    try {
      await operations.execute(
        admin.id,
        randomUUID(),
        {
          operation: "jobs.resume",
          kind,
          id,
          reason: "バックアップ・復元後に保存状態から再開",
        },
        { players: access.players, continuation },
      );
    } catch {
      console.error("保存状態の再開には運用画面での確認が必要です");
    }
  }
} finally {
  await db.queue.stop();
  await db.close();
}
