import { z } from "zod";

const DiceOutcome = z.object({
  success: z.boolean().optional(),
  roll: z.number().int(),
  setting: z.object({
    sides: z.number().int(),
    successThrough: z.number().int(),
    fumble: z.object({ through: z.number().int() }).optional(),
  }),
  text: z.string().optional(),
  repeated: z.boolean().optional(),
  fumble: z.object({ roll: z.number().int(), success: z.boolean() }).optional(),
});

export function playDiceMessages(outcome: unknown): string[] {
  if (!outcome || typeof outcome !== "object") return [];
  const { proposals, contests } = outcome as Record<string, unknown>;
  if (Array.isArray(proposals)) return proposals.flatMap(playDiceMessages);
  if (Array.isArray(contests))
    return contests.flatMap((contest, i) =>
      playDiceMessages({ ...contest, text: `対抗判定 ${i + 1}` }),
    );

  const { data } = DiceOutcome.safeParse(outcome);
  if (!data) return [];
  const { roll, setting, text, success, repeated, fumble } = data;
  const { sides, successThrough } = setting;
  const label = text ? `「${text}」の判定` : "判定";
  const replay = repeated ? "（前回の結果）" : "";
  const messages = [
    `${label}${replay} 出目 ${roll} / ${sides}、成功は ${successThrough} 以下（${(success ?? roll <= successThrough) ? "成功" : "失敗"}）`,
  ];
  if (fumble && setting.fumble)
    messages.push(
      `ファンブル判定 出目 ${fumble.roll} / ${sides}、ファンブルは ${setting.fumble.through} 以下（${fumble.success ? "ファンブル" : "ファンブルなし"}）`,
    );
  return messages;
}
