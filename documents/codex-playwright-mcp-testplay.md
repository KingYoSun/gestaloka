# Codex Playwright MCP Testplay Guide

この文書は、[testplay-runbook.md](testplay-runbook.md) を Codex app から Playwright MCP で実施するための補助手順です。
公式回帰は引き続き `make verify-v2` / `make frontend-e2e` を正とし、Playwright MCP は起動済み stack に対する
探索的な動作テストと UX 評価に使います。

## 1. 前提

- `.env` は `.env.example` から作成済み。
- 事前に `make verify-v2` が green。
- stack は以下で起動済み。

```bash
docker compose up --build
```

`frontend-e2e` は default compose profile から外しているため、この手動 stack 起動では実行されない。
自動 smoke は `make frontend-e2e` が `e2e` profile を有効化して実行する。

- 確認対象 URL:
  - Player UI: `http://localhost:5173`
  - Admin UI: `http://localhost:5174`
  - Backend health: `http://localhost:8000/health`
  - Langfuse: `http://localhost:3001`
- Demo login: `demo / demo-password`
- 実施結果は [testplay-report-template.md](testplay-report-template.md) に記録する。

## 2. Playwright MCP 方針

- Playwright MCP 開始前に `make playwright-mcp-clean` を実行し、前回 session の残存 process と stale Chrome profile lock を掃除する。
- Player 確認では Playwright MCP で `http://localhost:5173` を開く。
- Admin 確認では別ページまたは別 context で `http://localhost:5174` を開く。Admin は Player route ではなく独立 frontend container として扱う。
- 操作前に accessibility / DOM snapshot で対象の存在と一意性を確認する。
- 操作対象は `data-testid` を優先する。role / text は snapshot 上で一意に判断できる場合だけ使う。
- 主要 checkpoint、表示崩れ、迷いが生じる操作、エラー表示は screenshot を残す。
- reload は、stack 再起動や frontend build 後など、状態を明示的に取り直す必要がある時だけ行う。
- 失敗時は URL、world pack、session id が見える場合は session id、直前の操作、期待、実際、screenshot を控える。
- `Browser is already in use` や MCP transport closed が出た場合は、MCP tool call を続けず次の順で復旧する。
  1. `make playwright-mcp-clean` で残存 process と stale lock を掃除する。
  2. 再発する場合は `scripts/cleanup_playwright_mcp.sh --reset-profile` で `mcp-chrome-*` profile directory も削除する。
  3. 新しい MCP session を開始し、同じ URL から再開する。
  4. それでも transport が閉じる場合は、repo の Playwright API / `make frontend-e2e` に切り替えて観測結果を記録する。

## 3. 安定した観測点

Player UI:

- `sign-in`: Keycloak login へ進む。
- 表示言語 switcher: `JA` / `EN` button で固定 UI 文言の locale を切り替える。`html[lang]` と `localStorage["gestaloka.locale"]` も確認する。
- `auth-status`: `authenticated` を確認する。
- `api-health`: backend health の UI 表示を確認する。
- `socket-status`: session 開始後に `open` を確認する。
- `sp-balance`: hidden test surface で SP 合算、有償SP、無償SP、turn cost を確認する。
- `sp-bucket-balance`, `paid-sp-balance`, `bonus-sp-balance`: 所持SPの主表示が有償SP / 無償SPに分かれていることを確認する。
- `sp-purchase-button`, `sp-purchase-dialog`, `sp-purchase-option-5`, `sp-purchase-complete`: SP購入導線と購入完了表示を確認する。
- `sp-budget-note`: SP が execution budget として説明されていることを確認する。
- `world-select`: playable world を選択する。
- `player-profile-select`: 作成済み player profile を選択する。
- `profile-display-name`: 新規 player profile の名前を入力する。
- `profile-play-language`: player-facing 生成文のプレイ言語を選択する。
- `profile-play-language-custom`: custom プレイ言語の prompt 名を入力する。
- `create-player-profile`: player profile を作成または保存する。
- `start-session`: player profile 選択後に session を開始する。
- `session-pack`: 選択した pack 名を確認する。
- `current-place-summary`, `current-chapter-summary`, `current-scene-summary`: 現在地と narrative 状態を確認する。
- `active-quest`, `quest-progress`, `quest-stage`: quest 状態を確認する。
- `local-figures-stream`, `nearby-routes-stream`, `recent-travel-history`: 移動と周辺情報を確認する。
- `choice-list`: choice mode の選択肢一覧。各選択肢 button は `choice-<opaque id>` の `data-testid` を持つが、操作対象は固定IDではなく表示文面で選ぶ。
- `toggle-free-text`, `turn-input`, `submit-turn`: free text mode の操作対象。
- `inventory-stream`, `relationship-summary`, `recent-world-beats`, `recent-scene-history`: turn 結果の反映を確認する。
- `ops-stream`: `session.connected`, `idle.updated`, world pack 名、不要な context 表示がないことを確認する。

