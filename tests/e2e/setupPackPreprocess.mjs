const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000";
const tokenUrl =
  process.env.E2E_KEYCLOAK_TOKEN_URL ??
  "http://127.0.0.1:8080/realms/gestaloka/protocol/openid-connect/token";
const clientId = process.env.E2E_KEYCLOAK_CLIENT_ID ?? "gestaloka-admin-frontend";
const username = process.env.E2E_ADMIN_USERNAME ?? "demo";
const password = process.env.E2E_ADMIN_PASSWORD ?? "demo-password";
const packId = process.env.E2E_PREPROCESS_PACK_ID ?? "gestaloka_world_reference";
const templateId = process.env.E2E_PREPROCESS_TEMPLATE_ID ?? "layered_world_foundation";
const worldId = process.env.E2E_PREPROCESS_WORLD_ID ?? "gestaloka_world_reference";

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    const detail = typeof payload === "object" && payload ? JSON.stringify(payload) : text;
    throw new Error(`${init.method ?? "GET"} ${url} failed with ${response.status}: ${detail.slice(0, 1000)}`);
  }
  return payload;
}

async function getAccessToken() {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    username,
    password,
  });
  const payload = await requestJson(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error(`Keycloak token response did not include an access token: ${JSON.stringify(payload)}`);
  }
  return payload.access_token;
}

async function apiJson(path, token, init = {}) {
  return requestJson(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
    },
  });
}

async function waitForPlayableWorld(token) {
  const deadline = Date.now() + 30_000;
  let lastPayload = null;
  while (Date.now() < deadline) {
    const payload = await apiJson("/worlds/playable", token);
    lastPayload = payload;
    const item = Array.isArray(payload.items)
      ? payload.items.find((candidate) => candidate.world_id === worldId && candidate.status === "playable")
      : null;
    if (item) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Playable world ${worldId} did not appear after preprocess: ${JSON.stringify(lastPayload)}`);
}

async function main() {
  const token = await getAccessToken();
  const statusPayload = await apiJson("/admin/packs/preprocess-status", token);
  const statusItem = Array.isArray(statusPayload.items)
    ? statusPayload.items.find((item) => item.pack_id === packId && item.world_template_id === templateId)
    : null;

  if (statusItem?.ready) {
    console.log(`Pack preprocess already ready for ${packId}/${templateId}`);
    await waitForPlayableWorld(token);
    return;
  }

  console.log(`Running pack preprocess for ${packId}/${templateId}`);
  const result = await apiJson(
    `/admin/packs/${encodeURIComponent(packId)}/templates/${encodeURIComponent(templateId)}/preprocess`,
    token,
    { method: "POST" },
  );
  if (result.status !== "ready") {
    throw new Error(`Pack preprocess did not become ready: ${JSON.stringify(result)}`);
  }
  await waitForPlayableWorld(token);
  console.log(`Pack preprocess ready for ${packId}/${templateId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
