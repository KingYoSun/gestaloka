# テストプレイレポート - Codex Playwright MCP live provider - 2026-04-29

## 1. 実施情報

- 実施日時: 2026-04-29 01:23:16 JST
- 実施者 / Codex session: Codex / Playwright MCP
- git commit: 86fa86742662972455544ee14ed96f94f3a4a734
- branch: main
- `.env` provider 種別: stack 実行時は `MODEL_PROVIDER=openai_compatible` / `EMBEDDING_PROVIDER=openai_compatible`。`make verify-v2` は stub provider。
- stack 起動方法: `docker compose up --build -d`
- Playwright MCP 対象 URL:
  - Player UI: http://localhost:5173
  - Admin UI: http://localhost:5174
  - Backend health: http://localhost:8000/health
  - Langfuse: http://localhost:3001
- 対象 bundled pack:
  - `GESTALOKA Reference / Nexus Foundation`

## 2. 事前検証

| 確認 | コマンド | 結果 | メモ |
| --- | --- | --- | --- |
| v2 公式検証 | `make verify-v2` | pass | backend 140 passed / 1 skipped。frontend E2E 2 passed。 |
| pack catalog | `make verify-v2` 内の `make pack-validate` | pass | `status=ready`、pack 1、template 1、failure 0。 |
| pack leak scan | `make verify-v2` 内の `make scan-pack-leaks` | pass | leak_count 0。 |
| shared-world regressions | `make verify-v2` 内の `make shared-world-regressions` | pass | 10 passed、shared-world health ready、drift_count 0。 |
| pack regressions | `make verify-v2` 内の `make eval-pack-regressions` | pass | stub provider では `turn_resolution_gestaloka_regression` passed。 |
| frontend E2E | `make verify-v2` 内の `make frontend-e2e` | pass | smoke と mobile overflow が pass。 |
| canary probe | `make canary-probe` | pass | canary healthy、graph ready。live provider の schema valid rate は 0.5。 |
| release checklist | `make release-checklist` | completed / blocked | report `0a76d332-2ec4-4cca-bbac-1059b804d50e`。smoke / failure injection / pack regression が failed。 |

## 3. Playwright MCP 実施結果

| 領域 | 対象 | 結果 | 証跡 | メモ |
| --- | --- | --- | --- | --- |
| Preflight | login / health / 初期描画 | pass | `artifacts/testplay-report-2026-04-29-codex-playwright-mcp-live-provider/gestaloka-health.png`, `gestaloka-player-initial.png`, `gestaloka-player-auth-ready.png` | health は status ok、database ok、projection ready、world packs ready。login 後に auth authenticated、SP 10、catalog ready。 |
| Player profile | profile 作成・選択 / start-session 無効状態 | pass | `gestaloka-player-auth-ready.png` | 既存の Demo Player を選択。profile 未入力時の create は disabled、profile 選択済みの start-session は enabled。 |
| GESTALOKA Reference | Nexus Gate から Oblivion Breach までの smoke flow | fail / blocked | `gestaloka-player-session-start.png`, `gestaloka-player-choice-progress-schema-error.png` | session 開始、Nexus Gate、First Stabilizer Request 0/2、Gate Steward Rikka、Lift Tower Concourse、faction standing は確認。最初の `choice-progress` で `lite_lane output failed schema validation` となり進行不能。 |
| Player state | quest / inventory / route / travel / relationship / world beats | partial / blocked | `gestaloka-player-session-start.png` | 初期 quest、route、relationship、inventory は表示。turn failure 後も quest は 0/2 のまま。 |
| Admin / Packs | dashboard / pack catalog / scaffold / archive import / publish status | fail | `gestaloka-admin-dashboard-token-audience-error.png` | Admin 画面と nav は表示されるが、API が `Unexpected token audience` で失敗し、KPI は unknown / 0。 |
| Admin / Config | users / LLM settings / model lanes / prompts / SP | fail | `gestaloka-admin-dashboard-token-audience-error.png` | 各 nav の `data-testid` は一意に存在。forms は表示されるがデータ取得は token audience error で不可。`admin-llm-settings` はこの状態では確認できなかった。 |
| Release Dry-run | canary / release gate / runbook 表示 | fail | `gestaloka-admin-release-token-audience-error.png` | CLI の checklist は blocked。Admin Release は token audience error のため latest report を表示できず、unknown / not run のまま。 |
| Responsive | desktop / 375x812 mobile | acceptable | `gestaloka-player-mobile-375.png`, `gestaloka-admin-mobile-375-release-error.png` | 375px で横スクロールなし。Admin nav の長いラベルは折り返すが重なりはない。 |

