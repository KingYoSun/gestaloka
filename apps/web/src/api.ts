import createFetchClient from "openapi-fetch";
import createQueryClient from "openapi-react-query";
import { ApiError, BrowserSession } from "@gestaloka/contracts";
import type { paths } from "@gestaloka/contracts/http";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export class ScopeChanged extends Error {}
type SessionState = { id: string | null; epoch: number; error: string | null };
let session: SessionState = { id: null, epoch: 0, error: null };
let opening: Promise<string> | undefined;
const listeners = new Set<() => void>();
const publish = (value: SessionState) => {
  session = value;
  for (const listener of listeners) listener();
};
export const getSession = () => session;
export const subscribeSession = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function expireSession() {
  const old = session.id;
  if (old)
    for (const key of Object.keys(localStorage))
      if (key.startsWith(`gestaloka:${old}:pending:`))
        localStorage.removeItem(key);
  opening = undefined;
  publish({
    id: null,
    epoch: session.epoch + 1,
    error: "利用できる状態が変わりました。世界一覧からもう一度開いてください。",
  });
}
export function resetSession() {
  opening = undefined;
  publish({ id: null, epoch: session.epoch + 1, error: null });
}

export const api = createFetchClient<paths>({
  baseUrl: globalThis.location?.origin ?? "http://localhost",
  credentials: "same-origin",
  cache: "no-store",
  headers: { "X-Gestaloka-Request": "1" },
  fetch: async (request: Request) => {
    const epoch = session.epoch,
      protectedPath = new URL(request.url).pathname !== "/api/health";
    if (session.error && protectedPath) throw new ScopeChanged();
    const response = await fetch(request);
    if (epoch !== session.epoch) throw new ScopeChanged();
    const identity = response.headers.get("X-Gestaloka-Subject");
    if (
      protectedPath &&
      session.id &&
      ((response.ok && identity !== session.id) ||
        [401, 403, 404].includes(response.status))
    ) {
      expireSession();
      throw new ScopeChanged();
    }
    if (!response.ok) {
      const parsed = ApiError.safeParse(
        await response
          .clone()
          .json()
          .catch(() => null),
      );
      throw new ApiFailure(
        response.status,
        parsed.success ? parsed.data.code : "HTTP_ERROR",
        parsed.success ? parsed.data.message : "通信を確認できませんでした",
      );
    }
    return response;
  },
});
export const $api = createQueryClient(api);

export function openSession() {
  if (session.id) return Promise.resolve(session.id);
  if (opening) return opening;
  const epoch = session.epoch;
  opening = (async () => {
    let data;
    try {
      data = (await api.GET("/api/session")).data;
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.status !== 401) throw error;
      data = (await api.POST("/api/session")).data;
    }
    const identity = BrowserSession.parse(data).id;
    if (epoch !== session.epoch) throw new ScopeChanged();
    publish({ id: identity, epoch, error: null });
    return identity;
  })().catch((error: unknown) => {
    if (epoch === session.epoch)
      publish({
        id: null,
        epoch,
        error:
          error instanceof ApiFailure
            ? error.message
            : "接続を確認できませんでした。もう一度お試しください。",
      });
    throw error;
  });
  return opening;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "処理を確認できませんでした";
}
export function pendingKey(world: string, operation: string) {
  return `gestaloka:${session.id}:pending:${world}:${operation}`;
}
