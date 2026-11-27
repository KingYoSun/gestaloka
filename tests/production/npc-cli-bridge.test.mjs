import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNpcBridge,
  validateInvocation,
} from "../../infra/production/npc-cli-bridge.mjs";

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