## 4. UX 評価

| 領域 | 評価 | 観察 | 改善案 |
| --- | --- | --- | --- |
| Login | acceptable | Player は Keycloak から復帰できる。Admin は画面復帰後に token audience error で管理データが読めない。 | Admin frontend 用 client/audience と backend の token validation 設定を揃える。 |
| World select | good | playable pack が自動選択され、catalog ready と SP が見える。 | なし。 |
| Player profile | good | 既存 profile 選択と開始前編集フォームは分かりやすい。 | start-session 直前の選択 profile と編集フォームの関係をもう少し明確にする。 |
| Turn execution wait | needs work | `choice-progress` が schema validation error で失敗し、次に何をすべきかは banner 文だけでは判断しにくい。 | error banner に対象 lane、再試行可否、fallback 有無を表示する。 |
| Choice / free text switch | acceptable | mode switch と choice list は見える。free text は今回の blocked flow では深掘り不可。 | failure 後に同じ choice を再送できるのか、別 choice へ戻るべきかを UI に出す。 |
| SP shortage recovery | acceptable | Player は SP が execution budget であることを明示。Admin SP は表示されるが token audience error で実データ不可。 | Admin 認証復旧後、SP adjustment と current balance の近接性を再評価する。 |
| Player streams readability | needs work | `ops-stream` と `npc-routine-stream` に raw JSON が長く露出する。通常画面の観測点として読みにくい。 | raw payload は折りたたみか debug view に分離する。 |
| Admin navigation | acceptable | 左サイドバーから対象画面へ移動でき、mobile でも横スクロールなし。 | mobile の `World Templates` / `Users & Permissions` は折り返し後の行高を少し広げる。 |
| Admin information density | blocked | token audience error のため KPI、一覧、詳細データを評価できない。 | Admin API 認証を直してから再評価する。 |
| Admin world-pack operations | blocked | pack 一覧、publish status、template 状態は token audience error で実データ不可。 | 同上。 |
| Error display | needs work | Player の schema error と Admin の token audience error は原因が短文だけで、操作者の次アクションが見えない。 | operation、request scope、retry/fallback guidance を含める。 |
| Responsive layout | acceptable | Player/Admin とも 375px で横スクロールなし。表示崩れや重なりは見えない。 | active session の長い stream と choice 実行後の mobile を再確認する。 |
| Release gate readability | blocked | CLI では blocked reasons が明確。Admin UI は latest report を読めず unknown。 | Admin Release は API error と保存済み report の有無を区別して表示する。 |

## 5. 不具合 / 回帰

### Issue 1

- 重大度: high
- 状態: open
- 領域: Player turn execution / live provider schema
- URL: http://localhost:5173
- world pack: GESTALOKA Reference
- world template: Nexus Foundation
- session id: `0f7b1459-3251-4e2b-bf6e-0b410084f35f`
- world id: `gestaloka_reference`
- 操作: Demo Player で session 開始後、`choice-progress` をクリック。
- 期待: First Stabilizer Request が 1/2 へ進み、次の choice が表示される。
- 実際: `lite_lane output failed schema validation`。quest は 0/2 のまま。backend は `POST /turns` を 422 で返す。
- 証跡: `artifacts/testplay-report-2026-04-29-codex-playwright-mcp-live-provider/gestaloka-player-choice-progress-schema-error.png`
- 再現手順:
  1. `docker compose up --build -d`
  2. Player UI に demo / demo-password で login
  3. GESTALOKA Reference / Demo Player で session 開始
  4. `choice-progress` をクリック
- 推奨修正: live provider の lane output を schema validation 前に記録し、`lite_lane` の schema contract、model設定、fallback policy を確認する。stub provider の `make verify-v2` は pass しているため、live provider 固有の出力不整合として切り分ける。

### Issue 2

