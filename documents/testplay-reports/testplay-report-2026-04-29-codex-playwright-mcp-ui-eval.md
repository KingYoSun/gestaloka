# テストプレイレポート - Codex Playwright MCP UI eval - 2026-04-29

## 1. 実施情報

- 実施日時: 2026-04-29T14:10+09:00 - 2026-04-29T14:44+09:00
- 実施者 / Codex session: Codex / Playwright MCP
- git commit: 53f37d5
- branch: main
- `.env` provider 種別: stack は既存 `.env` を使用。health 上は embedding `openai_compatible / gemini-embedding-001`、Langfuse enabled。`make verify-v2` は stub provider。
- stack 起動方法: `docker compose up --build -d`
- Playwright MCP 対象 URL:
  - Player UI: http://localhost:5173
  - Admin UI: http://localhost:5174
  - Backend health: http://localhost:8000/health
  - Langfuse: http://localhost:3001
- 対象 bundled pack:
  - `GESTALOKA Reference / Nexus Foundation`
- 証跡ディレクトリ:
  - `documents/testplay-reports/artifacts/testplay-report-2026-04-29-codex-playwright-mcp-current/`

## 2. 事前検証

| 確認 | コマンド | 結果 | メモ |
| --- | --- | --- | --- |
| v2 公式検証 | `make verify-v2` | pass | backend 151 passed / 1 skipped、pack validate ready、pack leak 0、shared-world ready、pack regressions passed、player/admin frontend build pass、frontend E2E 3 passed。 |
| pack catalog | `make pack-validate` | pass | `make verify-v2` 内で実行。`status=ready`、`failure_count=0`。 |
| pack leak scan | `make scan-pack-leaks` | pass | `make verify-v2` 内で実行。`leak_count=0`。 |
| shared-world regressions | `make shared-world-regressions` | pass | `make verify-v2` 内で実行。shared-world health ready、10 tests passed。 |
| pack regressions | `make eval-pack-regressions` | pass | `turn_resolution_gestaloka_regression` passed。 |
| frontend E2E | `make frontend-e2e` | pass | `make verify-v2` 内で実行。3 passed。 |
| backend health | `curl -fsS http://localhost:8000/health` | pass | database ok、projection ready、world packs ready、SP execution_only、Langfuse ready。 |
| canary probe | `make canary-probe` | pass | canary healthy、graph ready、release verdict blocked。 |
| release checklist | `timeout 600 make release-checklist` | fail / timeout | smoke と failure injection は各 180s timeout、shadow replay fail、pack regression 中に外側 timeout。後続 health では blocked report 作成を確認。 |

## 3. Playwright MCP 実施結果

| 領域 | 対象 | 結果 | 証跡 | メモ |
| --- | --- | --- | --- | --- |
| Preflight | health / 初期描画 / login | pass | `health.png`, `player-initial.png`, `player-profile-ready.png` | Keycloak login ok。`auth-status=authenticated`、`api-health=ok / DB: ok`、SP は 10。 |
| Display language | Player / Admin JA・EN 切替 | pass | `player-initial.png`, `admin-dashboard.png` | Player は `html[lang]` と `localStorage["gestaloka.locale"]` が `ja/en` に切替、reload 後も保持。Admin も同じ locale key を使用。 |
| Player profile | profile 作成 / start-session 無効状態 | pass | `player-profile-ready.png` | profile 未作成時は `start-session` disabled。`Codex Test 20260429` 作成後に enabled。Play language は English として保存、profile 表示にも反映。 |
| GESTALOKA Reference | Nexus Gate から quest 1/2 まで | partial | `player-session-start.png`, `player-council-rejected.png` | 開始直後は `Nexus Gate`、`First Stabilizer Request`、`0/2`、`Gate Steward Rikka`、`Lift Tower Concourse`、`Oblivion Breach` route を確認。1 回目 progress は約 78s で `1/2`。 |
| GESTALOKA Reference | quest 2/2 / Nexus Writ / Breach Restoration / Oblivion Breach | fail | `player-council-rejected.png`, `mobile-player-blocked.png` | 2 回目 progress は `POST /turns` が 422、UI に `council_rejected`。再試行時は token 期限切れで 401、`Token validation failed`。以後の writ / breach flow は未到達。 |
| Player state | quest / inventory / route / relationship / world beats | partial | `player-session-start.png`, `player-council-rejected.png` | quest、People、Routes、Inventory は表示。`Nexus Writ`、travel history、relationship / world beats 更新は 2 回目 turn failure のため未確認。 |
| Admin / Packs | dashboard / pack catalog / scaffold / archive import / publish status | pass | `admin-dashboard.png` | Dashboard は pack ready、1 packs、template 1、failure 0、graph ready。Packs は `GESTALOKA Reference`、scaffold と archive import 導線を表示。 |
| Admin / Config | templates / users / LLM / lanes / prompts / SP | pass | `admin-dashboard.png` | 各 `data-testid` は一意。Users は app-level permission 管理。LLM は secret 本体でなく ref 名入力。lanes は model id 編集、prompts は registry と override 導線、SP は adjustment 画面。 |
| Release Dry-run | canary / release gate / runbook 表示 | fail | `admin-release-before-checklist.png`, `admin-release-after-timeout.png`, `admin-release-after-reauth.png` | canary probe は pass。checklist は timeout/fail で blocked。backend recreate 後に Admin token invalid banner と `Sign in again` CTA を確認。再認証後、created timestamp と blocked reasons が表示された。 |
| Responsive | desktop / 375x812 mobile | pass / note | `mobile-player-blocked.png`, `mobile-admin-release.png`, `mobile-admin-release-error.png` | Player/Admin とも `scrollWidth=clientWidth=375`。横スクロールなし。Admin Release の長い blocked reasons は折返し表示だが可読性は低い。 |

