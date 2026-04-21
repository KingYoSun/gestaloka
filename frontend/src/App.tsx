import { FormEvent, useEffect, useRef, useState } from "react";
import keycloak from "./lib/keycloak";

type AuthMe = {
  sub: string;
  email: string;
  name: string;
  preferred_username: string;
};

type HealthPayload = {
  status: string;
  database: string;
  projection: {
    backend: string;
    space: string;
    pending_outbox: number;
    failed_outbox: number;
    projected_outbox: number;
    projection_records: number;
    graph_read_mode: string;
    last_error: string | null;
  };
  oidc_mode: string;
};

type SessionInfo = {
  session_id: string;
  world_id: string;
  player_actor_id: string;
  npc_actor_id: string;
  location_id: string;
  websocket_url: string;
};

type TurnResponse = {
  turn_id: string;
  event_id: string;
  memory_ids: string[];
  narrative: string;
  npc_reaction: string;
};

type EventItem = {
  id: string;
  narrative: string;
  event_type: string;
  location_id: string | null;
  payload: Record<string, unknown>;
};

type MemoryItem = {
  id: string;
  scope: string;
  text: string;
  actor_id: string | null;
  location_id: string | null;
  salience: number;
};

type ProjectionStatus = {
  backend: string;
  space: string;
  pending: number;
  failed: number;
  projected: number;
  last_error: string | null;
  graph_read_mode: string;
};

type GraphSummary = {
  world_id: string;
  vertex_count: number;
  edge_count: number;
  recent_records: Array<{
    entity_key: string;
    projection_type: string;
    kind: string;
    label: string;
  }>;
  neighborhood_summary: string[];
};

type RebuildSummary = {
  world_id: string;
  records: number;
  completed_at: string;
  vertex_count: number;
  edge_count: number;
};

