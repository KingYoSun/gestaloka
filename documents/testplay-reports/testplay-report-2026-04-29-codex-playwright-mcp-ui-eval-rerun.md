# テストプレイレポート - Codex UI eval rerun - 2026-04-29

## 1. 実施情報

- 実施日時: 2026-04-29T16:31+09:00 - 2026-04-29T17:07+09:00
- 実施者 / Codex session: Codex
- git commit: `e538921`
- branch: `main`
- `.env` provider 種別: stack は既存 `.env` を使用。health 上は `MODEL_PROVIDER=openai_compatible`、embedding `openai_compatible / gemini-embedding-001`、Langfuse enabled。`make verify-v2` は stub provider。
- stack 起動方法: `docker compose up --build -d`
- Playwright 対象 URL:
  - Player UI: http://localhost:5173
  - Admin UI: http://localhost:5174
  - Backend health: http://localhost:8000/health
  - Langfuse: http://localhost:3001
- 対象 bundled pack:
  - `GESTALOKA Reference / Nexus Foundation`
- 証跡ディレクトリ:
  - `documents/testplay-reports/artifacts/testplay-report-2026-04-29-codex-playwright-mcp-ui-eval-rerun/`
- 実施上の制約:
  - Playwright MCP は既存 Chrome profile lock で開始できず、lock 解放時に MCP transport が閉じたため、以降は同じ操作列を `frontend` の Playwright CLI/Node で代替実施した。

## 2. 事前検証

| 確認 | コマンド | 結果 | メモ |
| --- | --- | --- | --- |
| v2 公式検証 | `make verify-v2` | pass | backend `155 passed, 1 skipped`、pack validate ready、pack leak 0、v1 term scan pass、shared-world regressions pass、pack regressions passed、player/admin frontend build pass、frontend E2E 3 passed。 |
| pack catalog | `make pack-validate` | pass | `make verify-v2` 内で実行。`status=ready`、`pack_count=1`、`template_count=1`、`failure_count=0`。 |
| pack leak scan | `make scan-pack-leaks` | pass | `make verify-v2` 内で実行。`leak_count=0`。 |
| shared-world regressions | `make shared-world-regressions` | pass | `make verify-v2` 内で実行。shared-world health ready。 |
| pack regressions | `make eval-pack-regressions` | pass | `turn_resolution_gestaloka_regression` passed。 |
| frontend E2E | `make frontend-e2e` | pass | `gestaloka-reference-smoke.spec.ts` 3 passed。 |
| backend health | `curl -fsS http://localhost:8000/health` | pass | database ok、projection ready、world packs ready、SP `execution_only`、Langfuse ready。 |
| canary probe | `make canary-probe` | pass | canary healthy、graph ready、release verdict は実行前 blocked。 |
| release checklist | `make release-checklist` | fail | `report_id=f020c40b-a293-49cf-a6ae-8a48ebef29e8`。turn / shadow checks が timeout、budget exhausted により verdict blocked。 |

## 3. Playwright 実施結果

