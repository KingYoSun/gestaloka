# GESTALOKA v2

GESTALOKA v2 is a same-world narrative MMO rebuild. The canonical store is PostgreSQL, world memory is retrieved through vector-friendly search, graph updates flow through an outbox projection pipeline, and every player/NPC action lives inside one `world_id` namespace.

The runtime is now being cut over from a single built-in setting to an engine/core plus declarative world packs model. The repo ships with a bundled reference pack (`founders_reach`) and a second sample pack used to keep the engine surface honest.

## Repository layout

- `legacy/v1/` archived v1 code and documents
- `backend/` FastAPI modular monolith for the v2 slice
- `frontend/` minimal React client for login, world start, turn play, and `/admin` ops visibility
- `documents/` v2-only docs and ADRs
- `packs/` bundled declarative world packs and templates
- `prompts/` prompt registry inputs for the model router
- `tests/` backend and E2E coverage for the new slice
- `rebuild_plan_v2.md` current rebuild plan and design reference

## Quick start

1. Copy `.env.example` to `.env`.
2. Start the stack with `docker compose up --build`.
3. Open `http://localhost:5173`.
4. Open `http://localhost:5173/admin` for the internal admin surface after login.
5. Open `http://localhost:3001` for Langfuse trace browsing.
5. Sign in with the demo Keycloak user:

```text
username: demo
password: demo-password
```

## Verification

- `PYTHONPATH=backend pytest tests/backend` verifies the backend slice directly.
- `make build-frontend` is the official frontend build path. It runs inside Docker/Compose instead of the host shell.
- `make frontend-e2e` is the official full-stack Playwright smoke path. It runs the Playwright smoke specs under `tests/e2e/` through Compose, waits for `backend` / `frontend` / `keycloak` readiness, and cleans the stack afterward.
- `make verify-v2` is the canonical local and CI verification entrypoint. It runs backend tests, v1 terminology checks, legacy layout checks, the containerized frontend build, and the containerized E2E smoke in order.
- `GET /worlds/packs` exposes the bundled pack and template catalog used by the session bootstrap UI.
- `make pack-export` and `make pack-import` move validated external world packs as `.tar.gz` artifacts; see [World Pack Operations](documents/world-pack-operations.md).
- Host `npm run build` remains a convenience path only. In mixed WSL/Windows environments it is non-authoritative and may fail even when the Compose verification path is healthy.

## Initial public interfaces

- `GET /health`
- `GET /auth/me`
- `GET /economy/sp/me`
- `GET /worlds/packs`
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
- LLM observability uses self-hosted Langfuse for prompt/generation/retrieval/eval traces, while OpenTelemetry remains the infra/metrics layer.
- The container-first verification targets (`make frontend-e2e`, `make verify-v2`) override model execution to the local `stub` provider and disable telemetry exports so verification does not depend on external AI or observability runtimes.
- The canonical embedding policy is fixed in [ADR-001](documents/adr/ADR-001-embedding-policy.md).
- Sessions start from a selected `pack_id` and `world_template_id`, then bootstrap a pack-defined starter location and projected `KNOWS` relation between the player and guide NPC.
- SP is an execution-budget ledger for API/runtime cost only. It is not an in-world currency and does not buy quest, faction, or item power.
- Successful requests consume SP, business-failed requests refund in-request, and `/admin` inspects execution budget separately from world progression.
- Reward items stay inside world progression through deterministic pack-defined world rules instead of purchase mechanics.
