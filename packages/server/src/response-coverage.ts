import { z } from "zod";

/** Content delivered or a concrete refusal resolves a request; a promise does not. */
export const ResponsePart = z
  .object({
    requestPart: z.string().min(1),
    outcome: z.enum(["delivered", "declined", "pending"]),
    explanation: z.string().min(1),
  })
  .strict();
export function responseCoverage(
  parts: Pick<z.infer<typeof ResponsePart>, "outcome">[],
) {
  const resolved = parts.filter((p) => p.outcome !== "pending").length;
  return resolved === parts.length && parts.length > 0
    ? ("responsive" as const)
    : resolved
      ? ("partial" as const)
      : ("unresponsive" as const);
}