| 領域 | 対象 | 結果 | 証跡 | メモ |
| --- | --- | --- | --- | --- |
| Preflight | health / 初期描画 / login | pass | `player-initial.png`, `player-authenticated.png` | Player login ok。`auth-status=authenticated`、SP `10`、SP note は execution budget。 |
| Display language | Player JA/EN 切替 | pass | `player-initial.png` | `sign-in` 文言、`html[lang]`、`localStorage["gestaloka.locale"]` が reload 後も保持。 |
| Player profile | profile 作成 / play language | pass | `player-authenticated.png` | `Codex Testplay 20260429` を English profile として作成。 |
| GESTALOKA Reference | Nexus Gate から Oblivion Breach まで | pass | `player-session-start.png`, `player-choice-progress-1.png`, `player-choice-progress-2.png`, `player-breach-restoration.png`, `player-oblivion-breach.png` | `Nexus Gate`、`First Stabilizer Request 0/2 -> 2/2`、`Nexus Writ used`、`Breach Restoration`、`breach_restoration`、`Oblivion Breach` 到達を確認。 |
| Player state | quest / inventory / route / travel / relationship / world beats | pass | `player-oblivion-breach.png` | travel history、relationship summary、world beats 更新を確認。ops stream は `session.connected` と pack 名を表示し、raw JSON dump はなし。 |
| Choice / free text | mode 切替 / input / submit | pass | `player-free-text-mode.png` | free text input と submit が表示。入力後 submit enabled。 |
| Admin / Packs | dashboard / pack catalog / template | pass | `admin-dashboard.png`, `admin-packs.png`, `admin-world-templates.png` | pack ready、1 pack、template 1、failure 0、`GESTALOKA Reference` と `Nexus Foundation playable` を確認。 |
| Admin / Config | users / LLM settings / model lanes / prompts / SP | pass | `admin-users.png`, `admin-llm-settings.png`, `admin-model-lanes.png`, `admin-prompts.png`, `admin-sp.png` | Users は app-level permission 管理。LLM は secret/env ref のみ。lanes/prompts は編集導線あり。SP は adjustment 画面。 |
| Admin navigation | side nav / data-testid uniqueness | pass | `admin-dashboard.png` ほか | Dashboard、Packs、World Templates、Users、LLM、Model Lanes、Prompts、SP、Release を順に表示確認。 |
| Release Dry-run | canary / release gate / Admin summary | fail expected | `admin-release-after-dry-run.png` | CLI verdict blocked。Admin Release は created timestamp と check ごとの timeout reason / run id を表示。 |
| Responsive | Player/Admin 375x812 | pass | `player-mobile-375.png`, `admin-mobile-375.png` | Player/Admin とも `scrollWidth=375`、横スクロールなし。 |

## 4. UX 評価

| 領域 | 評価 | 観察 | 改善案 |
| --- | --- | --- | --- |
| Login | acceptable | Player login は明確。Admin は未認証ページに login CTA があり、Player SSO 済み context では自然に dashboard へ入れた。直接 Admin login でも Keycloak form へ遷移することを追加確認。 | Admin 未認証画面には locale switcher がないため、未認証状態でも JA/EN を切り替えたいなら追加する。 |
| Display language | good | Player/Admin ともログイン後は JA/EN、`html[lang]`、reload 後永続化が一貫。 | なし。 |
| World select | good | playable pack の選択肢と session pack 表示が分かりやすい。 | なし。 |
| Player profile | good | profile 作成、play language 選択、session start まで迷いにくい。 | start 前に選択中 profile の play language をより目立たせると誤選択を減らせる。 |
| Play language | acceptable | English profile で narrative / choices は概ね English。schema enum、id、stage key は翻訳されない。 | 固定 UI 言語と play language の違いを profile 周辺で短く補強するとよい。 |
| Turn execution wait | acceptable | 実行中は `進行中` になり二重送信しにくい。完了後に次 choice が enabled になる。 | 長い turn に備え、elapsed / current phase を action area に出す。 |
| Choice / free text switch | acceptable | mode 切替、入力、submit の関係は理解できる。 | free text の cost が高いことを submit 近くにも出すと SP 消費が分かりやすい。 |
| SP shortage recovery | acceptable | SP は execution budget として表示され、世界内報酬や quest 進行力には見えない。Admin SP adjustment も管理操作として読める。 | Admin SP で現在の user/world を player session からコピーしやすい導線があると復旧が速い。 |
| Player streams readability | acceptable | quest、inventory、relationship、beats、travel history は読める。ops は raw dump ではない。 | streams が長くなった時の折りたたみや filter があると読み返しやすい。 |
| Admin navigation | good | 左サイドバーから各管理画面に迷わず移動できる。 | なし。 |
| Admin information density | good | KPI、一覧、フォームが raw dump ではなく管理画面として整理されている。 | なし。 |
| Admin world-pack operations | acceptable | pack scaffold、archive import、publish status の導線が見える。 | publish 変更などは確認 dialog と変更履歴があると安全。 |
| Error display | acceptable | Release blocked reasons は Admin で読める。通常画面に raw trace / projection internals dump はない。 | Release の長い timeout reason は check 別 card にして、原因と次操作を分離するとよい。 |
| Responsive layout | good | 375px で横スクロールや明確な重なりなし。 | Admin Release の長文 reason は mobile では折りたたみが欲しい。 |
| Release gate readability | needs work | CLI と Admin の役割分担は分かるが、今回の timeout 連鎖では Admin の blocked summary が長い。 | budget exhausted と個別 timeout を上位 summary / 詳細に分ける。 |

