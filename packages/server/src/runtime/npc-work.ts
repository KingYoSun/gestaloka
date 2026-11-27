import { PlaySearch } from "@gestaloka/contracts";
import { z } from "zod";
import { canonical } from "../llm/prompt.js";
import type { Dependency } from "../world/store.js";

// seek is an adjudicated action. It has no material to read back to a recipient.
const query = z.union(
  PlaySearch.options.filter((q) => q.shape.kind.value !== "seek"),
);
const message = z.string().trim().min(1);
const goalChoice = {
  goal: message.nullable(),
  goalTurns: z.int().positive().optional(),
};
const mode = z.enum(["voice", "nonverbal"]);
const completesGoal = z
  .boolean()
  .describe("この操作が成功すれば現在の目的を達成する場合はtrue。")
  .optional();
const task = z.object({ question: message, recipient: z.uuid(), query });
export type NpcTask = z.infer<typeof task>;
export type NpcRead = NpcTask & {
  readId: string;
  dependencies: Dependency[];
  materialHash: string;
};
export type NpcReport = NpcRead & {
  answer: string;
  mode: z.infer<typeof mode>;
  recordId: string;
};
type Decision = {
  goal: z.infer<typeof goalChoice.goal>;
  goalTurns?: number | undefined;
  action: object;
  endOnSuccess: boolean;
  completesGoal?: boolean | undefined;
  inspect?: NpcTask;
  recipient?: string;
  reportReadId?: string;
};
const pass = (choice: Pick<Decision, "goal" | "goalTurns">): Decision => ({
  goal: choice.goal,
  goalTurns: choice.goalTurns,
  action: { command: "end-turn" },
  endOnSuccess: true,
});
const worldCommand = z.object({
  ...goalChoice,
  endOnSuccess: z.boolean(),
  completesGoal,
  action: z.record(z.string(), z.unknown()),
});

// The same table supplies the model contract and the server decoder. All
// operations still go through the normal command schema and submission path.
export function npcOperations(
  peers: string[],
  receiving: boolean,
  pending?: NpcRead,
  completed?: NpcReport,
  recheck?: "changed" | "requested",
  records: string[] = [],
) {
  const operations = new Map<
    string,
    {
      description: string;
      parameters: z.ZodType;
      decode: (args: unknown) => Decision;
    }
  >();
  function add<T extends z.ZodType>(
    name: string,
    description: string,
    parameters: T,
    decode: (args: z.output<T>) => Decision,
  ) {
    operations.set(name, {
      description,
      parameters,
      decode: (value) => decode(parameters.parse(value)),
    });
  }
  if (!receiving) {
    if (completed && !pending && recheck)
      add(
        "recheck_for_recipient",
        recheck === "changed"
          ? "報告後に確認対象が変わったので、同じ相手のために最新の結果を調べる。"
          : "届いた再依頼を引き受け、同じ相手のために最新の結果を調べる。",
        z.object({ ...goalChoice, question: message.optional() }),
        (v) => ({
          goal: v.goal,
          goalTurns: v.goalTurns,
          inspect: task.parse({
            ...completed,
            question: v.question ?? completed.question,
          }),
          action: { command: "search", query: completed.query },
          endOnSuccess: false,
        }),
      );
    const offerInspection = () => {
      if (pending || !peers.length) return;
      add(
        "inspect_and_reply",
        completed
          ? "新しい相手か、前の報告とは別の素材を調べる。"
          : "引き受けた確認を実行する。知りたいこと、調べる対象と、結果を伝える相手のIDを選ぶ。",
        task.extend({ ...goalChoice, recipient: z.enum(peers) }),
        (v) =>
          completed?.recipient === v.recipient &&
          canonical(completed.query) === canonical(v.query)
            ? pass(v)
            : {
                goal: v.goal,
                goalTurns: v.goalTurns,
                inspect: task.parse(v),
                action: { command: "search", query: v.query },
                endOnSuccess: false,
              },
      );
    };
    if (!completed) offerInspection();
    if (pending)
      add(
        "report_and_pass",
        "今回の確認結果と、必要なら自分の見立てを本人に伝えて、手番を渡す。",
        z.object({
          ...goalChoice,
          completesGoal: completesGoal.describe(
            "現在の目的で求めた結果がこの報告の内容に含まれ、届けば目的を達成する場合はtrue。目的で求めた情報が見つからず、その旨を報告するだけならfalse。",
          ),
          finding: records.length
            ? z
                .array(z.number().int().min(1).max(records.length))
                .describe(
                  "答えの根拠として伝えるreportRecordsの番号。該当する記録がなければ空配列。",
                )
            : message.describe(
                "今回読めた資料が直接示すことと、確かめられた範囲。",
              ),
          judgment: z
            .object({
              condition: message
                .nullable()
                .describe(
                  "提案に関わる未確認の条件を、仮定や確認事項として一文で伝える。条件なしで勧められる一手ならnull。",
                ),
              proposal: message.describe(
                "この結果を受けて、自分なら取る一手。資料にない事実や可否を断定せず、提案として書く。",
              ),
            })
            .nullable()
            .describe("自分の見立て。付け加える提案がなければnull。"),
          mode,
        }),
        (v) => {
          const finding =
            typeof v.finding === "string"
              ? v.finding
              : v.finding.length
                ? `記録には${[...new Set(v.finding)].map((index) => `「${records[index - 1]}」`).join("、")}とあります。`
                : "今回読んだ記録では答えを確認できませんでした。";
          const judgment = v.judgment
            ? [v.judgment.condition, v.judgment.proposal]
                .filter(Boolean)
                .join("\n")
            : undefined;
          return {
            goal: v.goal,
            goalTurns: v.goalTurns,
            completesGoal: v.completesGoal,
            recipient: pending.recipient,
            reportReadId: pending.readId,
            action: {
              command: "say",
              text: judgment
                ? `${finding}\n私の見立てでは、${judgment}`
                : finding,
              mode: v.mode,
            },
            endOnSuccess: true,
          };
        },
      );
    else
      add(
        "communicate",
        "手元の情報で返事をする、尋ねる、断る、または身振りで伝える。予告だけでは調べたことにならない。",
        z.object({
          ...goalChoice,
          text: message,
          mode,
          endOnSuccess: z.boolean(),
          completesGoal,
        }),
        (v) => ({
          goal: v.goal,
          goalTurns: v.goalTurns,
          completesGoal: v.completesGoal,
          action: { command: "say", text: v.text, mode: v.mode },
          endOnSuccess: v.endOnSuccess,
        }),
      );
    add(
      "pass_turn",
      "応じることや自分から行うことがなければ、無言で手番を渡す。",
      z.object(goalChoice),
      pass,
    );
    if (completed) offerInspection();
  }
  add(
    "world_command",
    "commandSchemaの任意の操作を選ぶ。actionがそのコマンドで、requestIdはサーバーが設定する。",
    worldCommand,
    (v) => v,
  );
  return {
    availableOperations: Array.from(operations, ([name, op]) => ({
      name,
      description: op.description,
      parameters: z.toJSONSchema(op.parameters),
    })),
    read(value: unknown): Decision | undefined {
      if (!value || typeof value !== "object" || "command" in value)
        return undefined;
      if (!("operation" in value)) return worldCommand.parse(value); // saved pre-operation plans
      const op = operations.get(z.string().parse(value.operation));
      if (!op) throw new Error("この手番で選べる操作を指定してください");
      return op.decode("args" in value ? value.args : value);
    },
  };
}
