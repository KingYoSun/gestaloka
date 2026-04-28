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

- 確認対象 URL:
  - Player UI: `http://localhost:5173`
  - Admin UI: `http://localhost:5173/admin`
  - Backend health: `http://localhost:8000/health`
  - Langfuse: `http://localhost:3001`
- Demo login: `demo / demo-password`
- 実施結果は [testplay-report-template.md](testplay-report-template.md) に記録する。

## 2. Playwright MCP 方針

- Playwright MCP で `http://localhost:5173` を開く。
- 操作前に accessibility / DOM snapshot で対象の存在と一意性を確認する。
- 操作対象は `data-testid` を優先する。role / text は snapshot 上で一意に判断できる場合だけ使う。
- 主要 checkpoint、表示崩れ、迷いが生じる操作、エラー表示は screenshot を残す。
- reload は、stack 再起動や frontend build 後など、状態を明示的に取り直す必要がある時だけ行う。
- 失敗時は URL、world pack、session id が見える場合は session id、直前の操作、期待、実際、screenshot を控える。

## 3. 安定した観測点

Player UI:

- `sign-in`: Keycloak login へ進む。
- `auth-status`: `authenticated` を確認する。
- `api-health`: backend health の UI 表示を確認する。
- `socket-status`: session 開始後に `open` を確認する。
- `sp-balance`: SP balance を確認する。
- `sp-budget-note`: SP が execution budget として説明されていることを確認する。
- `world-select`: playable world を選択する。
- `start-session`: session を開始する。
- `session-pack`: 選択した pack 名を確認する。
- `current-place-summary`, `current-chapter-summary`, `current-scene-summary`: 現在地と narrative 状態を確認する。
- `active-quest`, `quest-progress`, `quest-stage`: quest 状態を確認する。
- `local-figures-stream`, `nearby-routes-stream`, `recent-travel-history`: 移動と周辺情報を確認する。
- `choice-list`, `choice-safe`, `choice-progress`, `choice-explore`: choice mode の操作対象。
- `toggle-free-text`, `turn-input`, `submit-turn`: free text mode の操作対象。
- `inventory-stream`, `relationship-summary`, `recent-world-beats`, `recent-scene-history`: turn 結果の反映を確認する。
- `ops-stream`: `session.connected`, `idle.updated`, world pack 名、不要な context 表示がないことを確認する。

Admin UI:

- `nav-admin`, `nav-game`: Player / Admin の往復。
- `ops-catalog-health`, `ops-pack-catalog-status`, `ops-pack-catalog-summary`: catalog readiness。
- `ops-pack-filter`, `ops-template-filter`, `ops-world-select`: Admin scope の切替。
- `graph-runtime-status`, `embedding-status-summary`, `langfuse-status-summary`: runtime 状態。
- `trigger-idle-pass`, `world-tick-stream`, `npc-location-stream`, `offstage-beat-stream`: idle pass の反映。
- `sp-overview`, `admin-ledger`, `adjust-delta`, `submit-adjustment`: SP 消費と調整。
- `release-gate-verdict`, `release-cutover-readiness`, `release-checks-stream`, `release-pack-regressions-stream`,
  `shadow-failures-stream`, `release-runbook`: release gate と runbook 表示。

## 4. Runbook 対応手順

### Preflight

1. Terminal で `make verify-v2` が green であることを確認する。
2. Playwright MCP で `http://localhost:8000/health` を開き、`status`、database、projection、world pack health が返ることを確認する。
3. `http://localhost:5173` を開き、画面が描画されることを screenshot で残す。
4. `Sign in` から `demo / demo-password` で login し、`auth-status` と `sp-balance` を確認する。

### GESTALOKA Reference

1. 必要なら page refresh し、Player UI で新しい session を開始できる状態にする。
2. `world-select` で `GESTALOKA Reference` を選び、`start-session` を実行する。
3. `socket-status=open`、`session-pack`、`session.connected`、`Nexus Gate`、`First Stabilizer Request`、`0/2`、`Gate Steward Rikka`、`Lift Tower Concourse`、faction standing を確認する。
4. `choice-progress` を 2 回実行し、`2/2`、`Nexus Writ`、route unlock effect、writ / breach / restoration 系 choice を確認する。
5. `choice-progress` を実行し、`Breach Restoration`、`breach_restoration`、used 表示、`Oblivion Breach` route を確認する。
6. さらに `choice-progress` を実行し、`Oblivion Breach`、travel history、Shared World Core の反映、faction / relationship / world beats のいずれかの更新を確認する。

### Admin / Ops

1. `nav-admin` で Admin UI を開く。
2. Catalog health が ready、pack 数 1、template 数 1、failure 0 であることを確認する。
3. Admin scope selector で world ごとの context が読めることを確認する。
4. Projection pending / failed が増え続けていないことを確認する。
5. Graph runtime、embedding runtime、Langfuse runtime が ready または想定内の状態であることを確認する。
6. Graph summary、relationship ops、consequence threads、history / title、SP overview / ledger が turn 結果を追える表示になっていることを確認する。
7. Operations health timeline が更新されることを確認する。

### Release Dry-run

Terminal で以下を実行した後、Admin UI の release gate 表示を Playwright MCP で確認する。
各 target は host からそのまま実行する。`canary-up` は detached で canary health を待ち、
`canary-probe` / `release-checklist` は起動済み compose stack の `backend` container 内で実行される。

```bash
make canary-up
make canary-probe
make release-checklist
make canary-down
```

確認項目:

- `release-gate-verdict` が `passed`。
- `release-cutover-readiness` が promote ready を示す。
- blocked reasons と missing checks が空。
- bundled pack regressions が GESTALOKA Reference 分 pass。
- shared world health、shadow failures、canary health が想定内。
- shadow failures がある場合は `schema` / `same-world` / `graph` / `retrieval` / `lane` / `fallback`
  の診断分類、retrieval required、hit count を控える。
- `release-runbook` の `canary_up`, `canary_probe`, `pre_promote_checklist`, `nightly_gate`, `promote_condition`,
  `promote`, `rollback` が runbook と一致する。

## 5. UX 評価観点

- Login: `Sign in` から認証完了まで、待ち状態や失敗時の戻り方が分かるか。
- World select: playable pack の選択肢、無効状態、catalog unavailable 表示が理解できるか。
- Turn execution: choice 実行中に二重送信しにくく、完了後に次の操作が明確か。
- Choice / free text: mode 切替、入力欄、submit の関係が分かりやすいか。
- SP recovery: SP 不足時に Admin UI で補充すべきことが追えるか。SP が世界内報酬に見えないか。
- Streams: ops、history、beats、relationship、inventory が長くなっても読めるか。
- Admin density: catalog、projection、graph、observability、SP、release gate の情報量が過密すぎないか。
- Error banner: 発生時に原因、対象操作、次の切り分けが推測できるか。
- Responsive layout: desktop に加え 375x812 mobile viewport で text の折返し、button label、stream item、
  form input が重ならず横スクロールしないか。
- Release gate: promote / rollback の判断材料と runbook command が迷わず読めるか。

## 6. 記録ルール

- 実施結果は [testplay-report-template.md](testplay-report-template.md) へ記録する。
- UX 所見は pass/fail と分け、改善提案は具体的な画面と操作に結び付ける。
- 不具合は再現できる最小操作列で記録する。
- screenshot は checkpoint 名と紐づけて記録する。
- Playwright MCP で判断できない backend / projection の問題は、runbook の troubleshooting command に戻って切り分ける。
