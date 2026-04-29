const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

export type APIError = Error & {
  status?: number;
  body?: unknown;
  requiresReauth?: boolean;
};

const AUTH_RECOVERY_MESSAGES = new Set(["Token validation failed", "Unexpected token audience"]);

export async function apiFetch<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown = null;
    let message = `Request failed: ${response.status}`;
    if (contentType.includes("application/json")) {
      body = (await response.json()) as unknown;
      const detail = typeof body === "object" && body !== null && "detail" in body ? (body as { detail?: unknown }).detail : null;
      if (typeof detail === "string") {
        message = detail;
      }
    } else {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }
    const error = new Error(message) as APIError;
    error.status = response.status;
    error.body = body;
    error.requiresReauth = response.status === 401 && AUTH_RECOVERY_MESSAGES.has(message);
    throw error;
  }
  return (await response.json()) as T;
}

export function formatError(error: unknown) {
  const typed = error as APIError;
  if (typed.requiresReauth) {
    return `${typed.message}. Backend restart or token audience drift can invalidate the current admin session. 再ログインしてください。`;
  }
  return typed.message || String(error);
}

export function requiresReauth(error: unknown) {
  return Boolean((error as APIError).requiresReauth);
}
