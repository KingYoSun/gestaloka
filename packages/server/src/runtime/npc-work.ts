import { applicationSp, PlaySearch } from "@gestaloka/contracts";
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
    advertised: z.ZodType = parameters,
  ) {
    operations.set(name, {
      description,
      parameters: advertised,
      decode: (value) => decode(parameters.parse(value)),
    });
  }
  if (!receiving) {
    if (completed && !pending && recheck)
      add(
        "recheck_for_recipient",
        recheck === "changed"
          ? "前回の報告からの変化が、元の問いへの答えや相手の今の判断に関わるときに、内容を調べる。"
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
    if (pending) {
      const text = message.describe(
        "相手に実際に伝える本人の言葉または身振り。根拠で分かったこと、確認の限界、必要なら自分の提案を、場面と人物の口調に合わせて伝える。",
      );
      const report = z.object({
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
      });
      add(
        "report_and_pass",
        "確認結果を本人の言葉で相手に伝えて、手番を渡す。",
        report.extend({ text: text.optional() }),
        (v) => {
          // Saved model responses from before the public text field can be replayed.
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
              text:
                v.text ??
                (judgment
                  ? `${finding}\n私の見立てでは、${judgment}`
                  : finding),
              mode: v.mode,
            },
            endOnSuccess: true,
          };
        },
        report.extend({ text }),
      );
    } else
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
    if (peers.length)
      add(
        "oppose_person",
        "同席者が抵抗し得る行為を試み、結果を判定にかける。成立した場合に相手に起こる状態を指定する。",
        z.object({
          ...goalChoice,
          completesGoal,
          endOnSuccess: z.boolean(),
          targetId: z.enum(peers),
          text: message.describe(
            "自分が試みる行為。相手の反応や判定は決めない。",
          ),
          description: message.describe("成功した場合に相手に生じる状態。"),
          replacesStateId: z.uuid().optional(),
        }),
        ({ targetId, text, description, replacesStateId, ...choice }) => {
          const action = {
            type: "oppose" as const,
            targetId,
            text,
            description,
            replacesStateId,
          };
          return {
            ...choice,
            action: {
              command: "apply",
              action,
              expectedSp: applicationSp(action),
              dependencies: [],
            },
          };
        },
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

// Compare only material that was visible to the NPC at each read.
export function visibleMaterialChanges(
  before: Record<string, unknown>,
  material: unknown,
): { field: string; before: unknown; after: unknown }[] {
  const after = material as Record<string, unknown>;
  if (!after || typeof after !== "object" || Array.isArray(after))
    return [{ field: "material", before, after: material }];
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...fields].flatMap((field) => {
    const old = before[field];
    const current = after[field];
    if (canonical(old) === canonical(current)) return [];
    if (Array.isArray(old) && Array.isArray(current)) {
      const oldKeys = new Set(old.map(canonical));
      const currentKeys = new Set(current.map(canonical));
      const removed = old.filter((item) => !currentKeys.has(canonical(item)));
      const added = current.filter((item) => !oldKeys.has(canonical(item)));
      return removed.length || added.length
        ? [{ field, before: removed, after: added }]
        : [];
    }
    return [{ field, before: old, after: current }];
  });
}