- 重大度: high
- 状態: open
- 領域: Admin authentication / API authorization
- URL: http://localhost:5174
- world pack: n/a
- world template: n/a
- session id: n/a
- world id: n/a
- 操作: Admin UI を開き、Dashboard / Packs / Templates / Users / LLM / Lanes / Prompts / SP / Release を表示。
- 期待: admin-dashboard、pack status、template 数、release summary、各管理データが読める。
- 実際: 全体で `Unexpected token audience`。KPI は unknown / 0、Release は `Created: not run` のまま。`admin-llm-settings` は確認不能。
- 証跡: `artifacts/testplay-report-2026-04-29-codex-playwright-mcp-live-provider/gestaloka-admin-dashboard-token-audience-error.png`, `gestaloka-admin-release-token-audience-error.png`
- 再現手順:
  1. `docker compose up --build -d`
  2. Player で demo login 済み、または Admin UI で SSO login
  3. http://localhost:5174 を開く
  4. `admin-refresh` または各 nav をクリック
- 推奨修正: Admin frontend client の audience、Keycloak mapper、backend の expected audience を確認する。Player token を Admin API で使っていないかも確認する。

### Issue 3

- 重大度: high
- 状態: open
- 領域: Release dry-run / live provider gate
- URL: http://localhost:5174
- world pack: GESTALOKA Reference
- world template: Nexus Foundation
- session id: n/a
- world id: `gestaloka_reference`
- 操作: `make canary-up`、`make canary-probe`、`make release-checklist`。
- 期待: guide 上は Admin summary verdict が `passed`、canary promote status が ready 相当。
- 実際: report `0a76d332-2ec4-4cca-bbac-1059b804d50e` は `blocked`。blocked reasons は `smoke gate failed`、`failure injection gate failed`、`pack regression turn_resolution_gestaloka_regression failed`。shared-world health と shadow replay は pass。canary health は healthy。
- 証跡: CLI output、`artifacts/testplay-report-2026-04-29-codex-playwright-mcp-live-provider/gestaloka-admin-release-token-audience-error.png`
- 再現手順:
  1. 起動済み stack で `make canary-up`
  2. `make canary-probe`
  3. `make release-checklist`
- 推奨修正: failed run ids `1fe33b3d-2fd0-4553-a9ff-4e05efb8d1e7`、`91d8ed9a-76c7-41dd-ac7a-ee7527e3c662`、`abb7765c-190a-46d0-8784-3963383eb724` の case result を確認し、Issue 1 の schema validation failure と同じ live provider 問題か切り分ける。

### Issue 4

- 重大度: medium
- 状態: open
- 領域: Player ops/debug stream UX
- URL: http://localhost:5173
- world pack: GESTALOKA Reference
- world template: Nexus Foundation
- session id: `0f7b1459-3251-4e2b-bf6e-0b410084f35f`
- world id: `gestaloka_reference`
- 操作: session 開始後の streams を確認。
- 期待: `ops-stream` は `session.connected`、world pack 名、状態の概要を読みやすく表示し、不要な context を通常表示しない。
- 実際: `ops-stream` と一部 routine stream に JSON payload が長く露出する。
- 証跡: Playwright snapshot、`gestaloka-player-session-start.png`
- 再現手順:
  1. Player session を開始
  2. ページ下部の ops / routine streams を確認
- 推奨修正: raw JSON は collapsible detail または debug-only view に移す。

## 6. 実行コマンド

```bash
make verify-v2
docker compose up --build -d
docker compose ps
docker compose logs --tail=200 backend
make canary-up
make canary-probe
make release-checklist
make canary-down
```

## 7. 最終まとめ

- 総合結果: blocked。stub provider の公式検証は green だが、live provider stack の手動 testplay は Player turn execution と Admin API 認証でブロック。
- 完了した pack / template: GESTALOKA Reference / Nexus Foundation は session start まで。Oblivion Breach flow は未完了。
- release readiness: not ready。report `0a76d332-2ec4-4cca-bbac-1059b804d50e` は blocked、canary promote status は blocked。
- 残リスク: live provider schema validation、Admin audience mismatch、Admin Release が CLI report を読めないこと、raw JSON stream の可読性。
- follow-up ticket / task: live provider lane output の schema failure 調査、Admin token audience 設定修正、release failed run の case result 調査、ops/debug stream の表示整理。
