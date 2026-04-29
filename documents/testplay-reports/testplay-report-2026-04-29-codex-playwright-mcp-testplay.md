# テストプレイレポート - Codex Playwright MCP testplay - 2026-04-29

## 1. 実施情報

- 実施日時: 2026-04-29T20:23+09:00 - 2026-04-29T20:52+09:00
- 実施者 / Codex session: Codex
- git commit: `f43f156`
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
  - `documents/testplay-reports/artifacts/testplay-report-2026-04-29-codex-playwright-mcp-testplay/`
- 実施上の制約:
  - Playwright MCP は `make playwright-mcp-clean` 後も `Transport closed` で開始できなかったため、同じ操作列を `frontend` workspace の Playwright API で代替実施した。

## 2. 事前検証

| 確認 | コマンド | 結果 | メモ |
| --- | --- | --- | --- |
| v2 公式検証 | `make verify-v2` | pass | backend `156 passed, 1 skipped`、pack validate ready、pack leak 0、v1 term scan pass、shared-world regressions pass、pack regressions passed、player/admin frontend build pass、frontend E2E 3 passed。 |
| pack catalog | `make pack-validate` | pass | `make verify-v2` 内で実行。`status=ready`、`pack_count=1`、`template_count=1`、`failure_count=0`。 |
| pack leak scan | `make scan-pack-leaks` | pass | `make verify-v2` 内で実行。`leak_count=0`。 |
| shared-world regressions | `make shared-world-regressions` | pass | `make verify-v2` 内で実行。shared-world health ready、drift 0。 |
| pack regressions | `make eval-pack-regressions` | pass | `turn_resolution_gestaloka_regression` passed。 |
| frontend E2E | `make frontend-e2e` | pass | `gestaloka-reference-smoke.spec.ts` 3 passed。 |
| backend health | `curl -fsS http://localhost:8000/health` | pass | database ok、projection ready、world packs ready、SP `execution_only`、Langfuse ready、canary health healthy。 |
| canary probe | `make canary-probe` | pass | canary healthy、graph ready、`llm_schema_valid_rate=0.7391`。 |
| release checklist | `make release-checklist` | fail | report `1ba1413f-f4fa-4bad-a246-cba62e22dde6`。turn / shadow checks が timeout、budget exhausted により verdict blocked。 |

## 3. Playwright 実施結果

| 領域 | 対象 | 結果 | 証跡 | メモ |
| --- | --- | --- | --- | --- |
| Preflight | health / 初期描画 / login | pass with tooling issue | `player-initial.png`, `player-authenticated.png` | MCP は transport closed。代替 Playwright では Player login ok。`auth-status=authenticated`、SP note は execution budget。 |
| Display language | Player JA/EN 切替 | pass | `player-initial.png` | `html[lang]` と `localStorage["gestaloka.locale"]` が EN/JA で更新。初期値は browser locale 由来で EN。 |
| Player profile | profile 作成・選択 / start-session 無効状態 | pass | `player-authenticated.png`, `player-session-start.png` | profile 未選択時の `start-session` disabled、English profile 作成、session start を確認。 |
| GESTALOKA Reference | Nexus Gate から Breach Restoration まで | partial | `player-choice-progress-1.png`, `player-choice-progress-2.png`, `player-fullflow-progress-3.png` | live provider では `2/2` 到達と次クエスト `Breach Restoration` への遷移を確認。Oblivion Breach 到達は代替 Playwright の途中終了で未確認。stub E2E では full smoke pass。 |
| Player state | quest / route / ops | partial | `player-error.png`, `player-fullflow-error.png` | `Nexus Gate`、`Lift Tower Concourse`、`First Stabilizer Request`、`Gate Steward Rikka`、`session.connected`、raw JSON なしを確認。 |
| Choice / free text | mode 切替 / input / submit | blocked | n/a | SP 消費と途中終了により、今回の代替 Playwright では free text screenshot まで到達せず。 |
| Admin / Packs | dashboard / pack catalog / template | pass | `admin-dashboard.png`, `admin-packs.png`, `admin-world-templates.png` | `GESTALOKA Reference`、`Nexus Foundation`、public/playable、pack/template 管理導線を確認。 |
| Admin / Config | users / LLM settings / usage / lanes / prompts / SP | pass | `admin-users.png`, `admin-llm-settings.png`, `admin-llm-usage.png`, `admin-model-lanes.png`, `admin-prompts.png`, `admin-sp.png` | Users は app-level permission 管理。LLM は secret/env ref。Usage は token/cache/run/missing を KPI とグラフ/表で表示。 |
| Admin navigation | side nav / data-testid uniqueness | pass | `admin-result.json` | `admin-packs`、`admin-world-templates`、`admin-users`、`admin-llm-settings`、`admin-llm-usage`、`admin-model-lanes`、`admin-prompts`、`admin-sp`、`admin-release` は各 1 件。 |
| Release Dry-run | canary / release gate / Admin summary | fail expected | `admin-release-after-dry-run.png` | CLI verdict blocked。Admin Release は created timestamp、timeout reason、run id、SLO canary snapshot passed を表示。 |
| Responsive | desktop / 375x812 mobile | pass with issue | `admin-mobile-375.png`, `admin-release-mobile-375.png` | Admin dashboard は `scrollWidth=375`。Release 画面は `scrollWidth=399` で横 overflow。 |

