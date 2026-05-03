# Codex Playwright MCP Testplay Report - 2026-04-30

## 1. 実施情報

- 実施日時: 2026-04-30 01:04-01:35 JST
- 実施者 / Codex session: Codex / Playwright MCP fallback session
- git commit: `65e86bcc594a58b6beec2a2ed62cc142f6b254cd`
- branch: `main`
- `.env` provider 種別: `MODEL_PROVIDER=openai_compatible`, `EMBEDDING_PROVIDER=openai_compatible`, Langfuse enabled
- stack 起動方法: `docker compose up --build -d`
- Playwright MCP 対象 URL:
  - Player UI: `http://localhost:5173`
  - Admin UI: `http://localhost:5174`
  - Backend health: `http://localhost:8000/health`
  - Langfuse: `http://localhost:3001`
- 対象 bundled pack: `GESTALOKA World Reference / Layered World Foundation`
- 証跡ディレクトリ: `documents/testplay-reports/artifacts/testplay-report-2026-04-30-codex-playwright-mcp-testplay/`

## 2. 事前検証

| 確認 | コマンド | 結果 | メモ |
| --- | --- | --- | --- |
| v2 公式検証 | `make verify-v2` | fail | backend 161 passed / 1 skipped、pack validate ready、scan-pack-leaks 0、scan-v1-terms pass、shared-world ready、pack regression pass、frontend build pass。最後の `make frontend-e2e` で 1 fail。 |
| frontend E2E | `make frontend-e2e` via `make verify-v2` | fail | `sp-balance` が `unknown` のまま。backend log に `sp_accounts_pkey` duplicate key。 |
| MCP cleanup | `make playwright-mcp-clean`, `scripts/cleanup_playwright_mcp.sh --reset-profile` | pass | 残存 MCP process と profile を掃除。 |
| Backend health | `curl http://localhost:8000/health` | pass | `status=ok`, DB ok, graph runtime ready, world packs ready, SP ready。 |
| Canary probe | `make canary-up`, `make canary-probe` | pass | canary `healthy`, graph runtime ready。 |
| Release checklist | `make release-checklist` | fail | verdict `blocked`。`shadow_replay` timeout、`turn_resolution_gestaloka_regression` failed。 |
| Canary cleanup | `make canary-down` | pass | backend-canary container removed。 |

## 3. Playwright 実施結果

MCP tool は `Transport closed` が再発し、手順書の fallback に従って repo の Playwright API で観測した。

| 領域 | 対象 | 結果 | 証跡 | メモ |
| --- | --- | --- | --- | --- |
| Preflight | login / health / 初期描画 | pass | `player-01-initial.png`, `player-02-after-login.png` | JA/EN 切替、`html[lang]`、localStorage 永続化を確認。 |
| Player profile | profile 作成・選択 / start-session | pass | `player-03-profile-created.png` | 新規 profile 作成後、start session enabled。 |
| GESTALOKA World Reference | Nexus City から Oblivion Regions | pass | `player-turns-01-initial.png` - `player-turns-02-step-4.png` | `0/2` -> `2/2`、`Visitor Log Seal active/used`、`oblivion_survey`、`Oblivion Regions` 到達。 |
| Player state | quest / inventory / route / travel / relationship / beats | pass | `player-turns-result.json` | relationship が warm、world beats 更新、travel history に breach route。 |
| SP display / purchase | balance split / mock purchase | pass | `player-05-sp-purchase-dialog.png`, `player-06-sp-purchase-after.png` | 有償SP 0 -> 5、無償SP 30 unchanged。以後 turn 消費で無償SP 29 -> 25。 |
| Choice / free text | mode 切替 | pass | `player-progress-02-free-text.png` | `消費予定SP（自由入力）: 3`、入力欄 visible。 |
| Admin / Packs | dashboard / packs / templates | partial | `admin-02-dashboard.png`, `admin-03-admin-packs.png` | Packs では pack 1 件が読めるが Dashboard は pack status 不明 / 0 pack 表示。 |
| Admin / Config | users / LLM settings / lanes / prompts / SP | pass | `admin-03-admin-users.png`, `admin-03-admin-llm-settings.png`, `admin-03-admin-model-lanes.png`, `admin-03-admin-prompts.png`, `admin-03-admin-sp.png` | secret 本体ではなく参照名、app-level permission、SP adjustment を確認。 |
| Admin / Usage | LLM usage 24h / 30d | pass | `admin-03-admin-llm-usage.png`, `admin-04-llm-usage-30d.png` | KPI と表で読める。raw JSON dump ではない。 |
| Release Dry-run | canary / release gate / Admin release | fail | `admin-release-after-checklist.png`, `admin-release-after-checklist.json` | Admin でも `blocked` と blocked reasons を表示。 |
| Responsive | 375x812 mobile | pass | `admin-05-mobile-release-375.png` | Admin Release は horizontal overflow なし。Player mobile は初回 script 停止のため screenshot のみ。 |

