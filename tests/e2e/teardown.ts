import { connectDatabases } from "@gestaloka/server";
export default async function teardown() {
  const scope = process.env.E2E_SCOPE,
    schema = `e2e_${scope?.replaceAll("-", "")}`;
  if (!/^e2e_[a-f0-9]{32}$/.test(schema))
    throw new Error("E2E_SCOPEが必要です");
  const d = connectDatabases();
  try {
    await d.queue.start();
    const worlds = (
      await d.postgres.query("SELECT world_id FROM world_build")
    ).rows
      .map((r) => r.world_id)
      .filter(Boolean);
    for (const suffix of ["", "-play", "-scenes", "-joins"])
      await d.queue.deleteQueue(`e2e-${scope}${suffix}`);
    for (const worldId of worlds)
      await d.graph.executeQuery(
        "MATCH(n) WHERE n.worldId=$worldId DETACH DELETE n",
        { worldId },
      );
    await d.postgres.query(`DROP SCHEMA ${schema} CASCADE`);
  } finally {
    await d.queue.stop();
    await d.close();
  }
}
