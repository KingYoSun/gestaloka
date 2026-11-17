import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { LlmClient } from "@gestaloka/server/llm";
import {
  canonical,
  compactJsonWhitespace,
} from "../../packages/server/src/llm/prompt.js";
import { JSON_WHITESPACE_ERROR } from "../../packages/server/src/llm/stream.js";
import { WorldBudget } from "../../packages/server/src/llm/world-budget.js";
import { isolatedDatabases } from "../support/isolated-db.js";
import { chatStream } from "../support/chat-stream.js";

const isolated = isolatedDatabases();
beforeAll(() => isolated.setup());
afterAll(() => isolated.close());
const expected = {
  type: "scene",
  text: '架空の会話  と "引用"\n選択はまだ確定していない。',
  choices: ["自分で確かめる", "後で相談する"],
};
const fixture = {
  expected,
  content: JSON.stringify({ response: expected }),
  schema: z.toJSONSchema(
    z
      .object({
        type: z.literal("scene"),
        text: z.string(),
        choices: z.array(z.string()),
      })
      .strict(),
  ),
};

test.each(["確定", "未受信", "不正", "不整合", "キャッシュ不整合"])(
  "空白中断の使用量%sを保存し、既存修復で意味を保ち再送しない",
  async (mode) => {
    const pool = isolated.databases.postgres,
      id = randomUUID(),
      responseId = randomUUID(),
      worldId = randomUUID(),
      env = {
        LLM_MODEL: "meta/muse-ember",
        OPENROUTER_API_KEY: "unused",
        LLM_BUDGET_ID: randomUUID(),
        LLM_BUDGET_USD: "1",
      },
      messages = [
        {
          role: "user" as const,
          content: JSON.stringify({ responseSchema: fixture.schema }),
        },
      ],
      broken = fixture.content.slice(0, -1) + " ".repeat(5000) + "}",
      requests: { body: Record<string, unknown>; signal: AbortSignal }[] = [];
    let source: ReturnType<typeof chatStream>;
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push({ body, signal: init!.signal! });
      source = chatStream(requests.length === 1 ? broken : fixture.content, {
        model: body.model,
        buffered: requests.length === 1 && mode !== "未受信",
        ...(requests.length === 1 && mode === "不正"
          ? { usage: { prompt_tokens: 30 } }
          : {}),
        ...(requests.length === 1 && mode === "不整合"
          ? {
              usage: {
                prompt_tokens: 30,
                completion_tokens: 20,
                total_tokens: 49,
              },
            }
          : {}),
        ...(requests.length === 1 && mode === "キャッシュ不整合"
          ? {
              usage: {
                prompt_tokens: 30,
                completion_tokens: 20,
                total_tokens: 50,
                prompt_tokens_details: { cached_tokens: 31 },
              },
            }
          : {}),
        reasoning: "保存しない推論",
      });
      return source.response;
    });
    const client = new LlmClient(pool, env, transport);
    await client.ledger.setup();
    await WorldBudget.create(pool, worldId, 1);
    const result = await client.run(
      responseId,
      () => client.complete(id, "scene-resolve", messages),
      worldId,
    );
    expect(JSON.parse(result.content)).toEqual(fixture.expected);
    expect(requests).toHaveLength(2);
    expect(requests[0]!.body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      reasoning: { exclude: true },
      response_format: { type: "json_schema" },
    });
    expect(requests[0]!.signal.aborted).toBe(true);
    const saved = (
      await pool.query(
        "SELECT state,delivery,charged_nano,reserved_nano,request,response FROM llm_call WHERE id=$1",
        [id],
      )
    ).rows[0];
    const body =
      mode === "確定" ? saved.response.content : saved.response.diagnostic.body;
    expect(body.startsWith(fixture.content.slice(0, -1))).toBe(true);
    expect(JSON.stringify(saved.response)).not.toContain("保存しない推論");
    if (mode === "確定") {
      expect(saved.state).toBe("complete");
      expect(Number(saved.charged_nano)).toBe(12040);
      expect(saved.response).toMatchObject({
        finishReason: "json_whitespace",
        formatError: JSON_WHITESPACE_ERROR,
        usage: { completion_tokens: 20, reasoning_tokens: 5 },
      });
    } else {
      expect(saved.state).toBe("pending");
      expect(saved.delivery).toBe("unknown");
      expect(saved.charged_nano).toBeNull();
      expect(saved.response.diagnostic).toMatchObject({
        type: "format",
        missingBody: false,
      });
      expect(saved.response.error).toBe(JSON_WHITESPACE_ERROR);
    }
    const repairMessages = requests[1]!.body.messages as {
      role: string;
      content: string;
    }[];
    expect(JSON.parse(repairMessages.at(-1)!.content).validationErrors).toBe(
      JSON_WHITESPACE_ERROR,
    );
    expect(repairMessages.find((m) => m.role === "assistant")!.content).toBe(
      compactJsonWhitespace(body),
    );
    expect(await client.ledger.hasPendingOperation(responseId)).toBe(false);
    const expectedBudget =
      mode === "確定" ? 24080 : Number(saved.reserved_nano) + 12040;
    expect(
      Number(
        (
          await pool.query("SELECT used_nano FROM llm_budget WHERE id=$1", [
            env.LLM_BUDGET_ID,
          ])
        ).rows[0].used_nano,
      ),
    ).toBe(expectedBudget);
    expect(
      Number(
        (
          await pool.query(
            "SELECT used_nano FROM world_budget WHERE world_id=$1",
            [worldId],
          )
        ).rows[0].used_nano,
      ),
    ).toBe(expectedBudget);
    // A repair persisted before streaming was enabled retains its exact wire request.
    const repair = (
      await pool.query(
        "SELECT id,request FROM llm_call WHERE response_id=$1 AND id<>$2",
        [responseId, id],
      )
    ).rows[0];
    repair.request.request.stream = false;
    delete repair.request.request.stream_options;
    const hash = createHash("sha256")
      .update(canonical(repair.request))
      .digest("hex");
    await pool.query("UPDATE llm_call SET request=$2,hash=$3 WHERE id=$1", [
      repair.id,
      repair.request,
      hash,
    ]);
    const restarted = new LlmClient(pool, env, transport);
    const resumed = await restarted.run(
      responseId,
      () => restarted.complete(id, "scene-resolve", messages),
      worldId,
    );
    expect(resumed.content).toBe(result.content);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(
      Number(
        (
          await pool.query("SELECT used_nano FROM llm_budget WHERE id=$1", [
            env.LLM_BUDGET_ID,
          ])
        ).rows[0].used_nano,
      ),
    ).toBe(expectedBudget);
    expect(
      (
        await pool.query("SELECT request FROM llm_call WHERE id=$1", [
          repair.id,
        ])
      ).rows[0].request,
    ).toEqual(repair.request);
  },
);
