# Testplay Report - Codex Playwright MCP - 2026-04-28

## 1. 実施情報

- 実施日時: 2026-04-28T06:53:33+09:00
- 実施者 / Codex session: Codex / Playwright MCP
- git commit: 40bf3ad959b4a3e0ba9da666eded4b40303c6eca
- branch: main
- `.env` provider 種別: stack runtime uses configured `.env`; verification used stub providers where noted
- stack 起動方法: `docker compose down -v --remove-orphans && docker compose up --build -d`
- Playwright MCP 対象 URL:
  - Player UI: http://localhost:5173
  - Admin UI: http://localhost:5173/admin
  - Backend health: http://localhost:8000/health
  - Langfuse: http://localhost:3001

## 2. 事前検証

| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| v2 verify | `make verify-v2` | pass | backend 117 passed / 1 skipped; shared-world regressions 10 passed; frontend build pass; frontend e2e pass |
| shared world regressions | included in `make verify-v2` | pass | status ready, drift_count 0 |
| frontend e2e | included in `make verify-v2` | pass | GESTALOKA reference smoke spec passed |
| canary probe | `CANARY_HEALTH_URL=http://localhost:8001/health ... python -m app.modules.eval_harness canary-probe` | pass | vanilla `make canary-probe` from host failed because `backend-canary` is a compose-internal hostname |
| release checklist | host env override + `python -m app.modules.eval_harness gate` | completed / blocked | verdict `blocked`; reason `shadow replay gate failed` |

## 3. Playwright MCP 実施結果

| Area | Target | Result | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Preflight | login / health / initial render | pass with issue | `artifacts/testplay/01-backend-health.png`, `09-clean-player-initial.png`, `10-clean-login-page.png`, `11-clean-authenticated.png` | health ok; login ok; SP 10; catalog ready. Initial signed-out render shows Keycloak init error banner. |
| GESTALOKA Reference | reference smoke flow | pass | `12-clean-session-started.png`, `13-after-two-progress.png`, `14-after-writ-use.png`, `15-after-oblivion-travel.png` | Confirmed session.connected, Nexus Gate, First Stabilizer Request 0/2, Rikka, Lift Tower Concourse, 2/2, Nexus Writ, Breach Restoration, writ used, Oblivion Breach travel. |
| Admin / Ops | catalog / projection / graph / SP / observability | pass with note | `16-admin-initial.png`, `17-admin-idle-pass.png` | catalog ready, packs 1/templates 1/failures 0, graph/embedding/langfuse ready, projection not accumulating failures, SP ledger shows turn costs. `world-tick-stream` remained empty; NPC location and ambient beat streams reflected state. |
| Release Dry-run | release gate / runbook display | fail | `18-admin-release-after-checklist.png` | Checklist completed but release gate is blocked by shadow replay failures. Pack regression passed and runbook commands are displayed. |

Result values: `pass`, `fail`, `blocked`, `not run`.

## 4. UX 評価

| Area | Rating | Observation | Suggested change |
| --- | --- | --- | --- |
| Login | acceptable | Sign-in path works, but an error banner may appear before/after auth. | Suppress or fix duplicate Keycloak init so login does not look failed. |
| World select | good | Playable pack is clear and auto-selects when available. | None. |
| Turn execution wait | acceptable | Long waits complete and button re-enables; double submit was not observed. | Add a more visible progress state for 20-90s turn waits. |
| Choice / free text switch | acceptable | Choice controls are usable; free text mode presence is clear. | Keep mode controls near submit area on long pages. |
| SP shortage recovery | acceptable | SP is clearly labeled execution budget, not in-world currency. | Admin replenishment fields could be grouped closer to SP overview. |
| Player streams readability | acceptable | Streams expose useful state but long choice/narrative text makes scanning hard. | Truncate dense choice rationale or separate metadata from action labels. |
| Admin information density | acceptable | Dense but usable for ops; many streams are visible in one page. | Add section anchors or sticky compact scope summary. |
| Error display | needs work | Keycloak duplicate init error appears even when flow can continue. | Treat as a bug; avoid showing recoverable auth init races as global error. |
| Responsive layout | not run | Desktop viewport only in this pass. | Add a mobile MCP pass. |
| Release gate readability | good | Blocked reason, missing check, shadow failures, pack regression, and runbook are visible. | None. |

Rating values: `good`, `acceptable`, `needs work`, `blocked`.

## 5. Bugs / Regressions

### Issue 1

