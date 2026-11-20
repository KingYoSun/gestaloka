import { useState } from "react";
import { z } from "zod";
import {
  PlayCommand,
  type BelongingOp,
  type PlayerCharacter,
} from "@gestaloka/contracts";
import { Button } from "./components/ui/button.js";
import { Textarea } from "./components/ui/textarea.js";
import { Notice, Problem } from "./presentation.js";
import { itemText, type PlayScreen } from "./play-panels.js";

const CommandObject = z.record(z.string(), z.unknown());
const Action = z.object({ message: z.string() });

type Choice = { id: string; label: string };
type Selection = {
  screen: z.infer<typeof PlayScreen>;
  characters: z.infer<typeof PlayerCharacter>[];
  canAct: boolean;
};

function TargetSelect({
  name,
  label,
  choices,
}: {
  name: string;
  label: string;
  choices: Choice[];
}) {
  return (
    <label className="grid min-w-0 flex-1 gap-1">
      {label}
      <select name={name} defaultValue="" required>
        <option value="">選択してください</option>
        {choices.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PlayCommandEditor({
  actorId,
  disabled,
  selection,
  response,
  execute,
}: {
  actorId: string;
  disabled: boolean;
  selection: Selection | undefined;
  response: Record<string, unknown> | undefined;
  execute: (command: z.infer<typeof PlayCommand>) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<Error>();
  const action = Action.safeParse(response?.action);
  const places = selection?.screen.neighbors ?? [];
  const items =
    selection?.screen.belongings?.items.flatMap((item) =>
      item.id ? [{ id: item.id, label: itemText(item) }] : [],
    ) ?? [];
  const recipientIds = new Set(
    selection?.screen.people
      .filter((person) => person.canReceive)
      .map((person) => person.actorId),
  );
  const recipients = (selection?.characters ?? [])
    .filter(({ actorId }) => recipientIds.has(actorId))
    .map(({ actorId, name }) => ({ id: actorId, label: name }));
  const cannotAct = disabled || !selection?.canAct;
  function update(text: string, operation: BelongingOp) {
    execute(
      PlayCommand.parse({
        requestId: crypto.randomUUID(),
        command: "update",
        text,
        operations: [operation],
        dependencies: [],
      }),
    );
  }
  function edit(text: string) {
    setDraft(text);
    setError(undefined);
  }
  function example(kind: "locate" | "move") {
    const movingSelf = kind === "locate";
    edit(
      JSON.stringify(
        {
          command: "update",
          text: movingSelf ? "指定した場所へ移動する" : "物品を預ける",
          operations: [
            movingSelf
              ? {
                  type: "locate",
                  subjectId: actorId,
                  text: "移動先の説明",
                  aboutIds: ["移動先のUUID"],
                }
              : {
                  type: "move",
                  item: "物品のUUID",
                  from: actorId,
                  to: "預け先のUUID",
                  basis: "保管先に預ける",
                },
          ],
          dependencies: [],
        },
        null,
        2,
      ),
    );
  }

  return (
    <details className="rounded-lg border bg-secondary p-4">
      <summary>プレイコマンド</summary>
      {places.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const target = new FormData(form).get("place");
            const place = places.find(({ id }) => id === target);
            if (cannotAct || !place) return;
            update(`${place.label}へ移動する`, {
              type: "locate",
              subjectId: actorId,
              text: place.label,
              aboutIds: [place.id],
              directPlaceId: place.id,
            });
            form.reset();
          }}
        >
          <fieldset
            className="mt-3 flex min-w-0 flex-wrap items-end gap-3"
            disabled={cannotAct}
          >
            <TargetSelect name="place" label="移動先" choices={places} />
            <Button type="submit">移動する</Button>
          </fieldset>
        </form>
      )}
      {items.length > 0 && recipients.length > 0 && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const item = items.find(({ id }) => id === data.get("item"));
            const recipient = recipients.find(
              ({ id }) => id === data.get("recipient"),
            );
            if (cannotAct || !item || !recipient) return;
            update(`${item.label}を${recipient.label}に手渡す`, {
              type: "move",
              item: item.id,
              from: actorId,
              to: recipient.id,
              basis: "手渡し",
            });
            form.reset();
          }}
        >
          <fieldset
            className="mt-3 flex min-w-0 flex-wrap items-end gap-3"
            disabled={cannotAct}
          >
            <TargetSelect name="item" label="手渡す物品" choices={items} />
            <TargetSelect
              name="recipient"
              label="渡す相手"
              choices={recipients}
            />
            <Button type="submit">手渡す</Button>
          </fieldset>
        </form>
      )}
      <details className="mt-3">
        <summary>JSONでコマンドを実行</summary>
        <form
          className="mt-3 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            try {
              const command = PlayCommand.parse({
                ...CommandObject.parse(JSON.parse(draft)),
                requestId: crypto.randomUUID(),
              });
              setError(undefined);
              execute(command);
            } catch (error) {
              setError(
                error instanceof z.ZodError
                  ? new Error(z.prettifyError(error))
                  : new Error("JSONの構文を確認してください。"),
              );
            }
          }}
        >
          <p className="muted">
            CLIの <code>play --file</code> と同じJSONを入力できます。
            「周囲を見る」や「自分の情報」で調べた対象のUUIDと依存版は、直近の応答データで確認できます。
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => example("locate")}
            >
              移動の入力例
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => example("move")}
            >
              物品操作の入力例
            </Button>
          </div>
          <label>
            コマンドのJSON
            <Textarea
              className="max-h-80 font-mono"
              value={draft}
              onChange={(event) => edit(event.target.value)}
              spellCheck={false}
              aria-invalid={!!error}
            />
          </label>
          {error && <Problem error={error} />}
          <Button type="submit" disabled={disabled || !draft.trim()}>
            コマンドを実行する
          </Button>
        </form>
      </details>
      {action.success && <Notice>{action.data.message}</Notice>}
      {response && (
        <details className="mt-3">
          <summary>直近の応答データ</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all">
            {JSON.stringify(
              Object.fromEntries(
                Object.entries(response).filter(
                  ([key]) => key !== "characters",
                ),
              ),
              null,
              2,
            )}
          </pre>
        </details>
      )}
    </details>
  );
}
