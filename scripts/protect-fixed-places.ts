import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { connectDatabases } from "@gestaloka/server";
import { WorldStore } from "@gestaloka/server/world";

const { values } = parseArgs({
  options: {
    world: { type: "string" },
    decisions: { type: "string" },
    apply: { type: "boolean" },
  },
});
const world = z.uuid().parse(values.world);
const reviewed = values.decisions
  ? z
      .object({
        world: z.literal(world),
        fixed: z.array(z.uuid()),
        movable: z.array(z.uuid()),
      })
      .strict()
      .parse(JSON.parse(await readFile(values.decisions, "utf8")))
  : { fixed: [], movable: [] };
const db = connectDatabases();
const client = await db.postgres.connect();
try {
  await client.query("BEGIN");
  if (values.apply)
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,225))",
      [world],
    );
  const graph = (
    await client.query<{ world_id: string }>(
      "SELECT world_id FROM world_construction WHERE id=$1 AND world_id IS NOT NULL",
      [world],
    )
  ).rows[0]?.world_id;
  if (!graph) throw new Error("構築済みの世界IDを指定してください");
  const actors = (
    await client.query<{ id: string }>(
      "SELECT actor_id AS id FROM world_controlled_actor WHERE world_id=$1 UNION SELECT actor_id FROM bot_npc WHERE world_id=$2",
      [graph, world],
    )
  ).rows.map((row) => row.id);
  const result = await new WorldStore(db.graph).protectExistingPlaces(
    graph,
    actors,
    reviewed,
    values.apply,
  );
  await client.query("COMMIT");
  console.log(JSON.stringify({ world, ...result }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await db.close();
}
