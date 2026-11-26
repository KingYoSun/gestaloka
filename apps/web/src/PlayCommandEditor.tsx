import { useState } from "react";
import { z } from "zod";
import {
  PlayerPlayCommand,
  WorldApplication,
  applicationSp,
  playQuote,
  type BelongingOp,
  type PlayQuote,
  type PlayerCharacter,
} from "@gestaloka/contracts";
import type { paths } from "@gestaloka/contracts/http";
import { $api } from "./api.js";
import { Button } from "./components/ui/button.js";
import { Textarea } from "./components/ui/textarea.js";
import { Notice, Problem } from "./presentation.js";
import { itemText, type PlayScreen } from "./play-panels.js";

const CommandObject = z.record(z.string(), z.unknown());
const Action = z.object({ message: z.string() });

type Command = z.infer<typeof PlayerPlayCommand>;

function parseCommand(draft: string, requestId: string): Command {
  const input = CommandObject.parse(JSON.parse(draft));
  const action = WorldApplication.safeParse(input.action);
  return PlayerPlayCommand.parse({
    ...input,
    ...(input.command === "apply" && action.success
      ? { expectedSp: applicationSp(action.data) }
      : {}),
    requestId,
  });
}

const chargeConditions: Record<PlayQuote["chargeWhen"], string> = {
  never: "",
  "new-roll": "新しい出目を保存したときに消費します。",
  "review-saved": "審査結果を保存したときに消費します。",
  "draw-saved": "抽選結果を保存したときに消費します。",
};

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
  worldId,
  actorId,
  disabled,
  selection,
  response,
  execute,
}: {
  worldId: string;
  actorId: string;
  disabled: boolean;
  selection: Selection | undefined;
  response: Record<string, unknown> | undefined;
  execute: (command: Command, expectedSp?: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [error, setError] = useState<Error>();
  const quote = $api.useMutation("post", "/api/worlds/{id}/session/quote");
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
  const holdings = selection?.screen.belongings;
  const capacity = holdings?.skillCapacity;
  const skills =
    holdings?.skills.flatMap((s) =>
      s.id ? [{ id: s.id, text: s.text }] : [],
    ) ?? [];
  const sources = skills.filter((skill) => sourceIds.includes(skill.id));
  let parsed: Command | undefined;
  try {
    parsed = parseCommand(draft, actorId);
  } catch {
    // 入力の途中は価格を表示しない。
  }
  const needsQuote =
    parsed?.command === "draw" || parsed?.command === "companion-request";
  const currentQuote =
    quote.variables?.params.path.id === worldId &&
    quote.variables.params.query?.actorId === actorId
      ? quote.data
      : undefined;
  const price = needsQuote ? currentQuote : parsed && playQuote(parsed);
  function update(text: string, operation: BelongingOp) {
    const action = WorldApplication.parse(
      operation.type === "learn"
        ? { type: "generate", plans: [{ text, operation }] }
        : { type: "direct", text, operations: [operation] },
    );
    execute(
      PlayerPlayCommand.parse({
        requestId: crypto.randomUUID(),
        command: "apply",
        action,
        expectedSp: applicationSp(action),
        dependencies: [],
      }),
    );
  }
  function edit(text: string) {
    setDraft(text);
    setError(undefined);
    quote.reset();
  }
  function example(kind: "locate" | "move") {
    const movingSelf = kind === "locate";
    edit(
      JSON.stringify(
        {
          command: "apply",
          action: {
            type: "direct",
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
          },
          expectedSp: 0,
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
      {capacity && (
        <details className="mt-3">
          <summary>
            技能を習得する（{capacity.usedSlots}/{capacity.limitSlots}枠）
          </summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const text = String(data.get("skill")).trim();
              const basis = String(data.get("basis")).trim();
              if (cannotAct || !text || !basis) return;
              update(basis, {
                type: "learn",
                person: actorId,
                text,
                basis,
                ...(sources.length
                  ? { consumeSkillIds: sources.map((s) => s.id) }
                  : {}),
              });
            }}
          >
            <fieldset disabled={cannotAct} className="mt-3 grid gap-3">
              <label>
                習得する技能と使える範囲
                <Textarea name="skill" required />
              </label>
              <label>
                どのように身につけるか
                <Textarea name="basis" required />
              </label>
              {skills.length > 0 && (
                <fieldset className="grid gap-1">
                  <legend>成功時に消費する技能（任意）</legend>
                  {skills.map((skill) => (
                    <label key={skill.id}>
                      <input
                        type="checkbox"
                        checked={sourceIds.includes(skill.id)}
                        onChange={(e) =>
                          setSourceIds(
                            e.target.checked
                              ? [...sourceIds, skill.id]
                              : sourceIds.filter((id) => id !== skill.id),
                          )
                        }
                      />{" "}
                      {skill.text}
                    </label>
                  ))}
                </fieldset>
              )}
              <p aria-live="polite">
                成功後の使用枠 {capacity.usedSlots + 1 - sources.length}/
                {capacity.limitSlots}
              </p>
              {capacity.usedSlots >= capacity.limitSlots && !sources.length && (
                <p>元技能を選ぶと、満枠でも発展・統合を申請できます。</p>
              )}
              <p className="muted">
                世界の技能基準で差し戻された場合も1 SPを消費します。
              </p>
              <Button
                type="submit"
                disabled={
                  capacity.usedSlots >= capacity.limitSlots && !sources.length
                }
              >
                習得を申請する（1 SP）
              </Button>
            </fieldset>
          </form>
        </details>
      )}
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
            if (disabled || quote.isPending || (needsQuote && !price)) return;
            try {
              const command = parseCommand(draft, crypto.randomUUID());
              setError(undefined);
              execute(
                command.command === "draw" && price?.versionId
                  ? { ...command, versionId: price.versionId }
                  : command,
                command.command !== "apply" && (needsQuote || price?.expectedSp)
                  ? price?.expectedSp
                  : undefined,
              );
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
          {quote.error && <Problem error={quote.error} />}
          {price && (
            <p aria-live="polite">
              {price.expectedSp ? "最大 " : ""}
              {price.expectedSp} SP。{chargeConditions[price.chargeWhen]}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            {needsQuote && parsed && (
              <Button
                type="button"
                variant="outline"
                disabled={disabled || quote.isPending}
                onClick={() =>
                  quote.mutate({
                    params: { path: { id: worldId }, query: { actorId } },
                    body: {
                      ...parsed,
                      requestId: crypto.randomUUID(),
                    } as paths["/api/worlds/{id}/session/quote"]["post"]["requestBody"]["content"]["application/json"],
                  })
                }
              >
                {quote.isPending ? "SPを確認中" : "SPを確認する"}
              </Button>
            )}
            <Button
              type="submit"
              disabled={
                disabled ||
                !draft.trim() ||
                quote.isPending ||
                (needsQuote && !price)
              }
            >
              コマンドを実行する
            </Button>
          </div>
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