## 5. 不具合 / 回帰

### Issue 1

- 重大度: high
- 状態: open
- 領域: Release dry-run
- URL: terminal / http://localhost:5174
- world pack: `GESTALOKA Reference`
- world template: `Nexus Foundation`
- 操作: `make canary-up && make canary-probe && make release-checklist && make canary-down`
- 期待: release checklist が完走し、verdict `passed`、canary promote status ready 相当になる。
- 実際: `make canary-probe` は healthy。`make release-checklist` は `blocked`。
- 証跡: `admin-release-after-dry-run.png`
- 再現手順:
  1. `docker compose up --build -d`
  2. `make canary-up`
  3. `make canary-probe`
  4. `make release-checklist`
  5. `make canary-down`
- blocked reasons:
  - `turn_resolution_smoke`: timeout / 180s (`run_id=8536a764-41d1-4642-9d4e-763725599cb4`)
  - `turn_resolution_failure_injection`: timeout / 180s (`run_id=3775369d-8c12-47e2-8ad4-e78a143296e6`)
  - `shadow_replay`: timeout / 179.986s (`run_id=78aae18a-3129-41ea-8326-80e1e556ff78`)
  - `pack_regression:turn_resolution_gestaloka_regression`: skipped because release checklist budget was exhausted (`run_id=a4f430dd-1a72-4c35-b62a-de61e960c08f`)
  - `slo_canary_snapshot`: skipped because release checklist budget was exhausted
- 推奨修正: release checklist の turn / shadow checks が live provider で 180 秒を使い切る原因を切り分ける。budget exhausted 時も canary snapshot は軽量 check として最後に取得できるようにする。

### Issue 2

- 重大度: medium
- 状態: open
- 領域: Tooling / Playwright MCP
- URL: n/a
- 操作: Playwright MCP で `http://localhost:8000/health` を開く。
- 期待: MCP browser が起動し、snapshot / screenshot / click 操作を実施できる。
- 実際: `Browser is already in use for /home/kingyosun/.cache/ms-playwright/mcp-chrome-d383e73`。残存 process 解放後、MCP transport が closed になり、その後の MCP tool call は実行不能。
- 証跡: terminal output。
- 再現手順: 同一環境で複数の `playwright-mcp` process が残った状態から MCP browser tool を呼ぶ。
- 推奨修正: Codex MCP 起動を isolated profile にするか、前回 session の `playwright-mcp` process cleanup を標準化する。

## 6. 実行コマンド

```bash
make verify-v2
docker compose up --build -d
curl -fsS http://localhost:8000/health
docker compose ps --format json
cd frontend && node --input-type=module -  # Player/Admin/Responsive Playwright checks
make canary-up
make canary-probe
make release-checklist
make canary-down
cd frontend && node --input-type=module -  # Admin Release after dry-run check
```

## 7. 最終まとめ

- 総合結果: Player smoke、Admin smoke、responsive は pass。Release dry-run は blocked。
- 完了した pack / template: `GESTALOKA Reference / Nexus Foundation` を `Nexus Gate` から `Oblivion Breach` 到達まで確認。
- release readiness: not ready。`release_checklist` report は作成されたが verdict は `blocked`、canary promote status は blocked。
- 残リスク: release checklist の live-provider timeout、MCP browser profile lock。
- follow-up ticket / task: release checklist timeout の原因調査、Admin Release の blocked reasons 表示改善、Playwright MCP process cleanup。
