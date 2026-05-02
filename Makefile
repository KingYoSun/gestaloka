.PHONY: compose-up compose-down backend-test backend-test-engine backend-test-packs pack-list pack-validate pack-export pack-import scan-pack-leaks build-frontend build-player-frontend build-admin-frontend frontend-e2e swarm-test swarm-test-long verify-v2 verify-v2-profile scan-v1-terms eval-smoke eval-verify-db-reset eval-pack-regressions shared-world-regressions eval-shadow release-gate nightly-eval release-checklist canary-up canary-down canary-probe playwright-mcp-clean observability-up observability-down

COMPOSE ?= docker compose
VERIFY_ENV = LANGFUSE_ENABLED=false OTEL_EXPORTER_OTLP_ENDPOINT= MODEL_PROVIDER=stub EMBEDDING_PROVIDER=stub
VERIFY_COMPOSE_ENV = $(VERIFY_ENV)
PROMPT_DIR ?= $(CURDIR)/prompts
PACK_DIR ?= $(CURDIR)/packs
EVAL_DATASET_DIR ?= $(CURDIR)/evals/datasets
RELEASE_CONFIG_DIR ?= $(CURDIR)/config/release
VERIFY_V2_PROFILE ?= $(CURDIR)/.cache/verify-v2-profile.json
HOST_PATH_ENV = PROMPT_DIR=$(PROMPT_DIR) PACK_DIR=$(PACK_DIR) EVAL_DATASET_DIR=$(EVAL_DATASET_DIR) RELEASE_CONFIG_DIR=$(RELEASE_CONFIG_DIR)
HOST_VERIFY_ENV = $(VERIFY_ENV) $(HOST_PATH_ENV)
EVAL_VERIFY_DB ?= $(CURDIR)/.cache/eval-verify.db
EVAL_VERIFY_DATABASE_URL ?= sqlite:///$(EVAL_VERIFY_DB)
EVAL_VERIFY_ENV = $(HOST_VERIFY_ENV) DATABASE_URL=$(EVAL_VERIFY_DATABASE_URL) ALEMBIC_DATABASE_URL=$(EVAL_VERIFY_DATABASE_URL)

compose-up:
	$(COMPOSE) up --build

compose-down:
	$(COMPOSE) down -v --remove-orphans

backend-test:
	$(HOST_VERIFY_ENV) PYTHONPATH=backend python -m pytest tests/backend

backend-test-engine:
	$(HOST_VERIFY_ENV) PYTHONPATH=backend python -m pytest tests/backend/engine

backend-test-packs:
	$(HOST_VERIFY_ENV) PYTHONPATH=backend python -m pytest tests/backend/packs/gestaloka_reference

pack-list:
	$(HOST_PATH_ENV) PYTHONPATH=backend python -m app.modules.world_pack list

pack-validate:
	$(HOST_PATH_ENV) PYTHONPATH=backend python -m app.modules.world_pack validate

pack-export:
	@test -n "$(PACK_ID)" || (echo "PACK_ID is required" >&2; exit 1)
	@test -n "$(PACK_ARCHIVE)" || (echo "PACK_ARCHIVE is required" >&2; exit 1)
	$(HOST_PATH_ENV) PYTHONPATH=backend python -m app.modules.world_pack export --pack "$(PACK_ID)" --output "$(PACK_ARCHIVE)"

pack-import:
	@test -n "$(PACK_ARCHIVE)" || (echo "PACK_ARCHIVE is required" >&2; exit 1)
	$(HOST_PATH_ENV) PYTHONPATH=backend python -m app.modules.world_pack import --archive "$(PACK_ARCHIVE)"

scan-pack-leaks:
	$(HOST_PATH_ENV) PYTHONPATH=backend python -m app.modules.world_pack scan-leaks

build-frontend:
	$(MAKE) build-player-frontend
	$(MAKE) build-admin-frontend

build-player-frontend:
	$(COMPOSE) build player-frontend
	$(COMPOSE) run --rm --no-deps player-frontend npm run build

build-admin-frontend:
	$(COMPOSE) build admin-frontend
	$(COMPOSE) run --rm --no-deps admin-frontend npm run build

frontend-e2e:
	@set -eu; \
	$(COMPOSE) down -v --remove-orphans >/dev/null 2>&1 || true; \
	trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(VERIFY_COMPOSE_ENV) $(COMPOSE) build backend; \
	$(VERIFY_COMPOSE_ENV) $(COMPOSE) build player-frontend; \
	$(VERIFY_COMPOSE_ENV) $(COMPOSE) build admin-frontend; \
	$(VERIFY_COMPOSE_ENV) COMPOSE_PROFILES=e2e E2E_SPEC="$(E2E_SPEC)" $(COMPOSE) run --rm frontend-e2e

