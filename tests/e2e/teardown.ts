import { connectDatabases } from "@gestaloka/server";
export default async function teardown() {
  const scope = process.env.E2E_SCOPE;
  if (!scope) throw new Error("E2E_SCOPEが必要です");
  const d = connectDatabases();
  try {
    await d.queue.start();
    const subjects = (
      await d.postgres.query<{ id: string }>(
        "SELECT id FROM e2e_subject WHERE scope=$1",
        [scope],
      )
    ).rows.map((row) => row.id);
    const sessions = (
      await d.postgres.query<{ id: string; world_id: string }>(
        "SELECT DISTINCT c.id,c.world_id FROM world_construction c JOIN world_access a ON a.construction_id=c.id WHERE a.subject_id=ANY($1)",
        [subjects],
      )
    ).rows;
    const ids = sessions.map((row) => row.id),
      worlds = sessions.map((row) => row.world_id).filter(Boolean);
    await d.queue.deleteQueue(`e2e-${scope}`);
    await d.queue.deleteQueue(`e2e-${scope}-play`);
    await d.postgres.query(
      "DELETE FROM world_event WHERE construction_id=ANY($1)",
      [ids],
    );
    await d.postgres.query(
      "DELETE FROM world_access WHERE subject_id=ANY($1)",
      [subjects],
    );
    await d.postgres.query("DELETE FROM api_request WHERE subject_id=ANY($1)", [
      subjects,
    ]);
    await d.postgres.query("DELETE FROM browser_session WHERE id=ANY($1)", [
      subjects,
    ]);
    await d.postgres.query(
      "DELETE FROM construction_log WHERE construction_id=ANY($1)",
      [ids],
    );
    await d.postgres.query("DELETE FROM world_construction WHERE id=ANY($1)", [
      ids,
    ]);
    await d.postgres.query("DELETE FROM world_build WHERE run_id=ANY($1)", [
      ids,
    ]);
    await d.postgres.query(
      "DELETE FROM world_operation WHERE request->>'worldId'=ANY($1)",
      [worlds],
    );
    await d.postgres.query(
      "DELETE FROM world_intent WHERE world_id=ANY($1::uuid[])",
      [worlds],
    );
    await d.postgres.query("DELETE FROM llm_call WHERE budget_id=$1", [
      `e2e-${scope}`,
    ]);
    await d.postgres.query("DELETE FROM llm_budget WHERE id=$1", [
      `e2e-${scope}`,
    ]);
    await d.postgres.query("DELETE FROM e2e_subject WHERE scope=$1", [scope]);
    for (const worldId of worlds)
      await d.graph.executeQuery(
        "MATCH(n) WHERE n.worldId=$worldId DETACH DELETE n",
        { worldId },
      );
  } finally {
    await d.queue.stop();
    await d.close();
  }
}
