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
    await d.queue.deleteQueue(`e2e-${scope}-scenes`);
    await d.queue.deleteQueue(`e2e-${scope}-joins`);
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
    await d.postgres.query("DELETE FROM world_subject WHERE id=ANY($1)", [
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
    await d.postgres.query(
      "DELETE FROM world_controlled_actor WHERE world_id=ANY($1)",
      [worlds],
    );
    await d.postgres.query("DELETE FROM llm_call WHERE budget_id=$1", [
      `e2e-${scope}`,
    ]);
    await d.postgres.query("DELETE FROM llm_budget WHERE id=$1", [
      `e2e-${scope}`,
    ]);
    await d.postgres.query(
      "DELETE FROM operation_audit WHERE request_id IN (SELECT id FROM operation_request WHERE actor_id=ANY($1))",
      [subjects],
    );
    await d.postgres.query(
      "DELETE FROM operation_request WHERE actor_id=ANY($1)",
      [subjects],
    );
    await d.postgres.query(
      "DELETE FROM player_preset WHERE updated_by=ANY($1)",
      [subjects],
    );
    await d.postgres.query("DELETE FROM app_user WHERE id=ANY($1)", [subjects]);
    await d.postgres.query("DELETE FROM app_identity WHERE id=ANY($1)", [
      subjects,
    ]);
    for (const worldId of worlds)
      await d.graph.executeQuery(
        "MATCH(n) WHERE n.worldId=$worldId DETACH DELETE n",
        { worldId },
      );
    await d.postgres.query("DELETE FROM e2e_subject WHERE scope=$1", [scope]);
  } finally {
    await d.queue.stop();
    await d.close();
  }
}
