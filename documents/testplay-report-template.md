# テストプレイレポートテンプレート

このテンプレートは、[testplay-runbook.md](testplay-runbook.md) または
[codex-playwright-mcp-testplay.md](codex-playwright-mcp-testplay.md) に沿った手動テストプレイ、Playwright MCP 確認、UX 評価の記録用です。

## 1. 実施情報

- 実施日時:
- 実施者 / Codex session:
- git commit:
- branch:
- `.env` provider 種別:
- stack 起動方法: `docker compose up --build`
- Playwright MCP 対象 URL:
  - Player UI:
  - Admin UI:
  - Backend health:
  - Langfuse:
- 対象 bundled pack:
  - `GESTALOKA World Reference / Layered World Foundation`

## 2. 事前検証

| 確認 | コマンド | 結果 | メモ |
| --- | --- | --- | --- |
| v2 公式検証 | `make verify-v2` |  | backend / pack / leak scan / v1 term scan / legacy check / shared-world / pack regression / frontend build / E2E |
| pack catalog | `make pack-validate` |  | `status=ready`、`failure_count=0` を確認 |
| pack leak scan | `make scan-pack-leaks` |  | engine/frontend runtime への bundled pack 固有語混入を確認 |
| shared-world regressions | `make shared-world-regressions` |  | shared-world health と pack smoke を確認 |
| pack regressions | `make eval-pack-regressions` |  | `turn_resolution_gestaloka_regression` を確認 |
| frontend E2E | `make frontend-e2e` |  | `gestaloka-reference-smoke.spec.ts` と mobile overflow を確認 |
| canary probe | `make canary-probe` |  | `make canary-up` 後に実行 |
| release checklist | `make release-checklist` |  | compose stack の `backend` container 内で gate を実行 |

結果値: `pass`, `fail`, `blocked`, `not run`。

## 3. Playwright MCP 実施結果

| 領域 | 対象 | 結果 | 証跡 | メモ |
| --- | --- | --- | --- | --- |
| Preflight | login / health / 初期描画 |  |  |  |
| Player profile | profile 作成・選択 / start-session 無効状態 |  |  |  |
| GESTALOKA World Reference | Nexus City から Oblivion Regions までの smoke flow |  |  |  |
| Player state | quest / inventory / route / travel / relationship / world beats |  |  |  |
| Admin / Packs | dashboard / pack catalog / scaffold / archive import / publish status |  |  |  |
| Admin / Config | users / LLM settings / model lanes / prompts / SP |  |  |  |
| Release Dry-run | canary / release gate / runbook 表示 |  |  |  |
| Responsive | desktop / 375x812 mobile |  |  |  |

## 4. UX 評価

| 領域 | 評価 | 観察 | 改善案 |
| --- | --- | --- | --- |
| Login |  |  |  |
| World select |  |  |  |
| Player profile |  |  |  |
| Turn execution wait |  |  |  |
| Choice / free text switch |  |  |  |
| SP shortage recovery |  |  |  |
| Player streams readability |  |  |  |
| Admin navigation |  |  |  |
| Admin information density |  |  |  |
| Admin world-pack operations |  |  |  |
| Error display |  |  |  |
| Responsive layout |  |  |  |
| Release gate readability |  |  |  |

評価値: `good`, `acceptable`, `needs work`, `blocked`。

## 5. 不具合 / 回帰

### Issue 1

- 重大度:
- 状態:
- 領域:
- URL:
- world pack:
- world template:
- session id:
- world id:
- 操作:
- 期待:
- 実際:
- 証跡:
- 再現手順:
- 推奨修正:

### Issue 2

- 重大度:
- 状態:
- 領域:
- URL:
- world pack:
- world template:
- session id:
- world id:
- 操作:
- 期待:
- 実際:
- 証跡:
- 再現手順:
- 推奨修正:

## 6. 実行コマンド

```bash
# 実行したコマンドと最終結果の要約を貼る。
```

## 7. 最終まとめ

- 総合結果:
- 完了した pack / template:
- release readiness:
- 残リスク:
- follow-up ticket / task:
