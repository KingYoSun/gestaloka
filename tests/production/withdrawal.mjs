import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { OryIdentity } from "@gestaloka/server/identity";
import { Operations } from "@gestaloka/server/operations";
import { Stories } from "../../packages/server/dist/http/stories.js";
import { PlayerDevices } from "../../packages/server/dist/http/player-devices.js";
import { createApp } from "../../apps/api/dist/app.js";

const require = createRequire(
  new URL("../../packages/server/package.json", import.meta.url),
);
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const neo4j = require("neo4j-driver");
const graph = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic("neo4j", process.env.NEO4J_PASSWORD),
);
const [action, data] = process.argv.slice(2);
const input = JSON.parse(data || "{}");
try {
  const expected = (await pool.query("SELECT data FROM recovery_expectation"))
    .rows[0].data;
  if (action === "seed") {
    const response = await fetch("http://kratos:4434/admin/identities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema_id: "default", traits: {} }),
    });
    assert.equal(response.status, 201);
    const identity = (await response.json()).id,
      user = randomUUID(),
      story = randomUUID(),
      keep = randomUUID(),
      device = "1".repeat(64),
      actor = randomUUID(),
      slot = randomUUID();
    await pool.query("INSERT INTO app_identity(id,ory_id) VALUES($1,$2)", [
      user,
      identity,
    ]);
    await pool.query("INSERT INTO app_user(id,role) VALUES($1,'user')", [user]);
    await pool.query("INSERT INTO world_subject(id,user_id) VALUES($1,$1)", [
      user,
    ]);
    await pool.query(
      "INSERT INTO world_access(id,subject_id,construction_id,role,actor_id) VALUES($1,$2,$3,'player',$4)",
      [slot, user, expected.world, actor],
    );
    await pool.query(
      "INSERT INTO world_player_icon(player_id,construction_id,image) VALUES($1,$2,'架空のアイコン')",
      [slot, expected.world],
    );
    await graph.executeQuery(
      "CREATE (:WorldNode {worldId:$world,id:$actor,kind:'existence',data:$data,knownFrom:0})",
      {
        world: expected.bundle.graphId,
        actor,
        data: JSON.stringify({
          id: actor,
          kind: "existence",
          text: "試験の旧人物名",
        }),
      },
    );
    await pool.query(
      "UPDATE recovery_expectation SET data=jsonb_set(data,'{graph}',to_jsonb((data->>'graph')::int+1))",
    );
    for (const id of [story, keep]) {
      await pool.query(
        "INSERT INTO player_story(id,world_id,world_title,author_id,author,title) VALUES($1,$2,'試験世界',$3,'架空の著者','試験作品')",
        [id, expected.world, user],
      );
      await pool.query(
        "INSERT INTO player_story_episode(story_id,number,request_id,body,image) VALUES($1,1,$2,'架空の本文','試験画像')",
        [id, randomUUID()],
      );
    }
    await pool.query(
      "INSERT INTO player_device(id,world_id,token_hash,user_code,user_id,character,icon) VALUES($1,$2,$3,$4,$5,'架空の設定','架空のアイコン')",
      [
        randomUUID(),
        expected.world,
        createHash("sha256").update(device).digest("hex"),
        randomUUID(),
        user,
      ],
    );
    console.log(
      JSON.stringify({ user, identity, story, keep, device, actor, slot }),
    );
    await pool.query(
      "INSERT INTO inspection_manifest(id,world_id,actor_id,data,measurement) VALUES($1,$2,$3,$4,'{}')",
      [
        story,
        expected.world,
        expected.actor,
        JSON.stringify({ quote: "解説：架空の私信。続き" }),
      ],
    );
  } else if (action === "confirm") {
    const session = randomUUID();
    const identity = new OryIdentity(pool, "http://kratos:4433", async () =>
      Response.json({
        id: session,
        active: true,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        identity: { id: input.identity, state: "active" },
      }),
    );
    const app = await createApp(
      undefined,
      identity,
      undefined,
      new Operations(pool, process.env.OPERATIONS_TOKEN_SECRET),
    );
    try {
      const headers = { cookie: "synthetic=owner" };
      const form = await app.inject({ url: "/auth/withdraw", headers });
      assert.equal(form.statusCode, 200);
      assert(form.body.includes(input.keep));
      const csrf = form.body.match(/name="csrf" value="([^"]+)"/)[1];
      const result = await app.inject({
        method: "POST",
        url: "/auth/withdraw",
        headers: {
          ...headers,
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: new URLSearchParams({
          csrf,
          keep: input.keep,
          confirm: "yes",
        }).toString(),
      });
      assert.equal(result.statusCode, 200, result.body);
      assert(result.body.includes("受付番号"));
      console.log(
        JSON.stringify({
          receipt: result.body.match(
            /\/auth\/withdraw\/status\/([0-9a-f-]+)/,
          )[1],
        }),
      );
    } finally {
      await app.close();
    }
  } else {
    const stories = new Stories(pool);
    if (action === "before") {
      assert.equal(
        (await stories.read(expected.user, input.story, {})).story.title,
        "試験作品",
      );
      assert.equal(
        (await new PlayerDevices(pool).read("Bearer " + input.device)).user_id,
        input.user,
      );
    } else {
      const quote = (
        await pool.query(
          "SELECT data->>'quote' AS value FROM inspection_manifest WHERE id=$1",
          [input.story],
        )
      ).rows[0].value;
      assert.equal(
        quote,
        action === "structured"
          ? "解説：架空の私信。続き"
          : "解説：［削除済み］。続き",
      );
      assert.equal(
        (await fetch("http://kratos:4434/admin/identities/" + input.identity))
          .status,
        404,
      );
      await assert.rejects(
        new PlayerDevices(pool).read("Bearer " + input.device),
      );
      await assert.rejects(
        stories.read(expected.user, input.story, { image: "1" }),
        { code: "STORY_NOT_FOUND" },
      );
      assert.equal(
        (await stories.read(expected.user, input.keep, {})).story.author,
        "退会済み",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM player_story_episode WHERE story_id=$1",
            [input.story],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await pool.query("SELECT 1 FROM app_identity WHERE ory_id=$1", [
            input.identity,
          ])
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await pool.query("SELECT 1 FROM player_device WHERE user_id=$1", [
            input.user,
          ])
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM world_player_icon WHERE player_id=$1",
            [input.slot],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        JSON.parse(
          (
            await graph.executeQuery(
              "MATCH(n:WorldNode {worldId:$world,id:$actor}) RETURN n.data AS data",
              { world: expected.bundle.graphId, actor: input.actor },
            )
          ).records[0].get("data"),
        ).text,
        "退会済み",
      );
    }
  }
} finally {
  await pool.end();
  await graph.close();
}