- Severity: medium
- Status: open
- Area: Player/Admin auth initialization
- URL: http://localhost:5173 and http://localhost:5173/admin
- World pack: GESTALOKA Reference
- Session id: c9cdaed2-6e9b-42f6-930c-60387d9b89ee
- Operation: open Player UI, login, navigate Admin
- Expected: no global error banner during normal auth flow
- Actual: `Error: A 'Keycloak' instance can only be initialized once.`
- Evidence: `artifacts/testplay/09-clean-player-initial.png`, `11-clean-authenticated.png`, `18-admin-release-after-checklist.png`
- Reproduction steps: clear browser storage; open http://localhost:5173; observe `error-banner`; login with demo credentials; navigate to Admin and observe possible recurrence
- Suggested fix: guard `keycloak.init()` against React StrictMode double effect execution or move initialization behind a singleton init promise

### Issue 2

- Severity: high
- Status: open
- Area: Release dry-run
- URL: http://localhost:5173/admin
- World pack: GESTALOKA Reference
- Session id: c9cdaed2-6e9b-42f6-930c-60387d9b89ee
- Operation: run pre-promote release checklist
- Expected: guide expects `release-gate-verdict` passed and promote ready
- Actual: verdict `blocked`; missing/failed check `shadow_replay`; blocked reason `shadow replay gate failed`
- Evidence: `artifacts/testplay/18-admin-release-after-checklist.png`
- Reproduction steps: run canary, run release checklist with host path/env overrides, refresh Admin release gate
- Suggested fix: inspect shadow replay failures with degraded graph/retrieval context for generated shadow cases and decide whether gate criteria or retrieval setup is wrong

### Issue 3

- Severity: medium
- Status: open
- Area: Release dry-run commands
- URL: terminal
- World pack: GESTALOKA Reference
- Session id: n/a
- Operation: run `make canary-up && make canary-probe && make release-checklist && make canary-down` from host
- Expected: runbook commands complete in sequence
- Actual: `make canary-up` attaches in foreground; vanilla `make canary-probe` cannot resolve `backend-canary`; vanilla `make release-checklist` cannot resolve `postgres`
- Evidence: terminal output in Codex session
- Reproduction steps: execute the command chain from the repository root on the host
- Suggested fix: make canary-up detached or document split-shell behavior; use host-safe defaults or compose-run wrappers for probe/checklist

## 6. Commands Run

```bash
make verify-v2
docker compose down -v --remove-orphans && docker compose up --build -d
docker compose stop frontend-e2e || true
docker compose rm -f frontend-e2e || true
curl http://localhost:8000/health
make canary-up
make canary-probe
make release-checklist
CANARY_HEALTH_URL=http://localhost:8001/health DATABASE_URL=postgresql+psycopg://gestaloka:gestaloka@localhost:5432/gestaloka ALEMBIC_DATABASE_URL=postgresql+psycopg://gestaloka:gestaloka@localhost:5432/gestaloka PYTHONPATH=backend python -m app.modules.eval_harness canary-probe
LANGFUSE_ENABLED=false OTEL_EXPORTER_OTLP_ENDPOINT= MODEL_PROVIDER=stub EMBEDDING_PROVIDER=stub PROMPT_DIR=/home/kingyosun/gestaloka/prompts PACK_DIR=/home/kingyosun/gestaloka/packs EVAL_DATASET_DIR=/home/kingyosun/gestaloka/evals/datasets RELEASE_CONFIG_DIR=/home/kingyosun/gestaloka/config/release DATABASE_URL=postgresql+psycopg://gestaloka:gestaloka@localhost:5432/gestaloka ALEMBIC_DATABASE_URL=postgresql+psycopg://gestaloka:gestaloka@localhost:5432/gestaloka CANARY_HEALTH_URL=http://localhost:8001/health PYTHONPATH=backend python -m app.modules.eval_harness gate
make canary-down
```

## 7. Final Summary

- Overall result: Player and Admin exploratory testplay passed; Release Dry-run failed because gate is blocked.
- Packs completed: GESTALOKA Reference / Nexus Foundation player smoke flow completed through Oblivion Breach travel.
- Release readiness: not ready; `shadow_replay` failed, `canary_promote_status` blocked.
- Remaining risks: Keycloak init error banner, release command host/compose mismatch, shadow replay degraded retrieval/graph context, mobile layout not run.
- Follow-up tickets / tasks: fix Keycloak singleton init; make release runbook commands executable from host; investigate shadow replay degraded cases; add mobile Playwright MCP pass.
