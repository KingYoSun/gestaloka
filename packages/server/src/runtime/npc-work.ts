import { PlaySearch } from "@gestaloka/contracts";
import { z } from "zod";
import type { Dependency } from "../world/store.js";

// seek is an adjudicated action. It has no material to read back to a recipient.
const query = z.union(
  PlaySearch.options.filter((q) => q.shape.kind.value !== "seek"),
);
const message = z.string().trim().min(1);
const goal = message.nullable();
const mode = z.enum(["voice", "nonverbal"]);
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
  goal: string | null;
  action: object;
  endOnSuccess: boolean;
  inspect?: NpcTask;
  recipient?: string;
  reportReadId?: string;
};
const worldCommand = z.object({
  goal,
  endOnSuccess: z.boolean(),
  action: z.record(z.string(), z.unknown()),
});

// The same table supplies the model contract and the server decoder. All
// operations still go through the normal command schema and submission path.
export function npcOperations(
  peers: string[],
  receiving: boolean,
  pending?: NpcRead,
  completed?: NpcReport,
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
    if (peers.length)
      add(
        "inspect_and_reply",
        "引き受けた確認を実行する。知りたいこと、調べる対象と、結果を伝える相手のIDを選ぶ。",
        task.extend({ goal, recipient: z.enum(peers) }),
        (v) => ({
          goal: v.goal,
          inspect: task.parse(v),
          action: { command: "search", query: v.query },
          endOnSuccess: false,
        }),
      );
    if (pending)
      add(
        "report_and_pass",
        "読んで分かった具体的な結果を本人に伝え、この用事を終えて次の人へ渡す。",
        z.object({ goal, text: message, mode }),
        (v) => ({
          goal: v.goal,
          recipient: pending.recipient,
          reportReadId: pending.readId,
          action: { command: "say", text: v.text, mode: v.mode },
          endOnSuccess: true,
        }),
      );
    else
      add(
        "communicate",
        "手元の情報で返事をする、尋ねる、断る、または身振りで伝える。予告だけでは調べたことにならない。",
        z.object({ goal, text: message, mode, endOnSuccess: z.boolean() }),
        (v) => ({
          goal: v.goal,
          action: { command: "say", text: v.text, mode: v.mode },
          endOnSuccess: v.endOnSuccess,
        }),
      );
    if (completed && !pending) {
      add(
        "recheck_for_recipient",
        "新しい依頼・関連する変化があり、同じ相手のために前の対象を調べ直す。",
        z.object({ goal, reason: message }),
        (v) => ({
          goal: v.goal,
          inspect: task.parse(completed),
          action: { command: "search", query: completed.query },
          endOnSuccess: false,
        }),
      );
      add(
        "repeat_delivered_answer",
        "相手が前の答えを聞き直したとき、届けた答えをそのまま伝える。",
        z.object({ goal }),
        (v) => ({
          goal: v.goal,
          recipient: completed.recipient,
          action: {
            command: "say",
            text: completed.answer,
            mode: completed.mode,
          },
          endOnSuccess: true,
        }),
      );
    }
    add(
      "pass_turn",
      "応じることや自分から行うことがなければ、無言で手番を渡す。",
      z.object({ goal }),
      (v) => ({
        goal: v.goal,
        action: { command: "end-turn" },
        endOnSuccess: true,
      }),
    );
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
