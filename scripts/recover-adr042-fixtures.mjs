import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { connectDatabases } from "@gestaloka/server";

const directory = resolve(process.argv[2]);
const sources = {};
async function read(name) {
  const bytes = await readFile(resolve(directory, name));
  sources[name] = createHash("sha256").update(bytes).digest("hex");
  return JSON.parse(bytes);
}
const original = await read(
  "muse-investigation-20261116/scene-resume-before.json",
);
const graph = await read("muse-investigation-20261116/post-location-fix.json");
const live = await read("adr042-unification/live-2.json");
const replay = await read("adr042-unification/replay-6.json");
assert.equal(graph.receipts.length, 157);
assert.equal(original.scene.data.work.kind, "background");
assert(!original.calls.some((call) => call.id === original.scene.data.work.id));
const harbor = live.cases.find((item) => item.label === "harbor");
const opening = harbor.snapshots.find(
  (item) => item.label === "second-opening",
);
const prior = harbor.snapshots.find(
  (item) => item.label === "receiver-chosen-reply",
);
const d = connectDatabases();
for (const key of ["DATABASE_URL", "NEO4J_URI"])
  assert.equal(new URL(process.env[key]).hostname, "127.0.0.1");
try {
  // Recover the archived world's receipts, not its post-trial current graph.
  const result = await d.graph.executeQuery(
    "MATCH(r:WorldReceipt {worldId:$world}) RETURN r.data AS data",
    { world: harbor.world },
  );
  const receipts = result.records
    .map((row) => JSON.parse(row.get("data")))
    .filter((receipt) => receipt.committedAt < opening.scene.created_at)
    .sort((a, b) => a.committedAt.localeCompare(b.committedAt));
  assert.equal(receipts.length, 7, "Original harbor receipts must still exist");
  const fixtures = {
    version: "adr042-scene-fixtures-v1",
    sources,
    harborReceiptSource: {
      world: harbor.world,
      before: opening.scene.created_at,
    },
    scenarios: [
      {
        id: "johnny-michiko",
        scene: original.scene,
        receipts: graph.receipts,
        controlled: graph.control.controlled,
        peers: original.scene.data.peerConditions,
        positions: original.positions,
        actors: [original.scene.actor_id, replay.replyInput.actor],
        reply: replay.replyInput.text,
      },
      {
        id: "welded-warehouse",
        scene: opening.scene,
        relatedScenes: [prior.scene],
        receipts,
        controlled: [harbor.a, harbor.b].map((actor_id) => ({
          actor_id,
          npc_active: false,
        })),
        positions: opening.positions,
        actors: [harbor.a, harbor.b],
        input: harbor.action,
      },
    ],
  };
  const bytes = Buffer.from(JSON.stringify(fixtures));
  const path = new URL(
    "../documents/evaluations/adr042-ember-fixtures.json.gz",
    import.meta.url,
  );
  await writeFile(path, gzipSync(bytes));
  console.log(
    JSON.stringify({
      path: path.pathname,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      receiptCounts: fixtures.scenarios.map((item) => item.receipts.length),
    }),
  );
} finally {
  await d.close();
}