## 4. UX 評価

| 領域 | 評価 | 観察 | 改善案 |
| --- | --- | --- | --- |
| Login | acceptable | Sign in から Keycloak login、復帰後 authenticated まで到達できる。 | hidden test surface は人間向けには見えないため、待機中の明示は UI 側の visible surface で十分か再確認する。 |
| Display language | good | Player/Admin とも JA/EN、`html[lang]`、`gestaloka.locale` 永続化を確認。 | なし。 |
| World select | good | playable pack 選択と profile 作成導線は分かる。 | なし。 |
| Player profile | good | profile 作成、play language `en` 保存、session start まで迷わない。 | 既存 profile が増えると選択欄の整理が必要になりそう。 |
| Play language | acceptable | 生成文は英語寄り、内部 ID / enum は未翻訳のまま。 | 表示言語とプレイ言語の違いは UI 上でやや暗黙的。短い補助があるとよい。 |
| Turn execution wait | acceptable | `進行中 / 解決中 / Ns` が出る。live provider では 1 turn が長い。 | 長時間時に現在の段階や retry 状態がもう少し分かるとよい。 |
| Choice / free text switch | good | mode と cost note が切り替わる。 | なし。 |
| SP display / purchase | good | 有償SP / 無償SP split、5段階選択、購入完了、有償SPのみ加算を確認。 | 購入完了後も dialog が残るため、次操作前に閉じる必要がある。完了後の primary action を「閉じる」に寄せると自然。 |
| SP cost tooltip | acceptable | 入力欄周辺は短く、長文説明にはなっていない。 | tooltip の自動検証は fallback script では未実施。 |
| Player streams readability | acceptable | ops/history/beats は機能するが、ops はイベントが詰まると密度が高い。 | event name と metadata の行間を少し増やすか、最新優先の区切りを強める。 |
| Admin navigation | good | 左 nav から全画面へ移動できる。 | なし。 |
| Admin information density | acceptable | raw dump ではなく KPI/表として読める。Prompts は量が多い。 | Prompts は検索/filter があると実運用で楽。 |
| Admin world-pack operations | acceptable | pack/template/publish status と scaffold/import 導線が見える。 | Dashboard と Packs の件数表示の不整合を直す。 |
| Error display | needs work | E2E の SP wallet 500 は Player UI では `unknown` になり、原因が追いにくい。 | wallet fetch 失敗時は error banner に対象操作と retry を出す。 |
| Responsive layout | good | Admin Release 375px は horizontal overflow なし。 | Player mobile は MCP fallback の途中停止があり full flow 未確認。 |
| Release gate readability | acceptable | Admin summary は blocked reasons を読める。CLI は詳細十分。 | Admin の「チェック詳細 なし」は blocked 時には弱い。check summaries の status だけでも表示するとよい。 |

## 5. 不具合 / 回帰