Admin UI:

- `admin-sign-in`: Admin frontend から Keycloak login へ進む。
- 表示言語 switcher: `JA` / `EN` button で Admin 固定 UI 文言の locale を切り替える。Player UI と同じ `gestaloka.locale` を使う。
- `admin-nav-dashboard`, `admin-dashboard`: 集約 KPI、pack / projection / release summary。
- `admin-nav-packs`, `admin-packs`: pack 一覧、scaffold 作成、archive import、publish status 更新。
- `admin-nav-templates`, `admin-world-templates`: world template 一覧と playable / draft 更新。
- `admin-nav-users`, `admin-users`: app-level admin user / permission 一覧と付与。
- `admin-nav-llm`, `admin-llm-settings`: provider、base URL secret ref、API key secret ref、debug flag。
- `admin-nav-usage`, `admin-llm-usage`, `admin-llm-usage-range`: model ごとの token 消費、prompt cache hit rate、24h / 30d 切替。
- `admin-nav-lanes`, `admin-model-lanes`: lane ごとの model id 設定。
- `admin-nav-prompts`, `admin-prompts`: prompt registry と override 編集。
- `admin-nav-sp`, `admin-sp`: SP account summary と adjustment。
- `admin-nav-release`, `admin-release`: release summary と checklist 実行。
- `admin-refresh`, `admin-error`: 再取得とエラー表示。

Admin の通常画面では raw JSON dump、raw trace stream、低レベル projection dump を観測点にしない。
低レベル診断が必要な場合は、Admin ではなく `/ops` API や backend logs へ切り分ける。

## 4. Runbook 対応手順

### Preflight

1. Terminal で `make verify-v2` が green であることを確認する。
2. Terminal で `make playwright-mcp-clean` を実行する。実行内容だけ確認したい場合は `scripts/cleanup_playwright_mcp.sh --dry-run` を使う。MCP transport closed が繰り返す場合は `scripts/cleanup_playwright_mcp.sh --reset-profile` を実行してから新しい MCP session を開始する。
3. Playwright MCP で `http://localhost:8000/health` を開き、`status`、database、projection、world pack health が返ることを確認する。
4. `http://localhost:5173` を開き、画面が描画されることを screenshot で残す。
5. Player UI の表示言語 switcher で `JA` / `EN` を切り替え、`sign-in` の固定文言、`html[lang]`、reload 後の永続化を確認する。以後の testplay で使う表示言語に戻す。
6. `Sign in` から `demo / demo-password` で login し、`auth-status` と `sp-balance` を確認する。

### GESTALOKA World Reference