## 4. UX 評価

| 領域 | 評価 | 観察 | 改善案 |
| --- | --- | --- | --- |
| Login | acceptable | Player/Admin とも login CTA から Keycloak form へ進み、demo login 後に画面へ戻る。backend recreate 後は再ログインで復帰できる。 | Admin 未認証画面にも locale switcher があると初回導線が揃う。 |
| Display language | good | Admin は EN reload 永続化と JA 復帰を確認。Player も `html[lang]` と localStorage は更新された。 | 初期言語が browser locale 由来で EN になる点を仕様として明示するか、runbook の初期JA前提を緩める。 |
| World select | good | playable pack と `GESTALOKA Reference / Nexus Foundation` が読みやすい。 | なし。 |
| Player profile | good | 作成、既存選択、play language 設定、start disabled は理解しやすい。 | profile 一覧で play language をより強く表示すると選択ミスを減らせる。 |
| Play language | acceptable | English profile で narrative / choices は英語寄り。内部 key や id は翻訳されない。 | 表示言語と play language の違いを profile 設定周辺で短く補強する。 |
| Turn execution wait | acceptable | 実行中は `進行中` になり二重送信しにくい。live provider では turn が長く、完了まで待つ必要がある。 | action area に elapsed/current phase を出すと待ち状態が分かりやすい。 |
| Choice / free text switch | blocked | 今回は free text screenshot まで到達できず。choice UI 自体は選択肢カードとして読める。 | SP 残量不足時も含め、free text の cost を submit 近くに出す。 |
| SP shortage recovery | acceptable | Player では SP が execution budget として表示され、Admin SP は調整画面として読める。 | Player session から user/world を Admin SP へコピーしやすい導線があると復旧が速い。 |
| Player streams readability | acceptable | quest、routes、ops は raw dump ではなく読める。長い stream の読み返しは重くなりそう。 | stream の折りたたみ、filter、最新固定があるとよい。 |
| Admin navigation | good | 左サイドバーから全画面へ迷わず移動できる。 | なし。 |
| Admin information density | good | KPI、一覧、フォームが管理画面として整理されており、raw JSON dump に見えない。 | なし。 |
| Admin world-pack operations | acceptable | pack scaffold、archive import、publish status の導線が見える。 | publish 変更には確認 dialog と変更履歴が欲しい。 |
| Error display | acceptable | Release blocked reasons は check 別 card で読める。timeout の理由と run id は追える。 | 長い blocked reasons は summary/detail に分けると mobile で読みやすい。 |
| Responsive layout | needs work | Admin dashboard は 375px で横スクロールなし。Release 画面だけ `scrollWidth=399`。 | Release check card の long label / run id / button 幅を 375px 内へ収める。 |
| Release gate readability | needs work | CLI 詳細と Admin summary の役割は分かるが、今回の timeout 連鎖では blocked が長い。 | budget exhausted と個別 timeout を上位 summary / 詳細に分ける。 |

## 5. 不具合 / 回帰

### Issue 1

- 重大度: high
- 状態: open
- 領域: Release dry-run
- URL: terminal / http://localhost:5174
- world pack: `GESTALOKA Reference`
- world template: `Nexus Foundation`
- session id: n/a
- 操作: `make canary-up && make canary-probe && make release-checklist && make canary-down`
- 期待: release checklist が完走し、verdict `passed`、canary promote status ready 相当になる。
- 実際: canary probe は healthy。release checklist は `blocked`。
- 証跡: `admin-release-after-dry-run.png`
- 再現手順:
  1. `docker compose up --build -d`
  2. `make canary-up`
  3. `make canary-probe`
  4. `make release-checklist`
  5. `make canary-down`
