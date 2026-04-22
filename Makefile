.PHONY: compose-up compose-down backend-test build-frontend scan-v1-terms check-legacy eval-smoke eval-shadow release-gate canary-up canary-down

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

canary-up:
	docker compose --profile canary up --build backend-canary

canary-down:
	docker compose --profile canary rm -sf backend-canary

scan-v1-terms:
	@! rg -n "(Neo4j|neomodel|gemini-2\\.5|Socket\\.IO|他世界|NPC化|dispatch)" . \
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
