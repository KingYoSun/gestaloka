import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { BackupEngine } from "./engine.mjs";

const engine = new BackupEngine();
await engine.initialize(true);
const expected = Buffer.from(`Bearer ${engine.env.CONTROL_TOKEN}`);
const server = createServer(async (request, response) => {
  try {
    const actual = Buffer.from(request.headers.authorization ?? "");
    if (
      request.method !== "POST" ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      response.writeHead(403).end();
      return;
    }
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 65536) throw new Error("TOO_LARGE");
    }
    const input = JSON.parse(body);
    let output;
    switch (request.url) {
      case "/read":
        output = await engine.read();
        break;
      case "/list":
        output = await engine.snapshots(input.before);
        break;
      case "/job":
        output = await engine.job(input.id);
        break;
      case "/jobs":
        output = await engine.jobs(input.before);
        break;
      case "/prepare":
        output = await engine.prepare(input);
        break;
      case "/activate":
        await engine.activate(input.id);
        output = { id: input.id };
        break;
      default:
        response.writeHead(404).end();
        return;
    }
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(output));
  } catch {
    response
      .writeHead(409, { "content-type": "application/json" })
      .end('{"error":"BACKUP_OPERATION_FAILED"}');
  }
});
server.listen(3100, "0.0.0.0");
setInterval(() => {
  void engine
    .tick()
    .catch(() => console.error("Backup controller is waiting for storage"));
}, 2000);
console.log("Backup controller ready");
