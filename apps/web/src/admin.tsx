import { useEffect, useRef, useState } from "react";
import { InspectionResults } from "./inspection.js";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Operation, CostReport } from "@gestaloka/contracts";
import { pendingKey } from "./api.js";
import { operate } from "./operations-client.js";
import { Notice, Problem } from "./presentation.js";
import { Button } from "./components/ui/button.js";
import { Textarea } from "./components/ui/textarea.js";
import {
  Fields,
  formShape,
  initial,
  label,
  object,
  secretField,
  type Values,
} from "./admin-fields.js";
import {
  catalog,
  guidance,
  operations,
  readOnly,
  schemas,
  editAfterRead,
  type Command,
  type Name,
  type Section,
} from "./admin-catalog.js";

const money = (v: unknown) =>
  `${(Number(v) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 })} USD`;
const states: Record<string, string> = {
  unreceived: "未受付",
  pending: "受付を確認中",
  accepted: "受付済み",
  waiting: "待機中",
  queued: "待機中",
  prepared: "受付済み（実行前）",
  running: "処理中",
  active: "処理中",
  paused: "保留",
  generating: "初期世界を生成中",
  joining: "参加する人物を生成中",
  play_paused: "行動を保留",
  preparing: "背景情報を準備中",
  acting: "応答生成中",
  reflecting: "世界への影響を確定中",
  ended: "完了",
  failed: "失敗",
  complete: "完了",
  completed: "完了",
  finished: "完了",
  ready: "判断待ち",
  cancelled: "取消済み",
  denied: "拒否",
  replayed: "同じ要求の受付を再確認",
};
const mask = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(mask)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(object(v)).map(([k, v]) => [
            k,
            secretField(k) ? "入力済み（非表示）" : mask(v),
          ]),
        )
      : v;

