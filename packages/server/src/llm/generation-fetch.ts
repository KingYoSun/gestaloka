import { AsyncLocalStorage } from "node:async_hooks";
import { subscribe } from "node:diagnostics_channel";

type Attempt = { first?: object; cause?: NodeJS.ErrnoException };
const active = new AsyncLocalStorage<Attempt>();
const unsent = new WeakMap<object, Attempt>();

// A redirect creates another Undici request. Only the first request can prove
// that this generation never left the process, even with pooled connections.
subscribe("undici:request:create", (event) => {
  const attempt = active.getStore();
  if (!attempt || attempt.first) return;
  const { request } = event as { request: object };
  attempt.first = request;
  unsent.set(request, attempt);
});
subscribe("undici:client:sendHeaders", (event) => {
  unsent.delete((event as { request: object }).request);
});
subscribe("undici:request:error", (event) => {
  const { request, error } = event as {
    request: object;
    error: NodeJS.ErrnoException;
  };
  const attempt = unsent.get(request);
  if (attempt) attempt.cause = error;
});

export class UnsentGeneration extends Error {
  constructor(readonly code: string) {
    super(`LLM要求を送信できませんでした（${code}）。予約枠を解除しました`);
  }
}

export const generationFetch: typeof fetch = async (url, init) => {
  const attempt: Attempt = {};
  try {
    return await active.run(attempt, () => fetch(url, init));
  } catch (error) {
    const cause = attempt.cause;
    if (
      cause?.code &&
      ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(cause.code) &&
      error instanceof Error &&
      error.cause === cause
    )
      throw new UnsentGeneration(cause.code);
    throw error;
  }
};
