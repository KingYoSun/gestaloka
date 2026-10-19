import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { entrypoint, interrupt, task, Command } from "@langchain/langgraph";
import { connectDatabases } from "@gestaloka/server";

const databases = connectDatabases();
beforeAll(async () => {
  await databases.verify();
  await databases.checkpointer.setup();
  databases.queue.on("error", (error) => console.error(error));
  await databases.queue.start();
});
afterAll(async () => {
  await databases.queue.stop();
  await databases.close();
});

test("Neo4jに保存した運用テストレコードを接続し直して読める", async () => {
  const id = randomUUID();
  await databases.graph.executeQuery(
    "CREATE (:InfrastructureProbe {id: $id})",
    { id },
  );
  const another = connectDatabases();
  try {
    const result = await another.graph.executeQuery(
      "MATCH (p:InfrastructureProbe {id: $id}) RETURN p.id AS id",
      { id },
    );
    expect(result.records[0]?.get("id")).toBe(id);
  } finally {
    await another.close();
    await databases.graph.executeQuery(
      "MATCH (p:InfrastructureProbe {id: $id}) DELETE p",
      { id },
    );
  }
});

test("キュー投入のロールバックとコミットを実DBで区別できる", async () => {
  const name = `probe-${randomUUID()}`;
  await databases.queue.createQueue(name);
  const client = await databases.postgres.connect();
  const db = {
    executeSql: (text: string, values: unknown[]) => client.query(text, values),
  };
  try {
    await client.query("BEGIN");
    await databases.queue.send(name, { requestId: "rolled-back" }, { db });
    await client.query("ROLLBACK");
    expect(await databases.queue.fetch(name)).toEqual([]);
    await client.query("BEGIN");
    const id = await databases.queue.send(
      name,
      { requestId: "committed" },
      { db },
    );
    await client.query("COMMIT");
    const [job] = await databases.queue.fetch(name);
    expect(job?.id).toBe(id);
    await databases.queue.complete(name, id!);
  } finally {
    client.release();
    await databases.queue.deleteQueue(name);
  }
});

test("LangGraphの中断後に接続を作り直しても保存済みtaskを再実行しない", async () => {
  let calls = 0;
  const work = task("persisted-probe", async () => {
    calls++;
    return { requestId: randomUUID() };
  });
  const makeWorkflow = (checkpointer: typeof databases.checkpointer) =>
    entrypoint({ name: "probe", checkpointer }, async () => {
      const result = await work();
      interrupt("resume");
      return result;
    });
  const config = { configurable: { thread_id: randomUUID() } };
  await makeWorkflow(databases.checkpointer).invoke({}, config);
  expect(calls).toBe(1);
  const another = connectDatabases();
  try {
    const resumed = await makeWorkflow(another.checkpointer).invoke(
      new Command({ resume: true }),
      config,
    );
    expect(resumed).toHaveProperty("requestId");
    expect(calls).toBe(1);
  } finally {
    await another.close();
  }
});