function Expanded({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>詳細を表示</summary>
      {open && <Data value={value} />}
    </details>
  );
}
function Data({
  value,
  onUse,
}: {
  value: unknown;
  onUse?: (v: Values) => void;
}) {
  if (Array.isArray(value))
    return (
      <div className="admin-records">
        {value.length ? (
          value.map((v, i) => (
            <article className="admin-record" key={String(object(v).id ?? i)}>
              <Data value={v} />
              {onUse && (
                <Button variant="outline" onClick={() => onUse(object(v))}>
                  この記録を入力に使う
                </Button>
              )}
            </article>
          ))
        ) : (
          <p>該当する記録はありません。</p>
        )}
      </div>
    );
  if (value === null || value === undefined)
    return <span className="muted">未設定・未記録</span>;
  if (typeof value !== "object")
    return (
      <span className="plain-text">
        {typeof value === "boolean"
          ? value
            ? "はい"
            : "いいえ"
          : String(value)}
      </span>
    );
  return (
    <dl className="admin-data">
      {Object.entries(object(value))
        .filter(([k]) => k !== "next")
        .map(([k, v]) => (
          <div key={k}>
            <dt>{label(k)}</dt>
            <dd>
              {k.endsWith("NanoUsd") && v !== null ? (
                money(v)
              ) : k === "state" || k === "outcome" ? (
                (states[String(v)] ?? String(v ?? "未記録"))
              ) : k.endsWith("At") && typeof v === "string" ? (
                new Date(v).toLocaleString()
              ) : v !== null && typeof v === "object" ? (
                <Expanded value={v} />
              ) : (
                <Data value={v} />
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}
function Costs({ value }: { value: unknown }) {
  const report = CostReport.parse(value);
  return (
    <>
      <h2>費用の計算額</h2>
      {report.totals && <Data value={report.totals} />}
      {report.timeline && (
        <div className="admin-table">
          <table>
            <caption>時系列の計算額</caption>
            <thead>
              <tr>
                <th>日時</th>
                <th>call数</th>
                <th>計算済み</th>
                <th>未確定予約</th>
                <th>使用量不明</th>
              </tr>
            </thead>
            <tbody>
              {report.timeline.map((v) => (
                <tr key={v.at}>
                  <td>{new Date(v.at).toLocaleString()}</td>
                  <td>{v.calls}</td>
                  <td>{money(v.calculatedNanoUsd)}</td>
                  <td>{money(v.reservedNanoUsd)}</td>
                  <td>{money(v.unknownNanoUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report.calls && (
        <div className="admin-records">
          {report.calls.map((v) => (
            <article className="admin-record" key={v.id}>
              <h3>{v.requestedModel ?? "モデル未記録"}</h3>
              <p>
                {new Date(v.createdAt).toLocaleString()} ·{" "}
                {v.status === "calculated"
                  ? "計算済み"
                  : v.status === "reserved"
                    ? "送信済み・未確定"
                    : "使用量不明"}
              </p>
              <p>
                {v.calculatedNanoUsd === null
                  ? "計算額未確定"
                  : money(v.calculatedNanoUsd)}
              </p>
              <p>
                入力 {v.usage?.input ?? "未記録"} / 出力{" "}
                {v.usage?.output ?? "未記録"} / キャッシュ読取{" "}
                {v.usage?.cachedInput ?? "未記録"} トークン
              </p>
              <Expanded value={v} />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function Results({
  data,
  onUse,
}: {
  data: Values;
  onUse?: ((v: Values) => void) | undefined;
}) {
  return (
    <section aria-label="取得結果" className="admin-results">
      <div className="action-footer">
        <h2>取得結果</h2>
        <Button
          variant="outline"
          onClick={() =>
            void navigator.clipboard.writeText(JSON.stringify(data, null, 2))
          }
        >
          結果をコピー
        </Button>
      </div>
      {data.kind === "inspection-history" ||
      (data.manifest && data.measurement) ? (
        <InspectionResults value={data} onUse={onUse} />
      ) : data.basis === "calculated" ? (
        <Costs value={data} />
      ) : (
        <>
          {Array.isArray(data.items) ? (
            <>
              <Data
                value={Object.fromEntries(
                  Object.entries(data).filter(
                    ([k]) => !["items", "next"].includes(k),
                  ),
                )}
              />
              <Data value={data.items} {...(onUse ? { onUse } : {})} />
            </>
          ) : (
            <>
              <Data value={data.job ?? data} />
              {onUse && (
                <Button
                  variant="outline"
                  onClick={() => onUse(object(data.job ?? data))}
                >
                  この設定を入力に使う
                </Button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
type Journal = { id: string; command?: Command | undefined };
function saved(key: string): Journal | null {
  try {
    const value = z
      .object({ id: z.uuid(), command: Operation.optional() })
      .parse(JSON.parse(localStorage.getItem(key) ?? "null"));
    return value;
  } catch {
    return null;
  }
}
function defaults(name: Name, seed: Values) {
  const value = object(initial(formShape(schemas[name])));
  for (const key of Object.keys(schemas[name].shape))
    if (key !== "operation" && key in seed) value[key] = seed[key];
  if ("expectedVersion" in value) value.expectedVersion = seed.version ?? 0;
  for (const key of ["userId", "inviteId", "clientId", "grantId", "presetId"])
    if (key in value && seed.id) value[key] = seed.id;
  if (name === "mcp.clients.put" && !seed.id)
    value.clientId = crypto.randomUUID();
  if (name === "presets.put" && !seed.id) value.presetId = crypto.randomUUID();
  if (["worlds.read", "worlds.configure"].includes(name) && seed.id)
    value.worldId = seed.id;
  if (name === "worlds.configure" && seed.publication)
    Object.assign(value, object(seed.publication));
  if (name === "backups.restore" && seed.id) value.snapshot = seed.id;
  if (name === "settings.invites" && "inviteRequired" in seed)
    value.enabled = seed.inviteRequired;
  if (name === "worldBudgets.put" && seed.limitUsd !== undefined)
    value.budgetUsd = seed.limitUsd;
  if (name === "monitorWebhook.put")
    value.expectedVersion = seed.webhookVersion ?? 0;
  if (name === "worlds.edit") {
    value.at = seed.at ?? 0;
    value.dependencies = seed.dependencies ?? [];
  }
  if (name === "costs.read" || name === "inspection.history") {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    value.query = {
      ...object(value.query),
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }
  if (name === "worlds.graph") value.query = { kind: "nodes" };
  return value;
}
function nextCommand(command: Command, next: unknown): Command {
  const value = structuredClone(command) as Values;
  const cursor = next === null ? undefined : next;
  const parent = "query" in value ? object(value.query) : value;
  const key =
    command.operation === "costs.read" ||
    command.operation === "worlds.graph" ||
    command.operation === "inspection.read" ||
    command.operation === "inspection.history"
      ? "after"
      : "before";
  if (cursor === undefined) delete parent[key];
  else parent[key] = cursor;
  return Operation.parse(value);
}
function OperationForm({
  name,
  seed,
  onUse,
}: {
  name: Name;
  seed: Values;
  onUse: (v: Values) => void;
}) {
  const client = useQueryClient(),
    key = pendingKey("operations", name),
    readonly = readOnly(name);
  const [journal, setJournal] = useState(() => (readonly ? null : saved(key)));
  const [value, setValue] = useState<Values>(
    () => journal?.command ?? defaults(name, seed),
  );
  const [review, setReview] = useState<Command>(),
    [result, setResult] = useState<Values>(),
    [error, setError] = useState<unknown>(),
    [sending, setSending] = useState(false);
  const composing = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [active, setActive] = useState<Command | null>(() => {
    const parsed = schemas[name].safeParse(value);
    return readonly && parsed.success ? parsed.data : null;
  });
  const query = useQuery({
    queryKey: ["admin-operation", active],
    gcTime: 0,
    enabled: active !== null,
    queryFn: ({ signal }) => operate(active!, undefined, signal),
    refetchInterval:
      active &&
      ["jobs.list", "jobs.read", "backups.jobs", "backups.job"].includes(name)
        ? 5000
        : false,
  });
  const receipt = useQuery({
    queryKey: ["admin-receipt", journal?.id],
    gcTime: 0,
    enabled: !!journal && !sending,
    queryFn: ({ signal }) =>
      operate(
        { operation: "requests.read", id: journal!.id },
        undefined,
        signal,
      ),
  });
  const data = readonly ? query.data : (result ?? object(receipt.data?.result));
  const completed =
    !!result || ["accepted", "failed"].includes(String(receipt.data?.state));
  const difference = name === "worlds.edit";
  const [diff, setDiff] = useState(() =>
    JSON.stringify(
      {
        at: value.at,
        dependencies: value.dependencies,
        changes: value.changes,
      },
      null,
      2,
    ),
  );
  async function send(command: Command) {
    const id = journal?.id ?? crypto.randomUUID();
    const entry: Journal = [
      "credentials.put",
      "backups.configure",
      "monitorWebhook.put",
    ].includes(name)
      ? { id }
      : { id, command };
    localStorage.setItem(key, JSON.stringify(entry));
    setJournal(entry);
    setSending(true);
    setError(undefined);
    try {
      const r = await operate(command, id);
      if (!alive.current) return;
      setResult(r);
      setReview(undefined);
      if (!entry.command) setValue(defaults(name, seed));
      void client.invalidateQueries({ queryKey: ["admin-operation"] });
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) {
        setSending(false);
        void client.invalidateQueries({ queryKey: ["admin-receipt", id] });
      }
    }
  }
  function submit() {
    try {
      const command = schemas[name].parse(
        difference
          ? {
              ...value,
              ...schemas["worlds.edit"]
                .pick({ at: true, dependencies: true, changes: true })
                .parse(JSON.parse(diff)),
            }
          : value,
      );
      setError(undefined);
      if (readonly) setActive(command);
      else setReview(command);
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? new Error(
              e.issues
                .map((v) => `${v.path.map(String).join(" / ")}: ${v.message}`)
                .join("\n"),
            )
          : e,
      );
    }
  }
  const shape = formShape(schemas[name]);
  if (difference && shape.properties)
    shape.properties = Object.fromEntries(
      Object.entries(shape.properties).filter(
        ([k]) => !["at", "dependencies", "changes"].includes(k),
      ),
    );
  return (
    <>
      <form
        className="form-panel"
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!composing.current) submit();
        }}
      >
        <h2>{catalog[name]}</h2>
        <p className="record-meta">{name}</p>
        <fieldset
          disabled={sending || !!review || completed || !!journal?.command}
        >
          <Fields
            shape={shape}
            value={value}
            onChange={(v) => setValue(object(v))}
          />
          {difference && (
            <>
              <label htmlFor="world-diff">LLMが作成したJSON差分</label>
              <p>
                at・dependencies・changesを含むJSONを貼り付けてください。対象の世界IDと理由は別に入力します。依存版・履歴・原子的な確定はMCPと同じ検証を通します。
              </p>
              <Textarea
                id="world-diff"
                rows={12}
                value={diff}
                onChange={(e) => setDiff(e.target.value)}
              />
            </>
          )}
        </fieldset>
        {!review && !completed && (
          <Button disabled={sending}>
            {readonly ? "取得する" : "内容を確認する"}
          </Button>
        )}
        {review && (
          <section aria-label="操作内容の確認">
            <h3>操作内容の確認</h3>
            <Data value={mask(review)} />
            <Button
              type="button"
              disabled={sending}
              onClick={() => void send(review)}
            >
              {sending ? "受付を確認しています" : "この内容で実行する"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => setReview(undefined)}
            >
              入力へ戻る
            </Button>
          </section>
        )}
        {(error || query.error || receipt.error) && (
          <Problem error={error ?? query.error ?? receipt.error} />
        )}
        {journal && (
          <div role="status">
            <p>
              要求ID: <code>{journal.id}</code>
            </p>
            <p>
              {sending
                ? "受付を確認しています"
                : result
                  ? "受付済み"
                  : receipt.data?.state === "pending" &&
                      receipt.data?.outcome === "denied"
                    ? "受付保留"
                    : (states[String(receipt.data?.state)] ?? "受付を確認中")}
            </p>
            {receipt.data?.code !== null &&
              receipt.data?.code !== undefined && (
                <Data value={{ code: receipt.data.code }} />
              )}
            {Boolean(receipt.data?.error) && (
              <Data value={receipt.data?.error} />
            )}
            {!completed && (
              <>
                <p>
                  同じ内容・要求IDで継続してください。秘密値はブラウザーへ保存していないため、再読み込みした場合は元の値を再入力してください。
                </p>
                {journal.command && !review && (
                  <Button
                    type="button"
                    disabled={sending}
                    onClick={() => void send(journal.command!)}
                  >
                    同じ要求で再送する
                  </Button>
                )}
              </>
            )}
            {completed && (
              <>
                <p>
                  非同期処理の受付は世界内の成功・完了を表しません。ジョブまたは取得・復元の進捗で確認してください。
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    localStorage.removeItem(key);
                    setJournal(null);
                    setResult(undefined);
                    setReview(undefined);
                    setError(undefined);
                    setValue(defaults(name, seed));
                  }}
                >
                  別の操作を始める
                </Button>
              </>
            )}
          </div>
        )}
      </form>
      {readonly && active && query.isPending && (
        <Notice>取得しています。</Notice>
      )}
      {data && Object.keys(data).length > 0 && (
        <Results
          data={data}
          {...(editAfterRead[name] || name === "inspection.history"
            ? {
                onUse: (v: Values) =>
                  onUse({
                    ...value,
                    ...object(data.world),
                    ...data,
                    ...v,
                    ...(name.startsWith("inspection.")
                      ? { operation: v.operation ?? editAfterRead[name] }
                      : {}),
                    ...(name === "inspection.select"
                      ? {
                          worldId: object(object(data.manifest).selection)
                            .worldId,
                          manifestId: object(data.manifest).id,
                        }
                      : {}),
                  }),
              }
            : {})}
        />
      )}
      {readonly && active && query.data && (
        <div className="action-footer">
          <Button
            variant="outline"
            onClick={() => {
              const c = nextCommand(active, null);
              setActive(c);
              setValue(c);
            }}
          >
            先頭を取得
          </Button>
          {query.data.next !== null && query.data.next !== undefined && (
            <Button
              onClick={() => {
                const c = nextCommand(active, query.data!.next);
                setActive(c);
                setValue(c);
              }}
            >
              次のページを取得
            </Button>
          )}
          <Button variant="outline" onClick={() => void query.refetch()}>
            更新する
          </Button>
        </div>
      )}
    </>
  );
}
export function AdminOperations({ section }: { section: string }) {
  const group = operations[section as Section];
  const [selected, setSelected] = useState<Name | undefined>(),
    [seed, setSeed] = useState<Values>({}),
    [revision, setRevision] = useState(0);
  if (!group)
    return (
      <main className="page">
        <h1>運用管理</h1>
        <p>左の項目から操作を選んでください。</p>
      </main>
    );
  const entries = Object.entries(group[1]) as [Name, string][],
    name = selected && selected in group[1] ? selected : entries[0]![0];
  function useValue(v: Values) {
    setSeed(v);
    setRevision((n) => n + 1);
    const target =
      name.startsWith("inspection.") && typeof v.operation === "string"
        ? v.operation
        : editAfterRead[name];
    if (target && target in group![1]) setSelected(target as Name);
    window.scrollTo({ top: 0 });
  }
  return (
    <main className="page admin-layout">
      <nav aria-label="運用管理">
        {Object.entries(operations).map(([key, [title]]) => (
          <Link
            key={key}
            to="/operations/$section"
            params={{ section: key }}
            aria-current={section === key ? "page" : undefined}
          >
            {title}
          </Link>
        ))}
      </nav>
      <div className="admin-content">
        <div className="page-title">
          <h1>{group[0]}</h1>
          <p>{guidance[section as Section]}</p>
          {section === "worlds" && <Link to="/">世界構築の画面へ</Link>}
        </div>
        <label htmlFor="operation-select">操作を選択</label>
        <select
          id="operation-select"
          value={name}
          onChange={(e) => setSelected(e.target.value as Name)}
        >
          {entries.map(([n, title]) => (
            <option key={n} value={n}>
              {title}
            </option>
          ))}
        </select>
        <OperationForm
          key={`${name}:${revision}`}
          name={name}
          seed={seed}
          onUse={useValue}
        />
        {section === "audit" && (
          <p>
            ログイン・登録・データ引継ぎ・参加・本人の参加処理再開はユーザー画面から操作できます。MCPも同じ操作定義を使います。
          </p>
        )}
      </div>
    </main>
  );
}
