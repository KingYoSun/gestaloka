import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import keycloak from "./lib/keycloak";

type AuthMe = {
  sub: string;
  email: string;
  name: string;
  preferred_username: string;
};

type SessionInfo = {
  session_id: string;
  world_id: string;
  world_name: string;
  player_actor_id: string;
  guide_npc_id: string;
  player_display_name: string;
  graph_backend: string;
};

type EventItem = {
  id: string;
  narrative: string;
  event_type: string;
  payload: Record<string, unknown>;
};

type MemoryItem = {
  id: string;
  scope: string;
  text: string;
  actor_id: string | null;
  salience: number;
};

type ActivityMessage = {
  event: string;
  data: Record<string, unknown>;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const wsBaseUrl = import.meta.env.VITE_WS_BASE_URL;

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
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function App() {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState<string>("");
  const [me, setMe] = useState<AuthMe | null>(null);
  const [health, setHealth] = useState("unknown");
  const [worldId, setWorldId] = useState("world-alpha");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [turnInput, setTurnInput] = useState("広場で旅人を助け、周囲の様子を確かめる");
  const [latestNarrative, setLatestNarrative] = useState("");
  const [latestReaction, setLatestReaction] = useState("");
  const [events, setEvents] = useState<EventItem[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [activity, setActivity] = useState<ActivityMessage[]>([]);
  const [error, setError] = useState<string>("");
  const socketRef = useRef<WebSocket | null>(null);

  const statusText = useMemo(() => {
    if (!ready) {
      return "initializing";
    }
    return authenticated ? "authenticated" : "signed-out";
  }, [authenticated, ready]);

  useEffect(() => {
    void fetch(`${apiBaseUrl}/health`)
      .then((response) => response.json())
      .then((data: { status: string }) => setHealth(data.status))
      .catch(() => setHealth("unreachable"));

    keycloak
      .init({
        onLoad: "check-sso",
        pkceMethod: "S256",
      })
      .then((isAuthenticated) => {
        setAuthenticated(isAuthenticated);
        setToken(keycloak.token ?? "");
      })
      .catch((initError) => {
        setError(String(initError));
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!authenticated || !token) {
      setMe(null);
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
      return;
    }

    const socket = new WebSocket(
      `${wsBaseUrl}/ws/sessions/${session.session_id}?token=${encodeURIComponent(token)}`,
    );
    socket.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as ActivityMessage;
      setActivity((current) => [parsed, ...current].slice(0, 12));
    };
    socket.onerror = () => {
      setError("WebSocket connection failed");
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

  async function handleStartSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      setError("Sign in before starting a world session");
      return;
    }

    try {
      setError("");
      const created = await apiFetch<SessionInfo>("/sessions", token, {
        method: "POST",
        body: JSON.stringify({
          world_id: worldId,
          world_name: "Founders Reach",
        }),
      });
      setSession(created);
      await refreshWorldState(created, token);
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
      setError("");
      const response = await apiFetch<{
        narrative: string;
        npc_reaction: string;
      }>("/turns", token, {
        method: "POST",
        body: JSON.stringify({
          session_id: session.session_id,
          input_text: turnInput,
        }),
      });
      setLatestNarrative(response.narrative);
      setLatestReaction(response.npc_reaction);
      await refreshWorldState(session, token);
    } catch (requestError) {
      setError(String(requestError));
    }
  }

  return (
    <main className="shell">
      <header className="hero">
        <p className="eyebrow">GESTALOKA v2</p>
        <h1>Same-world narrative rebuild</h1>
        <p className="lede">
          Log in through OIDC, open a world session, submit a turn, and verify that
          events, memories, and projection audit records are all produced inside one
          world namespace.
        </p>
      </header>

      <section className="grid">
        <article className="card">
          <h2>1. Login</h2>
          <p>Status: {statusText}</p>
          <p>API health: {health}</p>
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
            <button onClick={handleLogin} disabled={!ready || authenticated}>
              Sign in
            </button>
            <button onClick={handleLogout} disabled={!authenticated}>
              Sign out
            </button>
          </div>
        </article>

        <article className="card">
          <h2>2. World start</h2>
          <form onSubmit={handleStartSession} className="stack">
            <label>
              World ID
              <input value={worldId} onChange={(event) => setWorldId(event.target.value)} />
            </label>
            <button type="submit" disabled={!authenticated}>
              Start session
            </button>
          </form>
          {session ? (
            <dl className="meta">
              <div>
                <dt>World</dt>
                <dd>{session.world_name}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{session.session_id}</dd>
              </div>
              <div>
                <dt>Projection</dt>
                <dd>{session.graph_backend}</dd>
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
                rows={4}
                value={turnInput}
                onChange={(event) => setTurnInput(event.target.value)}
              />
            </label>
            <button type="submit" disabled={!session}>
              Submit turn
            </button>
          </form>
          <div className="result">
            <h3>Latest narrative</h3>
            <p>{latestNarrative || "No turn resolved yet."}</p>
            <h3>Latest NPC reaction</h3>
            <p>{latestReaction || "No NPC reaction yet."}</p>
          </div>
        </article>

        <article className="card">
          <h2>4. Results</h2>
          <h3>Events</h3>
          <ul className="stream">
            {events.map((item) => (
              <li key={item.id}>
                <strong>{item.event_type}</strong>
                <span>{item.narrative}</span>
              </li>
            ))}
          </ul>
          <h3>Memories</h3>
          <ul className="stream">
            {memories.map((item) => (
              <li key={item.id}>
                <strong>{item.scope}</strong>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>Ops</h2>
          <p>Realtime event stream for the active session.</p>
          <ul className="stream">
            {activity.map((item, index) => (
              <li key={`${item.event}-${index}`}>
                <strong>{item.event}</strong>
                <span>{JSON.stringify(item.data)}</span>
              </li>
            ))}
          </ul>
        </article>
      </section>

      {error ? <aside className="error">{error}</aside> : null}
    </main>
  );
}

export default App;
