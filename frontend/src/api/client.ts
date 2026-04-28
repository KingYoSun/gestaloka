import type { APIError } from "../types";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

async function apiFetch<T>(path: string, token?: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? undefined);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let body: unknown = null;
    let message = `Request failed: ${response.status}`;
    if (contentType.includes("application/json")) {
      body = (await response.json()) as unknown;
      if (typeof body === "object" && body !== null && "detail" in body) {
        const detail = (body as { detail?: unknown }).detail;
        if (typeof detail === "string") {
          message = detail;
        }
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
    throw error;
  }

  return (await response.json()) as T;
}

function formatError(error: unknown): string {
  const typed = error as APIError;
  if (typed.status === 409 && typed.body && typeof typed.body === "object") {
    const body = typed.body as {
      detail?: string;
      balance?: number;
      required?: number;
      turn_cost?: number;
    };
    if (typeof body.detail === "string") {
      return `${body.detail} (balance: ${body.balance ?? "?"}, required: ${body.required ?? body.turn_cost ?? "?"})`;
    }
  }
  if (typed.message) {
    return typed.message;
  }
  return String(error);
}

export { apiFetch, formatError };