## 4. UX 評価

| 領域 | 評価 | 観察 | 改善案 |
| --- | --- | --- | --- |
| Login | acceptable | Player/Admin とも Keycloak login と SSO 復帰は動く。長時間操作後の token 期限切れで Player は `Token validation failed` のみ表示。Admin は再ログイン CTA がある。 | Player 側にも Admin と同等の再ログイン CTA を出す。turn 実行前に token refresh を明示的に行う。 |
| Display language | good | JA/EN 切替、`html[lang]`、reload 後永続化は一貫。Player/Admin で同じ locale key を使う挙動も自然。 | なし。 |
| World select | good | playable pack は選択済みで、pack/template 名が理解しやすい。 | なし。 |
| Player profile | good | profile 作成、既存選択、開始前設定、Play language 保存は迷わずできる。 | なし。 |
| Play language | needs work | profile は English だが、session 開始直後の choice label / summary が日本語で表示された。1 回目 turn 後の choices は英語に戻った。 | 初期 choices 生成または pack-defined choices にも profile play language を適用するか、固定 pack text なら翻訳対象外であることを区別して表示する。 |
| Turn execution wait | needs work | 1 回目 progress は約 78 秒。2 回目は 422 failure まで長く、待機中の現在 check / retry 状態が分かりにくい。 | action area 近くに elapsed、現在 phase、retry / cancel guidance を出す。 |
| Choice / free text switch | acceptable | mode 切替自体は明確。今回は token / council failure で free text turn の完了は未確認。 | failure 後でも入力欄・choice 再送信の状態を明確にする。 |
| SP shortage recovery | acceptable | SP は execution budget として表示され、世界内報酬には見えない。Admin SP adjustment も管理操作として表示。 | Admin SP で現在 session/user/world を引き継げると復旧操作が追いやすい。 |
| Player streams readability | acceptable | Story、Quest、People、Routes、Inventory は読める。ops/diagnostic は session id と pack 名を必要最小限表示。 | error は stream 末尾だけでなく action area に近い位置にも出す。 |
| Admin navigation | good | 左サイドバーまたはモバイルの 2 列ナビから各画面へ移動できる。 | mobile の `Users & Permissions` は折返し後も読めるが、行間を少し広げる。 |
| Admin information density | good | KPI、一覧、フォームが管理画面として読め、raw dump ではない。 | なし。 |
| Admin world-pack operations | acceptable | pack、template、scaffold、archive import、publish status の導線は見える。 | destructive / irreversible 操作は確認状態を追加する。 |
| Error display | acceptable | Admin の token invalid は原因と再ログイン CTA がある。Player の token invalid は短い文言だけ。 | Player も原因、対象操作、再ログイン CTA を表示する。 |
| Responsive layout | good | 375px で横スクロールや明確な重なりなし。 | Admin Release の長い blocked reasons は箇条書きか詳細折りたたみにする。 |
| Release gate readability | needs work | blocked reasons は Admin に出るが、長文の comma-separated text で読みにくい。CLI は check 単位 timeout を出す。 | Admin は check ごとに status / elapsed / reason を分解して表示する。 |

## 5. 不具合 / 回帰

### Issue 1

