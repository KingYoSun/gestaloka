.PHONY: compose-up compose-down backend-test build-frontend scan-v1-terms check-legacy

compose-up:
	docker compose up --build

compose-down:
	docker compose down -v

backend-test:
	PYTHONPATH=backend pytest tests/backend

build-frontend:
	cd frontend && npm run build

scan-v1-terms:
	@rg -n "(Neo4j|neomodel|gemini-2\\.5|Socket\\.IO|他世界|NPC化|dispatch)" . \
		--glob '!legacy/**' \
		--glob '!Makefile' \
		--glob '!rebuild_plan_v2.md' \
		--glob '!tests/e2e/**'

check-legacy:
	test -d legacy/v1/backend
	test -d legacy/v1/frontend
	test -d legacy/v1/documents
	test -f legacy/v1/README.md