type ActivityMessage = {
  event: string;
  data: Record<string, unknown>;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;

async function apiFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(text || `Request failed: ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

function App() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState("");
  const [me, setMe] = useState<AuthMe | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [worldId, setWorldId] = useState("world-alpha");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [turnInput, setTurnInput] = useState("広場で旅人を助け、周囲の様子を確かめる");
  const [latestNarrative, setLatestNarrative] = useState("");
  const [latestReaction, setLatestReaction] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [activity, setActivity] = useState<ActivityMessage[]>([]);
  const [projectionStatus, setProjectionStatus] = useState<ProjectionStatus | null>(null);
  const [graphSummary, setGraphSummary] = useState<GraphSummary | null>(null);
  const [opsState, setOpsState] = useState("idle");
  const [lastRebuild, setLastRebuild] = useState<RebuildSummary | null>(null);
  const [error, setError] = useState("");
  const [turnPending, setTurnPending] = useState(false);
  const [rebuildPending, setRebuildPending] = useState(false);
  const [socketState, setSocketState] = useState("idle");
  const socketRef = useRef<WebSocket | null>(null);

  const statusText = !ready ? "initializing" : authenticated ? "authenticated" : "signed-out";

  useEffect(() => {
    void fetch(`${apiBaseUrl}/health`)
      .then((response) => response.json())
      .then((data: HealthPayload) => setHealth(data))
      .catch(() => {
        setHealth(null);
      });

    keycloak
      .init({
        onLoad: "check-sso",
        pkceMethod: "S256",
      })
      .then((isAuthenticated: boolean) => {
        setAuthenticated(isAuthenticated);
        setToken(keycloak.token ?? "");
      })
      .catch((initError: unknown) => {
        setError(String(initError));
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!authenticated || !token) {
      setMe(null);
      setProjectionStatus(null);
      setGraphSummary(null);
      setOpsState("idle");
      return;
    }

    void apiFetch<AuthMe>("/auth/me", token)
      .then(setMe)
      .catch((requestError: unknown) => setError(String(requestError)));
  }, [authenticated, token]);

  useEffect(() => {
    if (!session || !token) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setSocketState("idle");
      return;
    }

    setSocketState("connecting");
    const socket = new WebSocket(`${session.websocket_url}?token=${encodeURIComponent(token)}`);
    socket.onopen = () => setSocketState("open");
    socket.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as ActivityMessage;
      setActivity((current) => [parsed, ...current].slice(0, 20));
      if (parsed.event === "turn.resolved") {
        const data = parsed.data as Partial<TurnResponse>;
        if (data.narrative) {
          setLatestNarrative(data.narrative);
        }
        if (data.npc_reaction) {
          setLatestReaction(data.npc_reaction);
        }
      }
      if (parsed.event === "graph.projection.updated") {
        void refreshOps(token, session.world_id);
      }
    };
    socket.onerror = () => {
      setSocketState("error");
      setError("WebSocket connection failed");
    };
    socket.onclose = () => {
      setSocketState("closed");
    };
    socketRef.current = socket;

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [session, token]);

  async function handleLogin() {
    await keycloak.login();
  }

  async function handleLogout() {
    await keycloak.logout({ redirectUri: window.location.origin });
  }

  async function refreshWorldState(currentSession: SessionInfo, currentToken: string) {
    const eventsResponse = await apiFetch<{ items: EventItem[] }>(
      `/worlds/${currentSession.world_id}/events`,
      currentToken,
    );
    const memoriesResponse = await apiFetch<{ items: MemoryItem[] }>(
      `/worlds/${currentSession.world_id}/memories`,
      currentToken,
    );
    setEvents(eventsResponse.items);
    setMemories(memoriesResponse.items);
  }

  async function refreshOps(currentToken: string, currentWorldId?: string) {
    if (!currentToken) {
      setProjectionStatus(null);
      setGraphSummary(null);
      setOpsState("idle");
      return;
    }

    try {
      const statusPayload = await apiFetch<ProjectionStatus>("/ops/projection/status", currentToken);
      setProjectionStatus(statusPayload);
      setOpsState("ready");
    } catch (requestError) {
      const typedError = requestError as Error & { status?: number };
      if (typedError.status === 403) {
        setOpsState("restricted");
        setProjectionStatus(null);
        setGraphSummary(null);
        return;
      }
      setOpsState("unavailable");
      setProjectionStatus(null);
      setGraphSummary(null);
      return;
    }

    if (!currentWorldId) {
      setGraphSummary(null);
      return;
    }

    try {
      const summaryPayload = await apiFetch<GraphSummary>(
        `/ops/worlds/${currentWorldId}/graph-summary`,
        currentToken,
      );
      setGraphSummary(summaryPayload);
    } catch (requestError) {
      const typedError = requestError as Error & { status?: number };
      if (typedError.status === 403) {
        setOpsState("restricted");
        setGraphSummary(null);
        return;
      }
      setOpsState("unavailable");
      setGraphSummary(null);
    }
  }

  async function handleStartSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("Sign in before starting a world session");
      return;
    }

    try {
      setError("");
      setActivity([]);
      setLatestNarrative("");
      setLatestReaction("");
      setLastRebuild(null);
      const created = await apiFetch<SessionInfo>("/sessions", token, {
        method: "POST",
        body: JSON.stringify({
          world_id: worldId,
          world_name: "Founders Reach",
        }),
      });
      setSession(created);
      await refreshWorldState(created, token);
      await refreshOps(token, created.world_id);
    } catch (requestError) {
      setError(String(requestError));
    }
  }

  async function handleTurnSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !session) {
      setError("Start a session first");
      return;
    }

    try {
      setTurnPending(true);
      setError("");
      const response = await apiFetch<TurnResponse>("/turns", token, {
        method: "POST",
        body: JSON.stringify({
          session_id: session.session_id,
          input_text: turnInput,
        }),
      });
      setLatestNarrative(response.narrative);
      setLatestReaction(response.npc_reaction);
      await refreshWorldState(session, token);
      await refreshOps(token, session.world_id);
    } catch (requestError) {
      setError(String(requestError));
    } finally {
      setTurnPending(false);
    }
  }

  async function handleRebuildGraph() {
    if (!token || !session) {
      setError("Start a session before rebuilding the graph");
      return;
    }

    try {
      setRebuildPending(true);
      setError("");
      const rebuilt = await apiFetch<RebuildSummary>("/ops/projection/rebuild", token, {
        method: "POST",
        body: JSON.stringify({ world_id: session.world_id }),
      });
      setLastRebuild(rebuilt);
      setActivity((current) => [
        { event: "ops.projection.rebuild", data: rebuilt as unknown as Record<string, unknown> },
        ...current,
      ].slice(0, 20));
      await refreshOps(token, session.world_id);
    } catch (requestError) {
      setError(String(requestError));
    } finally {
      setRebuildPending(false);
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">GESTALOKA v2</p>
        <h1>Same-world narrative rebuild</h1>
        <p className="lede">
          Log in through OIDC, open a world session, submit a turn, and verify that
          events, memories, and live graph projections remain inside one world namespace.
        </p>
      </header>

      <section className="grid">
        <article className="card">
          <h2>1. Login</h2>
          <p data-testid="auth-status">Status: {statusText}</p>
          <p data-testid="api-health">
            API health: {health?.status ?? "unreachable"} / DB: {health?.database ?? "unknown"}
          </p>
          <p data-testid="socket-status">Socket: {socketState}</p>
          {me ? (
            <dl className="meta">
              <div>
                <dt>Name</dt>
                <dd>{me.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{me.email}</dd>
              </div>
              <div>
                <dt>Sub</dt>
                <dd>{me.sub}</dd>
              </div>
            </dl>
          ) : (
            <p>Use the demo Keycloak user to enter the v2 slice.</p>
          )}
          <div className="actions">
            <button data-testid="sign-in" onClick={handleLogin} disabled={!ready || authenticated}>
              Sign in
            </button>
            <button data-testid="sign-out" onClick={handleLogout} disabled={!authenticated}>
              Sign out
            </button>
          </div>
        </article>

        <article className="card">
          <h2>2. World start</h2>
          <form onSubmit={handleStartSession} className="stack">
            <label>
              World ID
              <input
                data-testid="world-id-input"
                value={worldId}
                onChange={(event) => setWorldId(event.target.value)}
              />
            </label>
            <button data-testid="start-session" type="submit" disabled={!authenticated}>
              Start session
            </button>
          </form>
          {session ? (
            <dl className="meta">
              <div>
                <dt>World</dt>
                <dd>{session.world_id}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{session.session_id}</dd>
              </div>
              <div>
                <dt>Guide NPC</dt>
                <dd>{session.npc_actor_id}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd data-testid="session-location">{session.location_id}</dd>
              </div>
            </dl>
          ) : (
            <p>No session started yet.</p>
          )}
        </article>

        <article className="card wide">
          <h2>3. Turn submission</h2>
          <form onSubmit={handleTurnSubmit} className="stack">
            <label>
              Player action
              <textarea
                data-testid="turn-input"
                rows={4}
                value={turnInput}
                onChange={(event) => setTurnInput(event.target.value)}
              />
            </label>
            <button data-testid="submit-turn" type="submit" disabled={!session || turnPending}>
              {turnPending ? "Submitting..." : "Submit turn"}
            </button>
          </form>
          <div className="result">
            <h3>Latest narrative</h3>
            <p data-testid="latest-narrative">{latestNarrative || "No turn resolved yet."}</p>
            <h3>Latest NPC reaction</h3>
            <p data-testid="latest-reaction">{latestReaction || "No NPC reaction yet."}</p>
          </div>
        </article>

        <article className="card">
          <h2>4. Results</h2>
          <h3>Events</h3>
          <ul className="stream" data-testid="events-stream">
            {events.map((item) => (
              <li key={item.id}>
                <strong>{item.event_type}</strong>
                <span>{item.narrative}</span>
                <span>location: {item.location_id ?? "none"}</span>
              </li>
            ))}
          </ul>
          <h3>Memories</h3>
          <ul className="stream" data-testid="memories-stream">
            {memories.map((item) => (
              <li key={item.id}>
                <strong>{item.scope}</strong>
                <span>{item.text}</span>
                <span>location: {item.location_id ?? "none"}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="card wide">
          <h2>Ops</h2>
          <p data-testid="ops-status">Ops access: {opsState}</p>
          <p>
            Projection backend: {projectionStatus?.backend ?? health?.projection.backend ?? "unknown"} / Graph read:{" "}
            {projectionStatus?.graph_read_mode ?? health?.projection.graph_read_mode ?? "unknown"} / Pending:{" "}
            {projectionStatus?.pending ?? health?.projection.pending_outbox ?? "unknown"}
          </p>
          <p>
            Space: {projectionStatus?.space ?? health?.projection.space ?? "unknown"} / Failed:{" "}
            {projectionStatus?.failed ?? health?.projection.failed_outbox ?? "unknown"} / Projected:{" "}
            {projectionStatus?.projected ?? health?.projection.projected_outbox ?? "unknown"}
          </p>
          <p data-testid="graph-vertex-count">
            Graph vertices: {graphSummary?.vertex_count ?? 0} / edges:{" "}
            <span data-testid="graph-edge-count">{graphSummary?.edge_count ?? 0}</span>
          </p>
          <div className="actions">
            <button
              data-testid="rebuild-graph"
              onClick={handleRebuildGraph}
              disabled={!session || rebuildPending || opsState !== "ready"}
            >
              {rebuildPending ? "Rebuilding..." : "Rebuild graph"}
            </button>
          </div>
          {lastRebuild ? (
            <p data-testid="rebuild-result">
              Rebuilt {lastRebuild.records} records at {lastRebuild.completed_at}
            </p>
          ) : null}
          <h3>Neighborhood summary</h3>
          <ul className="stream" data-testid="graph-summary-stream">
            {(graphSummary?.neighborhood_summary ?? []).map((item) => (
              <li key={item}>
                <strong>context</strong>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <h3>Recent projection records</h3>
          <ul className="stream" data-testid="ops-records-stream">
            {(graphSummary?.recent_records ?? []).slice(0, 8).map((item) => (
              <li key={item.entity_key}>
                <strong>
                  {item.kind}:{item.label}
                </strong>
                <span>{item.entity_key}</span>
              </li>
            ))}
          </ul>
          <h3>Realtime stream</h3>
          <ul className="stream" data-testid="ops-stream">
            {activity.map((item, index) => (
              <li key={`${item.event}-${index}`}>
                <strong>{item.event}</strong>
                <span>{JSON.stringify(item.data)}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      {error ? (
        <aside className="error" data-testid="error-banner">
          {error}
        </aside>
      ) : null}
    </main>
  );
}

export default App;
