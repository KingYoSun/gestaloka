import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

import { profilePayloadForApi, type DerivedPlayerProfile } from "./playerProfiles";
import { decisionActionText, type SwarmDecision } from "./playbook";
import type { AssignedSwarmUserPersona, SwarmAuthUser } from "./userPersonas";

export const worldId = "gestaloka_world_reference";
export const worldTemplateId = "layered_world_foundation";
export const apiBaseURL = process.env.SWARM_API_BASE_URL ?? "http://localhost:8000";
export const keycloakTokenURL =
  process.env.SWARM_KEYCLOAK_TOKEN_URL ??
  "http://localhost:8080/realms/gestaloka/protocol/openid-connect/token";
const turnTimeoutMs = envInt("SWARM_TURN_TIMEOUT_MS", 600_000);
const apiTimeoutMs = envInt("SWARM_POLL_TIMEOUT_MS", 120_000);

export type TokenProvider = () => Promise<string>;
type TokenSource = string | TokenProvider;

export type PlayerRuntime = {
  persona: AssignedSwarmUserPersona;
  profile: DerivedPlayerProfile;
  accessToken: TokenSource;
  actorId: string;
  sessionId: string;
  locationId: string;
};

type ProfileResponse = {
  actor_id: string;
  display_name: string;
};

type SessionResponse = {
  session_id: string;
  player_actor_id: string;
  location_id: string;
};

export async function authenticatePage(page: Page, baseURL: string, persona: AssignedSwarmUserPersona): Promise<void> {
  await page.goto(baseURL);
  await page.getByTestId("sign-in").click();
  await page.locator("#username").fill(persona.user.username);
  await page.locator("#password").fill(persona.user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByTestId("auth-status")).toContainText("authenticated", { timeout: 30_000 });
  await expect(page.getByTestId("error-banner").filter({ hasText: "Keycloak" })).toHaveCount(0);
}

export async function getAccessToken(
  request: APIRequestContext,
  user: SwarmAuthUser,
  clientId = "gestaloka-frontend",
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    username: user.username,
    password: user.password,
  });
  const response = await request.post(keycloakTokenURL, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: body.toString(),
  });
  if (!response.ok()) {
    throw new Error(
      `Failed to get Keycloak token for ${user.username}: ${response.status()} ${await response.text()}`,
    );
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error(`Keycloak token response for ${user.username} did not include access_token`);
  }
  return payload.access_token;
}

export function createTokenProvider(request: APIRequestContext, user: SwarmAuthUser): TokenProvider {
  return () => getAccessToken(request, user);
}

export async function ensurePackPreprocessed(request: APIRequestContext, token: TokenSource): Promise<Record<string, unknown>> {
  const payload = await apiPost<Record<string, unknown>>(
    request,
    token,
    `/admin/packs/${worldId}/templates/${worldTemplateId}/preprocess`,
    {},
    apiTimeoutMs,
  );
  if (payload.status !== "ready") {
    throw new Error(`pack preprocess did not become ready: ${JSON.stringify(payload)}`);
  }
  return payload;
}

export async function ensurePlayerProfile(
  request: APIRequestContext,
  token: TokenSource,
  profile: DerivedPlayerProfile,
): Promise<ProfileResponse> {
  const existing = await apiGet<{ items: ProfileResponse[] }>(request, token, `/worlds/${worldId}/player-profiles`);
  const match = existing.items.find((item) => item.display_name === profile.displayName);
  if (match) {
    return match;
  }
  return apiPost<ProfileResponse>(request, token, `/worlds/${worldId}/player-profiles`, profilePayloadForApi(profile));
}

export async function createPlayerSession(
  request: APIRequestContext,
  token: TokenSource,
  actorId: string,
): Promise<SessionResponse> {
  return apiPost<SessionResponse>(request, token, "/sessions", {
    world_id: worldId,
    player_actor_id: actorId,
  });
}

export async function resolveTurn(
  request: APIRequestContext,
  token: TokenSource,
  sessionId: string,
  decision: SwarmDecision,
): Promise<Record<string, unknown>> {
  return apiPost<Record<string, unknown>>(
    request,
    token,
    "/turns",
    { session_id: sessionId, player_action_text: decisionActionText(decision) },
    turnTimeoutMs,
  );
}

export async function getSessionState(
  request: APIRequestContext,
  token: TokenSource,
  sessionId: string,
): Promise<Record<string, unknown>> {
  return apiGet<Record<string, unknown>>(request, token, `/sessions/${sessionId}/state`);
}

export async function getSessionQuests(
  request: APIRequestContext,
  token: TokenSource,
  sessionId: string,
): Promise<Record<string, unknown>> {
  return apiGet<Record<string, unknown>>(request, token, `/sessions/${sessionId}/quests`);
}

export async function getWorldEvents(request: APIRequestContext, token: TokenSource): Promise<Record<string, unknown>> {
  return apiGet<Record<string, unknown>>(request, token, `/worlds/${worldId}/events`);
}

export async function getWorldMemories(request: APIRequestContext, token: TokenSource): Promise<Record<string, unknown>> {
  return apiGet<Record<string, unknown>>(request, token, `/worlds/${worldId}/memories`);
}

export async function getOpsSharedWorld(request: APIRequestContext, token: TokenSource): Promise<Record<string, unknown>> {
  return apiGet<Record<string, unknown>>(request, token, `/ops/worlds/${worldId}/shared-world`);
}

export async function getOpsHistory(request: APIRequestContext, token: TokenSource): Promise<Record<string, unknown>> {
  return apiGet<Record<string, unknown>>(request, token, `/ops/worlds/${worldId}/history?limit=100`);
}

async function apiGet<T>(request: APIRequestContext, token: TokenSource, path: string): Promise<T> {
  const resolvedToken = await resolveToken(token);
  const response = await request.get(`${apiBaseURL}${path}`, {
    headers: { Authorization: `Bearer ${resolvedToken}` },
    timeout: apiTimeoutMs,
  });
  return checkedJson<T>(response, path);
}

async function apiPost<T>(
  request: APIRequestContext,
  token: TokenSource,
  path: string,
  data: Record<string, unknown>,
  timeout = apiTimeoutMs,
): Promise<T> {
  const resolvedToken = await resolveToken(token);
  const response = await request.post(`${apiBaseURL}${path}`, {
    headers: { Authorization: `Bearer ${resolvedToken}` },
    data,
    timeout,
  });
  return checkedJson<T>(response, path, path === "/turns" ? [422] : []);
}

async function resolveToken(token: TokenSource): Promise<string> {
  return typeof token === "function" ? token() : token;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function checkedJson<T>(response: APIResponse, label: string, acceptedErrorStatuses: number[] = []): Promise<T> {
  if (acceptedErrorStatuses.includes(response.status())) {
    const payload = (await response.json()) as Record<string, unknown>;
    if (typeof payload.event_id === "string") {
      return payload as T;
    }
    throw new Error(`${label} returned accepted status ${response.status()} without event_id: ${JSON.stringify(payload)}`);
  }
  if (!response.ok()) {
    throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}
