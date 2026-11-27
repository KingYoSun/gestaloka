import { z } from "zod";

const DiceOutcome = z.object({
  success: z.boolean().optional(),
  roll: z.number().int(),
  setting: z.object({
    count: z.number().int().positive().optional(),
    sides: z.number().int(),
    successThrough: z.number().int(),
    fumble: z.object({ through: z.number().int() }).optional(),
  }),
  text: z.string().optional(),
  opponentId: z.string().optional(),
  repeated: z.boolean().optional(),
  fumble: z.object({ roll: z.number().int(), success: z.boolean() }).optional(),
});

export function playedDice(
  outcome: unknown,
  text = "",
): z.infer<typeof DiceOutcome>[] {
  if (!outcome || typeof outcome !== "object") return [];
  const { proposals, contests } = outcome as Record<string, unknown>;
  if (Array.isArray(proposals)) return proposals.flatMap((p) => playedDice(p));
  if (Array.isArray(contests))
    return contests.flatMap((contest, i) =>
      playedDice(contest, `対抗判定 ${i + 1}`),
    );
  const { data } = DiceOutcome.safeParse(outcome);
  return data ? [{ ...data, text: data.text ?? text }] : [];
}

export function playDiceMessages(outcome: unknown): string[] {
  return playedDice(outcome).flatMap((data) => {
    const { roll, setting, text, success, repeated, fumble } = data;
    const { sides, successThrough } = setting;
    const scale =
      setting.count === undefined
        ? ` / ${sides}`
        : `（${setting.count}d${sides}）`;
    const label = text ? `「${text}」の判定` : "判定";
    const replay = repeated ? "（前回の結果）" : "";
    const messages = [
      `${label}${replay} 出目 ${roll}${scale}、成功は ${successThrough} 以下（${(success ?? roll <= successThrough) ? "成功" : "失敗"}）`,
    ];
    if (fumble && setting.fumble)
      messages.push(
        `ファンブル判定 出目 ${fumble.roll}${scale}、ファンブルは ${setting.fumble.through} 以下（${fumble.success ? "ファンブル" : "ファンブルなし"}）`,
      );
    return messages;
  });
}