swarm-test:
	@set -eu; \
	run_id="$${SWARM_RUN_ID:-$$(date -u +%Y-%m-%dT%H-%M-%SZ)}"; \
	run_group_id="$${SWARM_RUN_GROUP_ID:-$$(git rev-parse --short=12 HEAD)}"; \
	run_group_dir="$${SWARM_RUN_GROUP_DIR:-/workspace/documents/testplay-reports/artifacts/swarm-test-commit-$$run_group_id}"; \
	artifact_dir="$${SWARM_ARTIFACT_DIR:-$$run_group_dir/swarm-test-$$run_id}"; \
	echo "SWARM_RUN_ID=$$run_id"; \
	echo "SWARM_RUN_GROUP_ID=$$run_group_id"; \
	echo "SWARM_RUN_GROUP_DIR=$$run_group_dir"; \
	echo "SWARM_ARTIFACT_DIR=$$artifact_dir"; \
	echo "SWARM_TEST_MODE=$${SWARM_TEST_MODE:-short}"; \
	COMPOSE_PROFILES=e2e E2E_SPEC="../tests/e2e/swarm-test.spec.ts" SWARM_RUN_ID="$$run_id" SWARM_RUN_GROUP_ID="$$run_group_id" SWARM_RUN_GROUP_DIR="$$run_group_dir" SWARM_ARTIFACT_DIR="$$artifact_dir" SWARM_TEST_MODE="$${SWARM_TEST_MODE:-short}" SWARM_PERSONA_IDS="$${SWARM_PERSONA_IDS:-}" SWARM_PERSONA_SEED="$${SWARM_PERSONA_SEED:-}" SWARM_TURN_TIMEOUT_MS="$${SWARM_TURN_TIMEOUT_MS:-600000}" SWARM_TEST_TIMEOUT_MS="$${SWARM_TEST_TIMEOUT_MS:-1800000}" SWARM_POLL_TIMEOUT_MS="$${SWARM_POLL_TIMEOUT_MS:-120000}" SWARM_JUDGE_ENABLED="$${SWARM_JUDGE_ENABLED:-true}" SWARM_JUDGE_MODEL_ID="$${SWARM_JUDGE_MODEL_ID:-}" SWARM_JUDGE_TIMEOUT_MS="$${SWARM_JUDGE_TIMEOUT_MS:-120000}" SWARM_EXPERIENCE_WARNING_THRESHOLD="$${SWARM_EXPERIENCE_WARNING_THRESHOLD:-3}" $(COMPOSE) run --rm frontend-e2e

swarm-test-long:
	$(MAKE) swarm-test SWARM_TEST_MODE=long

verify-v2:
	$(MAKE) backend-test
	$(MAKE) pack-validate
	$(MAKE) scan-pack-leaks
	$(MAKE) scan-v1-terms
	$(MAKE) shared-world-regressions
	$(MAKE) eval-pack-regressions
	$(MAKE) build-frontend
	$(MAKE) frontend-e2e

verify-v2-profile:
	python scripts/verify_v2_profile.py --output "$(VERIFY_V2_PROFILE)"

eval-smoke:
	PYTHONPATH=backend python -m app.modules.eval_harness smoke

eval-verify-db-reset:
	mkdir -p $(dir $(EVAL_VERIFY_DB))
	rm -f $(EVAL_VERIFY_DB)
	cd backend && $(EVAL_VERIFY_ENV) alembic upgrade head

eval-pack-regressions: eval-verify-db-reset
	$(EVAL_VERIFY_ENV) PYTHONPATH=backend python -m app.modules.eval_harness pack-regressions

shared-world-regressions: eval-verify-db-reset
	$(HOST_VERIFY_ENV) PYTHONPATH=backend python -m pytest tests/backend/engine/test_world_slice.py tests/backend/packs/gestaloka_reference/test_gestaloka_reference_pack.py
	$(EVAL_VERIFY_ENV) PYTHONPATH=backend python -m app.modules.eval_harness shared-world-health

eval-shadow:
	PYTHONPATH=backend python -m app.modules.eval_harness shadow

release-gate:
	PYTHONPATH=backend python -m app.modules.eval_harness gate

nightly-eval:
	PYTHONPATH=backend python -m app.modules.eval_harness nightly

release-checklist:
	$(COMPOSE) exec -T -e RELEASE_CHECK_TIMEOUT_SECONDS=300 -e RELEASE_CHECK_TOTAL_BUDGET_SECONDS=900 -e OTEL_EXPORTER_OTLP_ENDPOINT= -e OTEL_METRICS_PORT=0 backend python -m app.modules.eval_harness gate

canary-up:
	$(COMPOSE) up --build -d backend-canary
	@set -eu; \
	cid="$$( $(COMPOSE) ps -q backend-canary )"; \
	for attempt in $$(seq 1 60); do \
		status="$$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$$cid" 2>/dev/null || true)"; \
		if [ "$$status" = "healthy" ]; then \
			echo "backend-canary is healthy"; \
			exit 0; \
		fi; \
		if [ "$$status" = "exited" ] || [ "$$status" = "dead" ]; then \
			$(COMPOSE) logs --tail=80 backend-canary; \
			exit 1; \
		fi; \
		sleep 2; \
	done; \
	$(COMPOSE) logs --tail=80 backend-canary; \
	echo "backend-canary did not become healthy" >&2; \
	exit 1

canary-down:
	$(COMPOSE) rm -sf backend-canary

canary-probe:
	$(COMPOSE) exec -T -e OTEL_EXPORTER_OTLP_ENDPOINT= -e OTEL_METRICS_PORT=0 backend python -m app.modules.eval_harness canary-probe

playwright-mcp-clean:
	scripts/cleanup_playwright_mcp.sh

observability-up:
	$(COMPOSE) up -d otel-collector prometheus grafana

observability-down:
	$(COMPOSE) rm -sf otel-collector prometheus grafana

scan-v1-terms:
	@! rg -n "(Neo4j|neomodel|Socket\\.IO|他世界|NPC化|dispatch)" . \
		--glob '!Makefile' \
		--glob '!AGENTS.md' \
		--glob '!documents/archive/**' \
		--glob '!rebuild_plan_v2.md' \
		--glob '!tests/e2e/**'