1. 必要なら page refresh し、Player UI で新しい session を開始できる状態にする。
2. `world-select` で `GESTALOKA World Reference` を選ぶ。
3. 既存 profile がある場合は `player-profile-select` で選択し、表示されるプレイ言語を確認する。ない場合は `profile-display-name` に名前を入れ、必要なら性別・背景・自由記述・文体・`profile-play-language` を設定し、`create-player-profile` を実行する。
4. `start-session` を実行する。
5. `socket-status=open`、`session-pack`、`session.connected`、`Nexus City`、`Visitor Log Registration`、`0/2`、`Nexus Entry Liaison`、`Universal Library`、faction standing を確認する。
6. 行動入力欄で `sp-bucket-balance` が有償SP / 無償SPの主表示になっていること、`turn-cost-note` が選択肢の消費予定SPを表示することを確認する。情報アイコンは `title` / accessible name で補足を持ち、インライン長文になっていないことを確認する。
7. `sp-purchase-button` を押し、`sp-purchase-dialog` に現在の有償SP / 無償SP、5段階の購入SP選択肢、購入ボタン、キャンセル、右上の閉じるボタンがあることを確認する。
8. `sp-purchase-option-5` を選び購入ボタンを押す。mock購入完了後、`sp-purchase-complete` が表示され、`paid-sp-balance` が購入前より 5 増え、`bonus-sp-balance` は変わらないことを確認する。Dialog を閉じた後も行動入力欄の `sp-bucket-balance` が更新後の値を表示することを確認する。
9. `toggle-free-text` を押し、`turn-cost-note` が自由入力の消費予定SPに切り替わること、補足が tooltip に留まることを確認する。その後 `toggle-choice-mode` で choice mode に戻す。
10. `quest-progress` が `2/2` になるまで、表示文面が「報告」「完了」「確定」「次へ進む」などの進行を示す選択肢を最大 4 回実行し、`Visitor Log Seal`、route unlock effect、Visitor Log Seal / Oblivion Regions / survey 系 choice を確認する。live provider testplay では生成揺れを前提に、固定クリック数ではなく状態到達で判断する。
11. `Breach Restoration` または `oblivion_survey` が表示されるまで、到達済み choice を最大 3 回選び、used 表示と `Oblivion Regions` route を確認する。
12. `Oblivion Regions` への travel history または current location 更新が観測できるまで、移動 affordance のある choice を最大 3 回実行し、Shared World Core の反映、faction / relationship / world beats のいずれかの更新を確認する。公式 smoke 判定は引き続き stub E2E を正とし、live provider の手動観測は到達状態と揺れを併記する。

プレイ言語確認を主目的にする場合:

- `profile-play-language` を `English` または `custom` に変更して profile を保存し、session state の profile 表示に反映されることを確認する。
- `custom` の場合は `profile-play-language-custom` に 80 文字以内の言語・文体名を入れる。
- narrative、npc reaction、choice label / summary、resolution summary などの player-facing 生成文が選択したプレイ言語に寄ることを確認する。
- schema enum、id、tag、内部 key、world_id / session_id などの機械可読値は翻訳されないことを確認する。
- 表示言語 switcher は固定 UI 文言だけを切り替えるものとして扱い、プレイ言語の期待結果と混同しない。

### Admin

1. `http://localhost:5174` を開き、必要なら `admin-sign-in` から `demo / demo-password` で login する。
2. Admin UI の表示言語 switcher で `JA` / `EN` を切り替え、固定文言、`html[lang]`、reload 後の永続化を確認する。以後の testplay で使う表示言語に戻す。
3. `admin-dashboard` で pack status、template 数、projection pending、release summary が管理向け KPI として読めることを確認する。
4. 左サイドバーで `admin-nav-packs`、`admin-nav-templates`、`admin-nav-users`、`admin-nav-llm`、`admin-nav-usage`、`admin-nav-lanes`、`admin-nav-prompts`、`admin-nav-sp`、`admin-nav-release` を順に開き、各画面の `data-testid` が一意に存在することを確認する。
5. `admin-packs` で `GESTALOKA World Reference` が表示され、pack 数 1、template 数 1、failure 0 相当の状態が読めることを確認する。
6. `admin-world-templates` で template の publish 状態が読めることを確認する。
7. `admin-users` で app-level permission 管理画面が表示され、Keycloak Admin API 作成画面になっていないことを確認する。
8. `admin-llm-settings` で secret 本体ではなく secret/env 参照名だけを扱っていることを確認する。
9. `admin-llm-usage` で total tokens、cache hit rate、run count、usage missing count が表示され、モデル別の token volume / cache hit rate グラフと summary table が raw JSON ではなく管理 KPI として読めることを確認する。
10. `admin-llm-usage-range` で `24h` と `30d` を切り替え、表示期間、bucket、グラフ、summary table が再取得後も崩れないことを確認する。
11. `admin-model-lanes` と `admin-prompts` で lane model id と prompt override を編集できる形になっていることを確認する。
12. `admin-sp` で SP が execution budget の調整として扱われ、世界内報酬や quest 進行力に見えないことを確認する。
13. 通常画面に raw JSON dump、raw trace 垂れ流し、projection internals の dump が表示されていないことを確認する。