- 重大度: high
- 状態: open
- 領域: Player turn execution / council
- URL: http://localhost:5173
- world pack: `GESTALOKA Reference`
- world template: `Nexus Foundation`
- session id: `5bb304df-7f22-4846-b36b-b1dbda616758`
- world id: `gestaloka_reference`
- 操作: session 開始後、`choice-progress` を 2 回実行。
- 期待: 2 回目で quest が `2/2` になり、`Nexus Writ`、route unlock、writ / breach / restoration 系 choice が表示される。
- 実際: 1 回目は `1/2` まで進行。2 回目は backend log で `POST /turns` が 422、UI に `council_rejected`。quest は `1/2` のまま。
- 証跡: `player-council-rejected.png`
- 再現手順:
  1. Player UI で demo login。
  2. `GESTALOKA Reference / Nexus Foundation` を選び、English profile を作成。
  3. session 開始後、`choice-progress` を実行して `1/2` まで待つ。
  4. 再度 `choice-progress` を実行する。
- 推奨修正: 422 の validation detail を UI/ops に表示し、council output schema rejection か request validation かを切り分ける。turn failure 時は retry 可能な同一 action と失敗 reason を action area に表示する。

### Issue 2

- 重大度: medium
- 状態: open
- 領域: Player auth / token refresh
- URL: http://localhost:5173
- world pack: `GESTALOKA Reference`
- session id: `5bb304df-7f22-4846-b36b-b1dbda616758`
- 操作: login から約 5 分以上経過後、turn 再試行と ops refresh が発生。
- 期待: token refresh が行われるか、再ログイン CTA が出る。
- 実際: backend log で `POST /turns` と複数 GET が 401。Player UI は `Token validation failed` の短い表示のみ。
- 証跡: `mobile-player-blocked.png`
- 再現手順: 長い turn 実行後、access token 期限を跨いで choice を再実行する。
- 推奨修正: Player API/WebSocket 呼び出し前に Keycloak token refresh を行い、失敗時は Admin と同じ `Sign in again` CTA を表示する。

### Issue 3

- 重大度: medium
- 状態: open
- 領域: Play language
- URL: http://localhost:5173
- world pack: `GESTALOKA Reference`
- session id: `5bb304df-7f22-4846-b36b-b1dbda616758`
- 操作: profile の Play language を English にして session 開始。
- 期待: narrative、npc reaction、choice label / summary など player-facing 生成文が English に寄る。
- 実際: narrative は English だが、session 開始直後の choice label / summary は日本語。1 回目 turn 後は English choice に戻った。
- 証跡: `player-session-start.png`
- 再現手順: English profile で新規 session を開始し、初期 choices を見る。
- 推奨修正: 初期 choices にも play language を適用する。固定 pack 文言なら翻訳対象外として UI 上で機械可読値や pack 固定文と区別する。

### Issue 4

- 重大度: high
- 状態: open
- 領域: Release dry-run
- URL: terminal / http://localhost:5174
- world pack: n/a
- session id: n/a
- 操作: `make canary-up && make canary-probe && timeout 600 make release-checklist && make canary-down`
- 期待: release checklist が完了し、Admin Release の verdict と created timestamp が更新され、ready/block 判断ができる。
- 実際: canary probe は pass。release checklist は `turn_resolution_smoke` と `turn_resolution_failure_injection` が各 180s timeout、`shadow_replay` fail、pack regression 中に外側 600s timeout。health と Admin は blocked report を表示。
- 証跡: `admin-release-after-reauth.png`
- 再現手順: 起動済み stack で上記コマンドを実行する。
- 推奨修正: release checklist を 10 分以内に完走させるため、pack regression も check 単位 timeout 後に集約結果を返す。Admin は blocked reasons を check ごとのリストで表示する。

## 6. 実行コマンド

```bash
make verify-v2
docker compose up --build -d
curl -fsS http://localhost:8000/health
docker compose ps
make canary-up
make canary-probe
timeout 600 make release-checklist
make canary-down
curl -fsS http://localhost:8000/health
docker compose ps backend player-frontend admin-frontend
```

## 7. 最終まとめ

- 総合結果: 公式検証と Admin UI smoke は pass。Player manual smoke は 2 回目 turn で blocked。Release dry-run は blocked。
- 完了した pack / template: `GESTALOKA Reference / Nexus Foundation` を Nexus Gate から `First Stabilizer Request 1/2` まで確認。
- release readiness: not ready。release checklist report は作成されたが verdict は `blocked`。
- 残リスク: Player turn 422、Player token refresh、初期 choice の play language 不一致、release checklist timeout/fail。
- follow-up ticket / task: council rejection detail の可視化、Player 再ログイン CTA、初期 choices の play language 適用、release checklist の timeout 集約と Admin 表示改善。
