import { randomUUID } from "node:crypto";
import { BackupEngine, deploymentLock } from "./engine.mjs";
const input = JSON.parse(process.argv[2]),
  engine = new BackupEngine();
await engine.initialize();
try {
  let result;
  if (input.action === "recover") {
    const job = await engine.load(`jobs/${input.id}.json`, null);
    if (!job || job.operation !== "backups.create" || job.state !== "failed")
      throw new Error(
        "失敗した取得のみサービスを再開できます。復元の失敗は再復元してください。",
      );
    await engine.thaw(job);
    result = { id: job.id, services: "restarted" };
  } else if (input.action === "withdrawal-pending") {
    const authority = await engine.withdrawals.authority(
      engine.env.OPERATIONS_TOKEN_SECRET,
    );
    result = (
      await engine.withdrawals.db.query(
        `SELECT receipt,confirmed_at,structured_at,reviewed_at,erased_at FROM withdrawal_receipt
      WHERE authority=$1 AND finished_at IS NULL AND ($2::uuid IS NULL OR receipt>$2) ORDER BY receipt LIMIT 50`,
        [authority, input.after ?? null],
      )
    ).rows;
  } else if (
    ["withdrawal-review", "withdrawal-confirm"].includes(input.action)
  ) {
    const lock = await deploymentLock("/deploy.lock", 10);
    if (!lock) throw Error("DEPLOYMENT_BUSY");
    try {
      result =
        input.action === "withdrawal-review"
          ? await engine.withdrawals.review(input)
          : await engine.withdrawals.accept(input);
    } finally {
      await lock.close();
    }
  } else if (input.operation === "backups.read") result = await engine.read();
  else if (input.operation === "backups.job")
    result = await engine.job(input.id);
  else if (input.operation === "backups.list")
    result = await engine.snapshots(input.before);
  else if (input.operation === "backups.jobs")
    result = await engine.jobs(input.before);
  else {
    const id = input.requestId ?? randomUUID(),
      operation = { ...input };
    delete operation.requestId;
    await engine.prepare({ id, actor: null, input: operation }, true);
    await engine.activate(id);
    result = { id };
  }
  console.log(JSON.stringify(result));
} finally {
  await engine.pool.end();
}