### Issue 1

- 重大度: high
- 状態: reproducible in `make verify-v2` / not reproduced in later single manual login
- 領域: SP wallet / frontend E2E
- URL: `http://localhost:5173`
- world pack: `GESTALOKA World Reference`
- 操作: `make verify-v2` の frontend E2E で demo login 後 `sp-balance` を待つ
- 期待: `SP balance: <number> / Paid: <number> / Bonus: <number>` が表示される
- 実際: `SP balance: unknown / Paid: unknown / Bonus: unknown` のまま timeout
- 証跡: `make verify-v2` output、backend log
- 再現手順:
  1. `make verify-v2`
  2. `gestaloka-reference-smoke.spec.ts` の login test が `sp-balance` で timeout
  3. backend log に `psycopg.errors.UniqueViolation`、`sp_accounts_pkey`、`user_sub=demo-player-sub`
- 推奨修正: `EconomyService._ensure_account` を concurrent-safe にする。PostgreSQL `INSERT ... ON CONFLICT DO NOTHING` または `IntegrityError` catch + rollback/refetch で初回 wallet 作成の race を吸収する。UI 側も wallet fetch 失敗を `unknown` だけにせず error banner に出す。

### Issue 2

- 重大度: high
- 状態: reproduced
- 領域: Release gate
- URL: Admin `http://localhost:5174`
- 操作: `make release-checklist`
- 期待: promote 条件 `verdict == passed and canary_promote_status == ready`
- 実際: `verdict=blocked`, `canary_promote_status=blocked`
- 証跡: `admin-release-after-checklist.png`, `admin-release-after-checklist.json`
- 再現手順:
  1. `make canary-up`
  2. `make canary-probe`
  3. `make release-checklist`
- 推奨修正: eval run `cd9f67f0-b1a2-41cb-a197-6a11e05da9c8` の `shadow_replay` timeout と、run `9ae13c74-01d7-4bd2-8021-8a5b42b985aa` の failed case `gestaloka-nexus-starter-progress` を切り分ける。

### Issue 3

- 重大度: medium
- 状態: reproduced
- 領域: Admin Dashboard
- URL: `http://localhost:5174`
- 操作: Admin login 後 Dashboard を表示
- 期待: pack status、pack 数 1、template 数 1、failure 0 相当が Dashboard KPI として読める
- 実際: Dashboard は `パック状態 不明 / 0 パック / テンプレート 0`。Packs 画面では `GESTALOKA World Reference` が表示される
- 証跡: `admin-02-dashboard.png`, `admin-03-admin-packs.png`
- 再現手順:
  1. Admin login
  2. Dashboard を確認
  3. Packs へ移動して件数/pack 表示と比較
- 推奨修正: `/admin/overview` の pack summary 取得元と fallback 表示を確認し、world pack catalog と同じ source of truth へ揃える。

## 6. 実行コマンド

```bash
make verify-v2
make playwright-mcp-clean
scripts/cleanup_playwright_mcp.sh --reset-profile
docker compose up --build -d
curl -sS http://localhost:8000/health
# Playwright MCP は Transport closed のため、frontend/node_modules の Playwright API で fallback 観測
make canary-up
make canary-probe
make release-checklist
make canary-down
```

## 7. 最終まとめ

- 総合結果: Player smoke と Admin 巡回は概ね pass。公式検証と release gate は fail。
- 完了した pack / template: `GESTALOKA World Reference / Layered World Foundation`
- release readiness: not ready。`verdict=blocked`, `canary_promote_status=blocked`
- 残リスク:
  - SP wallet 初期作成 race により E2E が不安定化する。
  - live provider の release checklist が `shadow_replay` timeout / pack regression fail。
  - Admin Dashboard の pack KPI が Packs 画面と不整合。
- follow-up task:
  - SP account ensure の concurrency hardening。
  - release gate failed run の詳細調査。
  - Admin overview の pack summary 修正。
