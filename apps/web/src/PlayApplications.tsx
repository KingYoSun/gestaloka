import { useState } from "react";
import { z } from "zod";
import { PlayCommand } from "@gestaloka/contracts";
import { Button } from "./components/ui/button.js";
import { Textarea } from "./components/ui/textarea.js";
import { Notice } from "./presentation.js";
import { RichText } from "./RichText.js";
import { itemText, realTime, type PlayScreen } from "./play-panels.js";

export function PlayApplications({
  actorId,
  screen,
  canAct,
  busy,
  send,
}: {
  actorId: string;
  screen: z.infer<typeof PlayScreen>;
  canAct: boolean;
  busy: boolean;
  send: (raw: Record<string, unknown>) => void;
}) {
  const [invalid, setInvalid] = useState(false);
  const stocks = (screen.belongings?.storages ?? []).flatMap(
    ({ id, label, items }) =>
      items.flatMap((item) =>
        id && item.id ? [{ storage: id, label, item }] : [],
      ),
  );
  function submit(raw: Record<string, unknown>) {
    const parsed = PlayCommand.safeParse({
      ...raw,
      requestId: crypto.randomUUID(),
    });
    setInvalid(!parsed.success);
    if (parsed.success) send(parsed.data);
  }
  return (
    <section className="space-y-3" aria-label="受領と交換">
      {invalid && (
        <Notice>人物・物品・系列のID、個数、期限を確認してください</Notice>
      )}
      {screen.applications.map((application) => (
        <article
          className="space-y-2 rounded-lg border p-3"
          key={application.id}
        >
          <p>{application.senderName}からの申請</p>
          <RichText text={application.text} />
          {application.preview
            .filter((line) => line !== application.text)
            .map((line, index) => (
              <RichText key={index} text={line} />
            ))}
          <p>
            受領期限{" "}
            <time dateTime={application.deadline}>
              {realTime(application.deadline)}
            </time>
          </p>
          <div className="flex flex-wrap gap-3">
            {application.awaitingYou ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() =>
                    send({
                      command: "receive",
                      applicationId: application.id,
                      accept: true,
                    })
                  }
                >
                  承認する
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    send({
                      command: "receive",
                      applicationId: application.id,
                      accept: false,
                    })
                  }
                >
                  却下する
                </Button>
              </>
            ) : application.senderId === actorId ? (
              <Button
                disabled={busy}
                variant="outline"
                onClick={() =>
                  send({ command: "withdraw", applicationId: application.id })
                }
              >
                取り下げる
              </Button>
            ) : (
              <p>ほかの受領者の判断待ち</p>
            )}
          </div>
        </article>
      ))}
      {screen.ownOffers.map((offer) => (
        <div className="flex flex-wrap items-center gap-3" key={offer.id}>
          <span>
            公開中 {offer.itemLabel}×{offer.count} ⇄ {offer.paymentLabel}×
            {offer.paymentCount}
          </span>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              send({ command: "withdraw", applicationId: offer.id })
            }
          >
            交換を取り下げる
          </Button>
        </div>
      ))}
      {screen.exchangeOffers
        .filter((offer) => offer.sellerId !== actorId)
        .map((offer) => {
          const payments = (screen.belongings?.items ?? []).filter(
            (item) =>
              item.id &&
              ("paymentItemId" in offer
                ? item.id === offer.paymentItemId
                : item.seriesId === offer.paymentSeriesId) &&
              (item.count ?? 1) >= offer.paymentCount,
          );
          return (
            <form
              className="space-y-2 rounded-lg border p-3"
              key={offer.id}
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                submit({
                  command: "exchange",
                  offerId: offer.id,
                  paymentItemId: values.get("payment"),
                });
              }}
            >
              <p>
                {offer.itemLabel}×{offer.count} ⇄ {offer.paymentLabel}×
                {offer.paymentCount}
              </p>
              <RichText text={offer.text} />
              {payments.length ? (
                <div className="flex flex-wrap items-end gap-3">
                  <label>
                    支払い品{" "}
                    <select name="payment" required>
                      {payments.map((item) => (
                        <option key={item.id} value={item.id}>
                          {itemText(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button disabled={busy || !canAct} type="submit">
                    交換する
                  </Button>
                </div>
              ) : (
                <p>条件に合う支払い品が手元にありません</p>
              )}
            </form>
          );
        })}
      {canAct && (
        <details className="rounded-lg border bg-secondary p-4">
          <summary>時間差で受け取るメモを送る</summary>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget),
                date = new Date(String(values.get("deadline")));
              submit({
                command: "memo",
                text: values.get("text"),
                dependencies: [],
                participants: String(values.get("participants"))
                  .split(",")
                  .map((id) => id.trim()),
                deferredUntil: Number.isNaN(date.getTime())
                  ? ""
                  : date.toISOString(),
              });
            }}
          >
            <label>
              メモの本文 <Textarea name="text" required />
            </label>
            <label>
              受領者の人物ID（複数はカンマ区切り）{" "}
              <input name="participants" required />
            </label>
            <label>
              受領期限 <input name="deadline" type="datetime-local" required />
            </label>
            <Button disabled={busy} type="submit">
              メモを送る
            </Button>
          </form>
        </details>
      )}
      {canAct && stocks.length > 0 && (
        <details className="rounded-lg border bg-secondary p-4">
          <summary>この場所に交換条件を公開する</summary>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget),
                stock = stocks[Number(values.get("stock"))];
              submit({
                command: "offer",
                storageId: stock?.storage,
                itemId: stock?.item.id,
                count: Number(values.get("count")),
                paymentSeriesId: values.get("series"),
                paymentCount: Number(values.get("paymentCount")),
                paymentLabel: values.get("paymentLabel"),
                text: values.get("terms"),
              });
            }}
          >
            <label>
              渡す品{" "}
              <select name="stock">
                {stocks.map(({ storage, label, item }, index) => (
                  <option key={`${storage}:${item.id}`} value={index}>
                    {label}の{itemText(item)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              渡す個数{" "}
              <input
                name="count"
                type="number"
                defaultValue="1"
                min="1"
                required
              />
            </label>
            <label>
              支払い品の呼称 <input name="paymentLabel" required />
            </label>
            <label>
              支払い品の系列ID{" "}
              <input name="series" list="payment-series" required />
            </label>
            <datalist id="payment-series">
              {[
                ...new Map(
                  (screen.belongings?.items ?? [])
                    .filter((item) => item.seriesId)
                    .map((item) => [item.seriesId!, item.label]),
                ).entries(),
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </datalist>
            <label>
              支払いの個数{" "}
              <input
                name="paymentCount"
                type="number"
                defaultValue="1"
                min="1"
                required
              />
            </label>
            <label>
              交換の掲示文 <Textarea name="terms" required />
            </label>
            <Button disabled={busy} type="submit">
              交換条件を公開する
            </Button>
          </form>
        </details>
      )}
    </section>
  );
}
