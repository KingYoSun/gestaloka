# Testplay Report Template

このテンプレートは、[testplay-runbook.md](testplay-runbook.md) または
[codex-browser-use-testplay.md](codex-browser-use-testplay.md) に沿った動作テスト・UX 評価の記録用です。

## 1. 実施情報

- 実施日時:
- 実施者 / Codex session:
- git commit:
- branch:
- `.env` provider 種別:
- stack 起動方法: `docker compose up --build`
- Browser Use 対象 URL:
  - Player UI:
  - Admin UI:
  - Backend health:
  - Langfuse:

## 2. 事前検証

| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| v2 verify | `make verify-v2` |  |  |
| shared world regressions | `make shared-world-regressions` |  |  |
| frontend e2e | `make frontend-e2e` |  |  |
| canary probe | `make canary-probe` |  |  |
| release checklist | `make release-checklist` |  |  |

## 3. Browser Use 実施結果

| Area | Target | Result | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Preflight | login / health / initial render |  |  |  |
| GESTALOKA Reference | reference smoke flow |  |  |  |
| Admin / Ops | catalog / projection / graph / SP / observability |  |  |  |
| Release Dry-run | release gate / runbook display |  |  |  |

Result values: `pass`, `fail`, `blocked`, `not run`.

## 4. UX 評価

| Area | Rating | Observation | Suggested change |
| --- | --- | --- | --- |
| Login |  |  |  |
| World select |  |  |  |
| Turn execution wait |  |  |  |
| Choice / free text switch |  |  |  |
| SP shortage recovery |  |  |  |
| Player streams readability |  |  |  |
| Admin information density |  |  |  |
| Error display |  |  |  |
| Responsive layout |  |  |  |
| Release gate readability |  |  |  |

Rating values: `good`, `acceptable`, `needs work`, `blocked`.

## 5. Bugs / Regressions

### Issue 1

- Severity:
- Status:
- Area:
- URL:
- World pack:
- Session id:
- Operation:
- Expected:
- Actual:
- Evidence:
- Reproduction steps:
- Suggested fix:

### Issue 2

- Severity:
- Status:
- Area:
- URL:
- World pack:
- Session id:
- Operation:
- Expected:
- Actual:
- Evidence:
- Reproduction steps:
- Suggested fix:

## 6. Commands Run

```bash
# Paste commands and final result summaries here.
```

## 7. Final Summary

- Overall result:
- Packs completed:
- Release readiness:
- Remaining risks:
- Follow-up tickets / tasks:
