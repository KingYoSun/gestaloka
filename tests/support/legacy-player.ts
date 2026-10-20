import type { WorldConstruction } from "@gestaloka/server/construction";

/** Build an archived single-player save for compatibility tests; no runtime join entry. */
export async function legacyPlayer(runtime: WorldConstruction, id: string) {
  const row = await runtime.get(id);
  if (row.participant_id) return row.participant_id;
  const op = await runtime.agent.create({
    worldId: row.world_id!,
    phase: "participant",
    rootIds: row.root_ids,
    at: row.at,
    until: row.at,
    actionText: "",
  });
  const result = await runtime.agent.run(op);
  await runtime.pool.query(
    "UPDATE world_construction SET participant_id=$2 WHERE id=$1",
    [id, result.newParticipantId],
  );
  return result.newParticipantId!;
}
