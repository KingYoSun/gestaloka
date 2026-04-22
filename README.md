# GESTALOKA v2

GESTALOKA v2 is a same-world narrative MMO rebuild. The canonical store is PostgreSQL, world memory is retrieved through vector-friendly search, graph updates flow through an outbox projection pipeline, and every player/NPC action lives inside one `world_id` namespace.

## Repository layout

- `legacy/v1/` archived v1 code and documents
- `backend/` FastAPI modular monolith for the v2 slice
- `frontend/` minimal React client for login, world start, turn play, and `/admin` ops visibility
- `documents/` v2-only docs and ADRs
- `prompts/` prompt registry inputs for the model router
- `tests/` backend and E2E coverage for the new slice
- `rebuild_plan_v2.md` current rebuild plan and design reference

## Quick start

1. Copy `.env.example` to `.env`.
2. Start the stack with `docker compose up --build`.
3. Open `http://localhost:5173`.
4. Open `http://localhost:5173/admin` for the internal admin surface after login.
5. Sign in with the demo Keycloak user:

```text
username: demo
password: demo-password
```

## Initial public interfaces

- `GET /health`
- `GET /auth/me`
- `GET /economy/sp/me`
- `POST /sessions`
- `POST /turns`
- `GET /worlds/{world_id}/events`
- `GET /worlds/{world_id}/memories`
- `WS /ws/sessions/{session_id}?token=<access_token>`

## Internal ops interfaces

- `GET /ops/projection/status`
- `POST /ops/projection/rebuild`
- `GET /ops/worlds/{world_id}/graph-summary`
- `GET /ops/sp/overview`
- `GET /ops/sp/ledger`
- `POST /ops/sp/adjustments`

## Notes

- v1 assets are frozen under `legacy/v1/` and are not imported by v2.
- The graph projection path is outbox-driven. The standard compose stack now targets NebulaGraph, while lightweight test settings still use the recording backend.
- Runtime stabilization for NebulaGraph includes an init step that registers the storage host before backend and projection worker start.
- Sessions start with a canonical starter location and a projected `KNOWS` relation between the player and guide NPC.
- Phase E adds an SP wallet and append-only ledger: successful turns consume SP, business-failed turns refund in-request, and `/admin` can inspect and adjust balances.
