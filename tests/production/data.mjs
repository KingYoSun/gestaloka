import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fixtureRuntime } from "../support/provider.ts";
import { fixtureAuth } from "../support/auth.ts";
import { WorldAccess } from "@gestaloka/server/access";
import { Operations } from "@gestaloka/server/operations";
import { directPlaces } from "../../packages/server/src/world/locations.ts";

const { databases: db, runtime } = await fixtureRuntime("deployment-recovery");
const auth = await fixtureAuth(db.postgres),
  access = new WorldAccess(runtime);
auth.operations = new Operations(
  db.postgres,
  process.env.OPERATIONS_TOKEN_SECRET,
);
await access.setup();
try {
  if (process.argv[2] === "seed") {
    const admin = (await auth.person()).id,
      user = (await auth.person("user")).id,
      identity = await (
        await fetch("http://kratos:4434/admin/identities", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ schema_id: "default", traits: {} }),
        })
      ).json();
    assert(identity.id);
    await db.postgres.query("UPDATE app_identity SET ory_id=$2 WHERE id=$1", [
      admin,
      identity.id,
    ]);
    const client = await fetch("http://hydra:4445/admin/clients", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: "recovery-test-client",
        client_secret: "recovery-test-client-secret",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        redirect_uris: ["https://client.example/callback"],
        scope: "openid",
      }),
    });
    assert([201, 409].includes(client.status));
    const world = (
      await access.create(admin, {
        requestId: randomUUID(),
        prompt: "隔離環境での復元確認",
        budgetUsd: 100,
      })
    ).id;
    await runtime.tick(world);
    await access.command(admin, world, {
      requestId: randomUUID(),
      command: "finish",
    });
    await auth.operations.execute(admin, randomUUID(), {
      operation: "worlds.configure",
      worldId: world,
      title: "復元試験",
      description: "試験用",
      published: true,
      accepting: true,
      reason: "試験",
    });
    const preset = randomUUID(),
      join = randomUUID();
    await auth.operations.execute(admin, randomUUID(), {
      operation: "presets.put",
      presetId: preset,
      title: "村民",
      description: "試験用",
      settings: "村民として参加",
      expectedVersion: 0,
      reason: "試験",
    });
    await auth.operations.execute(
      user,
      join,
      {
        operation: "worlds.join",
        worldId: world,
        presetId: preset,
        presetVersion: 1,
      },
      { players: access.players },
    );
    await access.players.tick(join);
    const joined = (
      await db.postgres.query("SELECT * FROM world_join WHERE id=$1", [join])
    ).rows[0];
    assert.equal(joined.state, "ready");
    const actor = joined.actor_id;
    const { id: graphId, at } = await access.botPlay.world(world);
    const store = access.botPlay.store;
    const [storageId] = await directPlaces(store.context(graphId), actor);
    assert(storageId);
    const itemIds = [randomUUID(), randomUUID()];
    await store.commit(
      await store.claim(graphId, randomUUID()),
      store.context(graphId),
      {
        commitId: randomUUID(),
        at,
        changes: {
          nodes: itemIds.map((id) => ({
            id,
            kind: "existence",
            text: "試験の木片",
          })),
          edges: [
            { source: actor, target: storageId, role: "use" },
            ...itemIds.map((target) => ({ source: storageId, target })),
          ].map((edge) => ({
            ...edge,
            id: randomUUID(),
            kind: "has",
            period: { from: at },
          })),
          revisions: [],
          endEdges: [],
        },
      },
    );
    const bundle = await access.editInventoryBundle(
      user,
      world,
      {
        requestId: randomUUID(),
        storageId,
        itemIds,
        label: "試験の木片",
        action: "create",
      },
      actor,
    );
    const slots = await store.context(graphId).inventorySlots(storageId);
    await access.botCommand(
      user,
      world,
      { requestId: randomUUID(), command: "start" },
      actor,
    );
    const speech = {
      requestId: randomUUID(),
      command: "say",
      text: "周囲の観測を相談する",
    };
    const accepted = await access.botCommand(user, world, speech, actor);
    await access.botCommand(
      user,
      world,
      { requestId: randomUUID(), command: "end-turn" },
      actor,
    );
    await access.botCommand(
      user,
      world,
      { requestId: randomUUID(), command: "comment", text: "次の手番の考え" },
      actor,
    );
    const savedScene = await access.botStatus(user, world, actor);
    assert(savedScene.sessionId);
    // A real committed graph receipt with an unfinished PostgreSQL operation.
    await db.postgres.query(
      "UPDATE world_operation SET state='paused',result=NULL,suspended=true WHERE id=$1",
      [joined.operation_id],
    );
    await auth.operations.models.putSecret(
      db.postgres,
      "gemini",
      "recovery-test-provider-secret",
      (
        await db.postgres.query(
          "SELECT version FROM llm_credential WHERE provider='gemini'",
        )
      ).rows[0]?.version ?? 0,
      admin,
    );
    await mkdir("/runtime/backup-fixture", { recursive: true });
    await writeFile(
      "/runtime/backup-fixture/recovery-context.json",
      JSON.stringify({ id: join, continuation: "saved-context" }),
    );
    const fees = (
        await db.postgres.query(
          "SELECT count(*)::int AS calls,coalesce(sum(charged_nano),0)::text AS calculated FROM llm_call",
        )
      ).rows[0],
      graph = (
        await db.graph.executeQuery("MATCH(n) RETURN count(n) AS n")
      ).records[0]
        .get("n")
        .toNumber();
    await db.postgres.query(
      "CREATE TABLE IF NOT EXISTS recovery_expectation(data jsonb NOT NULL); TRUNCATE recovery_expectation",
    );
    await db.postgres.query("INSERT INTO recovery_expectation VALUES($1)", [
      JSON.stringify({
        admin,
        user,
        ory: identity.id,
        world,
        actor,
        scene: savedScene.sceneId,
        speech,
        accepted,
        join,
        operation: joined.operation_id,
        fees,
        graph,
        sceneData: savedScene,
        bundle: { ...bundle, storageId, itemIds, slots, graphId },
      }),
    ]);
    console.log(JSON.stringify({ seeded: true, fees: fees.calls }));
  } else {
    const expected = (
      await db.postgres.query("SELECT data FROM recovery_expectation")
    ).rows[0].data;
    const identity = await fetch(
      `http://kratos:4434/admin/identities/${expected.ory}`,
    );
    assert.equal(identity.status, 200);
    const client = await fetch(
      "http://hydra:4445/admin/clients/recovery-test-client",
    );
    assert.equal(client.status, 200);
    assert.equal(
      (await auth.operations.state(expected.admin)).member.role,
      "admin",
    );
    assert.equal(
      (await auth.operations.state(expected.user)).member.role,
      "user",
    );
    assert.equal(
      (await access.player(expected.user, expected.world, expected.actor))
        .viewerId,
      expected.actor,
    );
    assert.equal(
      await auth.operations.models.secret("gemini"),
      "recovery-test-provider-secret",
    );
    assert.equal(
      JSON.parse(
        await readFile("/runtime/backup-fixture/recovery-context.json", "utf8"),
      ).id,
      expected.join,
    );
    const { bundle } = expected;
    const restoredBundle = await access.inventoryContents(
      expected.user,
      expected.world,
      bundle.bundleId,
      undefined,
      expected.actor,
    );
    assert.deepEqual(
      restoredBundle.items.map(({ id }) => id).sort(),
      bundle.itemIds.sort(),
    );
    assert.equal(
      await access.botPlay.store
        .context(bundle.graphId)
        .inventorySlots(bundle.storageId),
      bundle.slots,
    );
    const scene = await access.botStatus(
      expected.user,
      expected.world,
      expected.actor,
    );
    assert.deepEqual(scene, expected.sceneData);
    assert.deepEqual(
      await access.botCommand(
        expected.user,
        expected.world,
        expected.speech,
        expected.actor,
      ),
      expected.accepted,
    );
    const before = (
      await db.postgres.query(
        "SELECT count(*)::int AS calls,coalesce(sum(charged_nano),0)::text AS calculated FROM llm_call",
      )
    ).rows[0];
    assert.deepEqual(before, expected.fees);
    await runtime.agent.run(expected.operation);
    await runtime.agent.run(expected.operation);
    assert.equal(
      (
        await db.postgres.query(
          "SELECT state FROM world_operation WHERE id=$1",
          [expected.operation],
        )
      ).rows[0].state,
      "complete",
    );
    assert.equal(
      (await db.graph.executeQuery("MATCH(n) RETURN count(n) AS n")).records[0]
        .get("n")
        .toNumber(),
      expected.graph,
    );
    assert.deepEqual(
      (
        await db.postgres.query(
          "SELECT count(*)::int AS calls,coalesce(sum(charged_nano),0)::text AS calculated FROM llm_call",
        )
      ).rows[0],
      before,
    );
    console.log(
      JSON.stringify({
        restored: true,
        identity: true,
        oauthClient: true,
        roles: true,
        actor: true,
        scene: true,
        runtimeFiles: true,
        encryptedCredential: true,
        receiptReconciled: true,
        noReroll: true,
        noDuplicateCommit: true,
        noDuplicateCharge: true,
      }),
    );
  }
} finally {
  await db.queue.stop();
  await db.close();
}
