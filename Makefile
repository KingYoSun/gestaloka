.PHONY: compose-up compose-down backend-test build-frontend scan-v1-terms check-legacy eval-smoke eval-shadow release-gate nightly-eval release-checklist canary-up canary-down canary-probe observability-up observability-down

compose-up:
	docker compose up --build

compose-down:
	docker compose down -v

backend-test:
	PYTHONPATH=backend pytest tests/backend

build-frontend:
	cd frontend && npm run build

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
	docker compose up -d otel-collector prometheus grafana

observability-down:
	docker compose rm -sf otel-collector prometheus grafana

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
