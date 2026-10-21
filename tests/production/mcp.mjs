import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { connectDatabases } from "@gestaloka/server";
import { Operations } from "@gestaloka/server/operations";
import { fixtureAuth } from "../support/auth.ts";
const db = connectDatabases(),
  operations = new Operations(db.postgres, process.env.OPERATIONS_TOKEN_SECRET),
  resource = new URL(operations.mcp.resource),
  input = JSON.parse(process.argv[2]);
// Test-only TLS routing to the private Caddy container; no public DNS or external IdP is used.
const route = async (input, init) => {
  const source = input instanceof Request ? input : new Request(input, init),
    headers = Object.fromEntries(source.headers),
    body = ["GET", "HEAD"].includes(source.method)
      ? undefined
      : await source.text(),
    url = new URL(source.url);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname: "caddy",
        port: 443,
        servername: url.hostname,
        method: source.method,
        path: url.pathname + url.search,
        headers: { ...headers, host: url.host },
        rejectUnauthorized: false,
      },
      (response) => {
        const data = [];
        response.on("data", (c) => data.push(c));
        response.on("end", () => {
          const headers = new Headers();
          for (let i = 0; i < response.rawHeaders.length; i += 2)
            headers.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
          resolve(
            new Response(
              [204, 205, 304].includes(response.statusCode)
                ? null
                : Buffer.concat(data),
              { status: response.statusCode, headers },
            ),
          );
        });
      },
    );
    request.on("error", reject);
    request.end(body);
  });
};
const jar = new Map(),
  follow = async (url, init = {}) => {
    const response = await route(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        cookie: [...jar.values()].join("; "),
      },
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";", 1)[0];
      jar.set(pair.slice(0, pair.indexOf("=")), pair);
    }
    return response;
  };
let external;
try {
  // The real browser/Ory consent path is verified in tests/auth/mcp.test.ts.
  // Here a fixture operator approves the same native Hydra grant through its private admin API.
  await operations.setup();
  const expected = await db.postgres.query(
    "SELECT to_regclass('recovery_expectation') AS present",
  );
  let admin;
  if (expected.rows[0].present)
    admin = (await db.postgres.query("SELECT data FROM recovery_expectation"))
      .rows[0].data.admin;
  else admin = (await (await fixtureAuth(db.postgres)).person()).id;
  const clientId = randomUUID(),
    callback = "http://127.0.0.1:18984/callback",
    scopes = [
      "backups.configure",
      "backups.create",
      "backups.list",
      "backups.read",
      "backups.job",
      "backups.restore",
    ];
  await operations.execute(admin, randomUUID(), {
    operation: "mcp.clients.put",
    clientId,
    configuration: {
      name: "TLS復旧試験",
      enabled: true,
      redirectUris: [callback],
      scopes,
      worldIds: null,
    },
    expectedVersion: 0,
    reason: "隔離環境のMCP確認",
  });
  const verifier =
      randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    authorization = new URL("/oauth2/auth", resource);
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    response_type: "code",
    scope: ["mcp.connect", ...scopes].join(" "),
    resource: resource.href,
    state: randomUUID(),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  const initial = await follow(authorization),
    login = new URL(initial.headers.get("location"));
  assert(login.searchParams.has("login_challenge"));
  const loginAccepted = await operations.mcp.hydra(
    `admin/oauth2/auth/requests/login/accept?login_challenge=${encodeURIComponent(login.searchParams.get("login_challenge"))}`,
    "PUT",
    { subject: admin, remember: false },
  );
  const afterLogin = await follow(loginAccepted.redirect_to),
    consent = new URL(afterLogin.headers.get("location")),
    challenge = consent.searchParams.get("consent_challenge");
  const data = await operations.mcp.hydra(
    `admin/oauth2/auth/requests/consent?consent_challenge=${encodeURIComponent(challenge)}`,
  );
  const grant = await operations.mcp.approve(data, challenge),
    accepted = await operations.mcp.hydra(
      `admin/oauth2/auth/requests/consent/accept?consent_challenge=${encodeURIComponent(challenge)}`,
      "PUT",
      {
        grant_scope: data.requested_scope,
        grant_access_token_audience: [resource.href],
        remember: false,
        session: { access_token: { gestaloka_grant: grant } },
      },
    );
  const response = await follow(accepted.redirect_to),
    code = new URL(response.headers.get("location")).searchParams.get("code");
  assert(code);
  const exchange = await follow(new URL("/oauth2/token", resource), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: callback,
      code_verifier: verifier,
      resource: resource.href,
    }),
  });
  assert.equal(exchange.status, 200);
  const token = await exchange.json();
  assert(token.access_token);
  external = new Client({ name: "tls-recovery-client", version: "1" });
  await external.connect(
    new StreamableHTTPClientTransport(resource, {
      fetch: route,
      requestInit: {
        headers: { authorization: `Bearer ${token.access_token}` },
      },
    }),
  );
  const { operation, requestId, ...args } = input,
    result = await external.callTool({
      name: operation.replaceAll(".", "_"),
      arguments: { ...args, requestId: requestId ?? randomUUID() },
    });
  assert(!result.isError, JSON.stringify(result));
  console.log(result.content[0].text);
} finally {
  await external?.close();
  await db.close();
}
