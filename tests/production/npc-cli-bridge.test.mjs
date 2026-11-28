import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { forwardWakes } from "../../infra/production/wake-sender.mjs";
import {
  createNpcBridge,
  createNpcMcpServer,
  validateInvocation,
} from "../../infra/production/npc-cli-bridge.mjs";

test("待機通知と重なって手番の起床を逃しても、現在の手番を再配信して一度だけ進める", async () => {
  const commands = [];
  const bridge = createNpcBridge({
    roles: { alpha: {} },
    verify: async () => {},
    run: async (_role, [command]) => {
      commands.push(command);
      return {};
    },
  });
  const notice = {
    state: "standby",
    noticeKey: "11111111-1111-4111-8111-111111111111",
  };
  const turn = { state: "turn", actionable: true, wakeKey: "b".repeat(64) };
  const retry = new AbortController();
  const frames = [notice, turn, "timeout", turn, turn, { state: "inactive" }];
  const delivered = [];
  const saved = [];
  const call = (grant, command) =>
    bridge.call({ ...grant, callId: command, args: [command] });
  await forwardWakes({
    retrySignal: () => retry.signal,
    async listen(afterWake, afterNotice, signal) {
      const frame = frames.shift();
      if (frame === "timeout") {
        assert.equal(afterWake, turn.wakeKey);
        assert.equal(afterNotice, notice.noticeKey);
        assert.equal(signal, retry.signal);
        // The notice worker still owns the lock. The first turn wake exited.
        await call(delivered[0], "status");
        await assert.rejects(call(delivered[0], "say"), /COMMAND_DENIED/);
        await call(delivered[1], "status");
        retry.abort();
        throw new DOMException("retry", "AbortError");
      }
      if (frame === turn) assert.notEqual(afterWake, turn.wakeKey);
      return frame;
    },
    mint(key, receive) {
      const lease = bridge.issue("alpha", !!key, receive, key);
      return lease === "USED" ? { used: true } : { npc: "alpha", lease };
    },
    async post(_state, body) {
      delivered.push(body);
      if (delivered.length !== 3) return;
      assert.equal(body.wakeKey, turn.wakeKey);
      assert.notEqual(body.lease, delivered[1].lease);
      for (const command of ["status", "say", "end-turn"])
        await call(body, command);
      await assert.rejects(call(delivered[1], "say"), /WAKE_ALREADY_HANDLED/);
    },
    save: (kind, key) => saved.push([kind, key]),
  });
  assert.equal(frames.length, 0);
  assert.equal(delivered.length, 3);
  assert.deepEqual(commands, ["status", "status", "status", "say", "end-turn"]);
  assert.deepEqual(saved, [
    ["notice", notice.noticeKey],
    ["key", turn.wakeKey],
  ]);
});

test("起床の権限は別のNPCへ渡らず、期限を過ぎると使えない", async () => {
  let now = 10;
  const bridge = createNpcBridge({
    roles: { alpha: "merchant", beta: "village chief" },
    verify: async () => {},
    run: async (role) => role,
    clock: () => now,
    ttl: 1000,
  });
  const lease = bridge.issue("alpha", false);
  const input = { lease, callId: "1", args: ["status", "--full-ids"] };
  await assert.rejects(bridge.call({ ...input, npc: "beta" }), /WRONG_NPC/);
  assert.equal(await bridge.call({ ...input, npc: "alpha" }), "merchant");
  await assert.rejects(
    bridge.call({ ...input, npc: "alpha", callId: "2", args: ["finish"] }),
    /COMMAND_DENIED/,
  );
  now += 1000;
  await assert.rejects(
    bridge.call({ ...input, npc: "alpha" }),
    /LEASE_INVALID/,
  );
});

