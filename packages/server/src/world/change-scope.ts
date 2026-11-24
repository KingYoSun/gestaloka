import { createHash } from "node:crypto";
import { canonical } from "../llm/prompt.js";

export function changeScope(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export function matchesChangeScope(scope: string, value: unknown) {
  return scope === changeScope(value);
}