### Release Dry-run

Terminal で以下を実行した後、Admin UI の release summary 表示を Playwright MCP で確認する。
各 target は host からそのまま実行する。`canary-up` は detached で canary health を待ち、
`canary-probe` / `release-checklist` は起動済み compose stack の `backend` container 内で実行される。

```bash
make canary-up
make canary-probe
make release-checklist
make canary-down
```

確認項目:

- `admin-nav-release` で Release 画面を開き、`admin-release` が表示される。
- Admin summary の verdict が `passed`、canary promote status が ready 相当である。
- blocked reasons が空または `none`。
- checklist run button から `/admin/release/checklists/run` が実行でき、再取得後に created timestamp が更新される。
- bundled pack regressions、shared world health、shadow failures、canary health の詳細判定は CLI output を正として控える。
- shadow failures がある場合は `schema` / `same-world` / `graph` / `retrieval` / `lane` / `fallback`
  の診断分類、retrieval required、hit count を控える。

## 5. UX 評価観点

- Login: `Sign in` から認証完了まで、待ち状態や失敗時の戻り方が分かるか。
- Display language: Player / Admin の `JA` / `EN` 切替で固定 UI 文言、`html[lang]`、reload 後の永続化が一貫するか。Player と Admin で同じ保存済み locale が使われることが自然に見えるか。
- World select: playable pack の選択肢、無効状態、catalog unavailable 表示が理解できるか。
- Player profile: 作成、既存選択、開始前編集、文体指定、プレイ言語設定が迷わずでき、`start-session` が profile 未選択時に無効化されるか。
- Play language: 表示言語と別の概念として理解できるか。preset / custom の保存、profile 表示、player-facing 生成文への反映、内部 ID や enum が翻訳されないことを確認できるか。
- Turn execution: choice 実行中に二重送信しにくく、完了後に次の操作が明確か。
- Choice / free text: mode 切替、入力欄、submit の関係が分かりやすいか。
- SP display / purchase: 所持SPの主表示が有償SP / 無償SPに分かれ、合算だけの表示になっていないか。SP購入Dialogで現在SP、5段階選択、購入、キャンセル、閉じる、購入完了表示が迷わず使えるか。購入完了後に有償SPだけが増え、既存プレイを阻害しないか。
- SP cost tooltip: 消費予定SP、無償SP優先消費、execution budget の補足が tooltip で確認でき、入力欄周辺に長文説明として残っていないか。
- SP recovery: SP 不足時に Admin UI `admin-sp` で補充すべきことが追えるか。SP が世界内報酬に見えないか。
- Streams: ops、history、beats、relationship、inventory が長くなっても読めるか。
- Admin navigation: 左サイドバーから Dashboard、Packs、World Templates、Users & Permissions、LLM Settings、LLM Usage、Model Lanes、Prompts、SP、Release へ迷わず移動できるか。
- Admin density: 管理 KPI、一覧、フォーム、明示的な管理操作が過密すぎず、raw dump に見えないか。
- LLM Usage: モデルごとの token 消費、prompt cache hit rate、usage missing count が時系列と表の両方で読め、24h / 30d 切替後も横スクロールや重なりがないか。
- Error banner: 発生時に原因、対象操作、次の切り分けが推測できるか。
- Responsive layout: desktop に加え 375x812 mobile viewport で text の折返し、button label、stream item、
  form input が重ならず横スクロールしないか。
- Release gate: Admin summary と CLI checklist の役割分担が分かり、promote / rollback 判断を CLI 詳細で追えるか。

## 6. 記録ルール

- 実施結果は [testplay-report-template.md](testplay-report-template.md) へ記録する。
- UX 所見は pass/fail と分け、改善提案は具体的な画面と操作に結び付ける。
- 不具合は再現できる最小操作列で記録する。
- screenshot は checkpoint 名と紐づけて記録する。
- Playwright MCP で判断できない backend / projection の問題は、runbook の troubleshooting command に戻って切り分ける。