test("NPC専用のMCP接続から起床なしで本人のセッションを開始できる", async (t) => {
  const tokens = {
    alpha: randomBytes(32).toString("base64url"),
    beta: randomBytes(32).toString("base64url"),
  };
  const roles = Object.fromEntries(
    Object.entries(tokens).map(([name, token]) => [
      name,
      {
        name,
        directTokenSha256: createHash("sha256").update(token).digest("hex"),
      },
    ]),
  );
  let starts = 0;
  const bridge = createNpcBridge({
    roles,
    verify: async (role) => assert.equal(role, roles.alpha),
    async run(role, [command]) {
      if (command === "start") starts++;
      return { actor: role.name, state: starts ? "active" : "standby" };
    },
  });
  const server = createNpcMcpServer(bridge, roles).listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  function request(path, token, method, params) {
    return fetch(origin + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token && { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  }
  const path = "/direct/alpha/mcp";
  for (const [url, token] of [
    [path, undefined],
    [path, tokens.beta],
    ["/direct/beta/mcp", tokens.alpha],
  ]) {
    const response = await request(url, token, "tools/list");
    assert.equal(response.status, 401);
  }
  const tools = await request(path, tokens.alpha, "tools/list").then((r) =>
    r.json(),
  );
  assert.deepEqual(
    tools.result.tools.map((tool) => tool.name),
    ["npc_cli_direct"],
  );
  const wake = await request("/mcp", undefined, "tools/list").then((r) =>
    r.json(),
  );
  assert.deepEqual(
    wake.result.tools.map((tool) => tool.name),
    ["npc_cli"],
  );
  async function call(callId, args) {
    const r = await request(path, tokens.alpha, "tools/call", {
      name: "npc_cli_direct",
      arguments: { callId, args },
    });
    assert.equal(r.status, 200);
    return JSON.parse((await r.json()).result.content[0].text);
  }
  assert.deepEqual(await call("status", ["status"]), {
    actor: "alpha",
    state: "standby",
  });
  const opened = { actor: "alpha", state: "active" };
  assert.deepEqual(
    await Promise.all([call("start", ["start"]), call("start", ["start"])]),
    [opened, opened],
  );
  assert.deepEqual(await call("status-after", ["status"]), opened);
  assert.deepEqual(await call("start", ["finish"]), {
    error: "DUPLICATE_REQUEST_ID",
  });
  assert.deepEqual(await call("profile", ["start", "--profile", "beta.json"]), {
    error: "INVALID_ARGUMENTS",
  });
  assert.equal(starts, 1);
});

test("再送は同じCLI操作を繰り返さず、資格情報やパスを指定できない", async () => {
  let runs = 0;
  const bridge = createNpcBridge({
    roles: { alpha: {} },
    verify: async () => {},
    run: async () => ++runs,
  });
  const input = {
    npc: "alpha",
    lease: bridge.issue("alpha", true),
    callId: "finish",
    args: ["finish"],
  };
  assert.deepEqual(
    await Promise.all([bridge.call(input), bridge.call(input)]),
    [1, 1],
  );
  assert.equal(runs, 1);
  await assert.rejects(
    bridge.call({ ...input, args: ["end-turn"] }),
    /DUPLICATE_REQUEST_ID/,
  );
  for (const args of [
    ["status", "--profile", "another.json"],
    ["status", "--", "dummy"],
    ["say", "--file", "/etc/passwd"],
    ["update"],
    ["connect"],
    ["stories", "post"],
  ])
    assert.throws(() => validateInvocation(args, undefined, true));
  assert.equal(
    validateInvocation(["play", "--quote"], { command: "apply" }, true).command,
    "play",
  );
});

test("通知で起床したNPCは通常の手番がなくても受領を判断できる", async () => {
  const bridge = createNpcBridge({
    roles: { alpha: {} },
    verify: async () => {},
    run: async (_role, args) => args,
  });
  const request = {
    npc: "alpha",
    callId: "receive",
    args: ["receive", "--application", "@12ab34cd", "--accept"],
  };
  await assert.rejects(
    bridge.call({ ...request, lease: bridge.issue("alpha", false) }),
    /COMMAND_DENIED/,
  );
  const lease = bridge.issue("alpha", false, true);
  assert.deepEqual(await bridge.call({ ...request, lease }), request.args);
  const reject = ["receive", "--application", "@12ab34cd", "--reject"];
  assert.deepEqual(
    await bridge.call({ ...request, lease, callId: "reject", args: reject }),
    reject,
  );
  await assert.rejects(
    bridge.call({ ...request, lease, callId: "finish", args: ["finish"] }),
    /COMMAND_DENIED/,
  );
});