- blocked reasons:
  - `turn_resolution_smoke`: timeout / 180s (`run_id=5622568e-0a84-4ea8-bbdc-77a46e1a21bb`)
  - `turn_resolution_failure_injection`: timeout / 180s (`run_id=eafada98-e8b6-4e17-8973-68e6916d39ad`)
  - `shadow_replay`: timeout / 179.983s (`run_id=641ee086-bb16-42b1-a67e-704378a3a90c`)
  - `pack_regression:turn_resolution_gestaloka_regression`: skipped because release checklist budget was exhausted (`run_id=ab3f9e94-9d0f-4693-844d-49b8290acce8`)
  - `slo_canary_snapshot`: passed
- 推奨修正: live provider で turn / shadow checks が 180 秒を使い切る原因を切り分ける。budget exhausted 時も required check と lightweight SLO check の優先順位を明確化する。

### Issue 2

- 重大度: medium
- 状態: open
- 領域: Tooling / Playwright MCP
- URL: n/a
- 操作: `make playwright-mcp-clean` 後に Playwright MCP で `http://localhost:8000/health` を開く。
- 期待: MCP browser が起動し、snapshot / screenshot / click 操作を実施できる。
- 実際: `browser_navigate` が `Transport closed`。再度 `make playwright-mcp-clean` しても同じ。
- 証跡: terminal output。
- 再現手順:
  1. `make playwright-mcp-clean`
  2. MCP `browser_navigate` で `http://localhost:8000/health`
- 推奨修正: Codex MCP の browser profile と transport lifecycle を確認する。MCP が閉じた場合の再起動手順を runbook に追加する。

### Issue 3

- 重大度: medium
- 状態: open
- 領域: Admin Release responsive
- URL: http://localhost:5174
- 操作: Release checklist 実行後、Admin Release を 375x812 viewport で表示。
- 期待: 横スクロールなし。
- 実際: `document.documentElement.scrollWidth=399`、`window.innerWidth=375`。
- 証跡: `admin-release-mobile-375.png`, `admin-release-result.json`
- 再現手順:
  1. `make release-checklist` で timeout を含む report を作成
  2. Admin に login
  3. Release 画面を開く
  4. viewport を 375x812 にする
- 推奨修正: Release check card 内の long label、run id、button を `min-width: 0` / `overflow-wrap: anywhere` / responsive stack で収める。

### Issue 4

- 重大度: low
- 状態: open
- 領域: Player live-provider manual flow
- URL: http://localhost:5173
- world pack: `GESTALOKA Reference`
- 操作: live stack で English profile を作成し、`choice-progress` を連続実行。
- 期待: runbook の smoke flow と同じ観測点を安定して確認できる。
- 実際: 代替 Playwright の1回目は `choice-progress` 2回後に `1/2` のまま。再実行では2回目で `2/2`、3回目で `Breach Restoration` へ進んだが、Oblivion Breach 到達前に代替 Playwright が途中終了。
- 証跡: `player-error.png`, `player-fullflow-progress-2.png`, `player-fullflow-progress-3.png`
- 再現手順:
  1. Player に `demo / demo-password` で login
  2. English profile を作成
  3. `GESTALOKA Reference` session を開始
  4. `choice-progress` を連続実行
- 推奨修正: live provider の生成 choice label / route が揺れる前提で runbook を「状態到達まで最大N回」にするか、手動 testplay 用に deterministic lane / stub lane を選べるようにする。

## 6. 実行コマンド

```bash
make verify-v2
make playwright-mcp-clean
docker compose up --build -d
curl -fsS http://localhost:8000/health
docker compose ps

# MCP attempt
# browser_navigate http://localhost:8000/health -> Transport closed
make playwright-mcp-clean

# Playwright API fallback from frontend workspace
node --input-type=module -  # Player checks
node --input-type=module -  # Admin checks
node --input-type=module -  # Admin locale check

make canary-up
make canary-probe
make release-checklist
make canary-down

node --input-type=module -  # Admin Release after dry-run
```

## 7. 最終まとめ

- 総合結果: `make verify-v2`、Admin smoke、Admin navigation、Admin LLM Usage、Admin dashboard responsive は pass。Player live-provider flow は Breach Restoration まで partial。Release dry-run は blocked。
- 完了した pack / template: `GESTALOKA Reference / Nexus Foundation`。stub E2E では Nexus Gate から Oblivion Breach 到達まで pass。live stack では Nexus Gate から Breach Restoration まで確認。
- release readiness: not ready。report `1ba1413f-f4fa-4bad-a246-cba62e22dde6` は `blocked`、canary promote status は blocked。
- 残リスク: Playwright MCP transport failure、live provider の release checklist timeout、Admin Release mobile overflow、live manual flow の再現揺れ。
- follow-up ticket / task: MCP transport 復旧手順の整備、release checklist timeout 調査、Admin Release responsive 修正、manual testplay の deterministic 実行条件整備。
