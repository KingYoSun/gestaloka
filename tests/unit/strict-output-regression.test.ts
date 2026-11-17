import { expect, test } from "vitest";
import { z } from "zod";
import {
  strictOutput,
  outputSchema,
} from "../../packages/server/src/llm/prompt.js";
import { Query } from "../../packages/server/src/runtime/agent.js";
import { SceneRecordQuery } from "../../packages/server/src/runtime/scene-records.js";

// Hand-authored protocol examples. Do not use captured production responses.
test.each([undefined, 0, 12])("入れ子の照会で任意の時点%jを復元する", (at) => {
  const schema = outputSchema(
    z.toJSONSchema(
      z
        .object({
          type: z.literal("query"),
          requests: z.array(z.union([Query, SceneRecordQuery])),
        })
        .strict(),
      { io: "input" },
    ),
  );
  const wire = {
    response: {
      type: "query",
      requests: [
        {
          kind: "node",
          id: "73000000-0000-4000-8000-000000000001",
          at: at === undefined ? null : { value: at },
        },
      ],
    },
  };
  const before = JSON.stringify(wire);
  const decoded = strictOutput(schema).decode(wire);
  expect(decoded).toEqual({
    type: "query",
    requests: [
      {
        kind: "node",
        id: "73000000-0000-4000-8000-000000000001",
        ...(at === undefined ? {} : { at }),
      },
    ],
  });
  expect(JSON.stringify(wire)).toBe(before);
});

test.each([undefined, false])(
  "任意constの未指定と明示値%jを区別する",
  (concluded) => {
    const schema = outputSchema(
      z.toJSONSchema(
        z.union([
          z
            .object({
              type: z.literal("scene"),
              concluded: z.literal(false).optional(),
              text: z.string(),
            })
            .strict(),
          z.object({ type: z.literal("query"), text: z.string() }).strict(),
        ]),
        { io: "input" },
      ),
    );
    const text = "架空の資料  の確認\n次の行";
    const wire = {
      response: {
        type: "scene",
        concluded: concluded === undefined ? null : { value: false },
        text,
      },
    };
    expect(strictOutput(schema).decode(wire)).toEqual({
      type: "scene",
      text,
      ...(concluded === undefined ? {} : { concluded: false }),
    });
  },
);
