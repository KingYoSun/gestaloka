import { expect, test } from "vitest";
import { PlayerReferences } from "../../packages/player-cli/src/references.js";

test("衝突時は新しい短縮IDだけを延ばし、元の参照と自由記述を保持する", () => {
  const refs = new PlayerReferences(":memory:");
  const ids = [
    "00000000-0000-4000-8000-000000000394",
    "00000000-0000-4000-8000-00000000226b",
  ];
  const payload = {
    sourceIds: ids,
    key: "relations:" + ids[0] + ":has:out",
    text: ids[1],
  };
  const compact = refs.convert(payload) as typeof payload;
  expect(compact.sourceIds[0]).toBe("@5c31f574");
  expect(compact.sourceIds[1]).toMatch(/^@5c31f574[0-9a-f]{2}$/);
  expect(compact.key).toBe("relations:@5c31f574:has:out");
  expect(compact.text).toBe(ids[1]);
  expect(refs.convert(compact, true)).toEqual(payload);
  expect(refs.convert(payload)).toEqual(compact);
});
