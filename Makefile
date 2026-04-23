.PHONY: compose-up compose-down backend-test build-frontend frontend-e2e verify-v2 scan-v1-terms check-legacy eval-smoke eval-shadow release-gate nightly-eval release-checklist canary-up canary-down canary-probe observability-up observability-down

COMPOSE ?= docker compose
VERIFY_COMPOSE_ENV = LANGFUSE_ENABLED=false OTEL_EXPORTER_OTLP_ENDPOINT= MODEL_PROVIDER=stub EMBEDDING_PROVIDER=stub

compose-up:
	$(COMPOSE) up --build

compose-down:
	$(COMPOSE) down -v --remove-orphans

backend-test:
	PYTHONPATH=backend python -m pytest tests/backend

build-frontend:
	$(COMPOSE) build frontend
	$(COMPOSE) run --rm --no-deps frontend npm run build

frontend-e2e:
	@set -eu; \
	$(COMPOSE) down -v --remove-orphans >/dev/null 2>&1 || true; \
	trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(VERIFY_COMPOSE_ENV) $(COMPOSE) build backend; \
	$(VERIFY_COMPOSE_ENV) $(COMPOSE) build frontend; \
	$(VERIFY_COMPOSE_ENV) $(COMPOSE) run --rm frontend-e2e

verify-v2:
	$(MAKE) backend-test
	$(MAKE) scan-v1-terms
	$(MAKE) check-legacy
	$(MAKE) build-frontend
	$(MAKE) frontend-e2e

eval-smoke:
	PYTHONPATH=backend python -m app.modules.eval_harness smoke

eval-shadow:
	PYTHONPATH=backend python -m app.modules.eval_harness shadow

release-gate:
	PYTHONPATH=backend python -m app.modules.eval_harness gate

nightly-eval:
	PYTHONPATH=backend python -m app.modules.eval_harness nightly

release-checklist:
	PYTHONPATH=backend python -m app.modules.eval_harness gate

canary-up:
	docker compose up --build backend-canary

canary-down:
	docker compose rm -sf backend-canary

canary-probe:
	PYTHONPATH=backend python -m app.modules.eval_harness canary-probe

observability-up:
	$(COMPOSE) up -d otel-collector prometheus grafana

observability-down:
	$(COMPOSE) rm -sf otel-collector prometheus grafana

scan-v1-terms:
	@! rg -n "(Neo4j|neomodel|Socket\\.IO|他世界|NPC化|dispatch)" . \
		--glob '!legacy/**' \
		--glob '!Makefile' \
		--glob '!AGENTS.md' \
		--glob '!rebuild_plan_v2.md' \
		--glob '!tests/e2e/**'

check-legacy:
	test -d legacy/v1/backend
	test -d legacy/v1/frontend
	test -d legacy/v1/documents
	test -f legacy/v1/README.md
