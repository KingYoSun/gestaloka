# テストプレイレポート - Codex Playwright MCP retry - 2026-04-29

## 1. 実施情報

- 実施日時: 2026-04-29T08:02:22+09:00 - 2026-04-29T08:22+09:00
- 実施者 / Codex session: Codex / Playwright MCP
- git commit: c529cd8
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
  - `documents/testplay-reports/artifacts/testplay-report-2026-04-29-codex-playwright-mcp-retry/`

## 2. 事前検証

| 確認 | コマンド | 結果 | メモ |
| --- | --- | --- | --- |
| v2 公式検証 | `make verify-v2` | pass | backend 150 passed / 1 skipped、pack validate ready、pack leak 0、shared-world ready、pack regressions passed、player/admin frontend build pass、frontend E2E 2 passed。 |
| backend health | `curl -fsS http://localhost:8000/health` | pass | database ok、projection ready、world packs ready、SP execution_only、Langfuse ready。 |
| stack 起動 | `docker compose up --build -d` | pass | Player/Admin/backend/Langfuse は healthy。 |
| canary probe | `make canary-probe` | pass | canary healthy、graph ready、release verdict blocked。 |
| release checklist | `make release-checklist` | fail / timeout | 7 分以上結果出力なし。`docker compose exec ... eval_harness gate` を kill し、Error 130。report は作成されず。 |
| canary cleanup | `make canary-down` | pass | backend-canary を停止・削除。 |

## 3. Playwright MCP 実施結果

| 領域 | 対象 | 結果 | 証跡 | メモ |
| --- | --- | --- | --- | --- |
| Preflight | health / 初期描画 / login | pass | `health.png`, `player-initial.png`, `player-profile-ready.png` | Keycloak login ok。`auth-status=authenticated`、`api-health=ok / DB: ok`、SP は 9 から開始。 |
| Player profile | 既存 profile 選択 / start-session | note あり pass | `player-profile-ready.png` | `Demo Player` が既に存在。`docker compose up --build -d` で `frontend-e2e` も起動して state を作った可能性が高い。 |
| GESTALOKA Reference | Nexus Gate から Oblivion Breach | pass / 初期値不一致 | `player-session-start.png`, `player-quest-complete.png`, `player-writ-used.png`, `player-oblivion-breach.png` | session pack、WebSocket open、Gate Steward Rikka、route、faction standing を確認。開始直後 quest progress は期待 `0/2` ではなく `1/2`。その後 progress で `2/2`、Nexus Writ active、writ used、Breach Restoration、Oblivion Breach 到着を確認。 |
| Player state | quest / inventory / route / travel / relationship / beats | pass | `player-oblivion-breach.png` | `Nexus Writ used`、travel history、relationship warm、world beats 更新あり。route copy は Writ 使用後に opened 表示へ更新された。 |
| Choice / free text | mode switch | pass / note | `mobile-player-oblivion-breach.png` | free text mode へ切替可能。入力欄には既定文が prefill され、submit 可能。 |
| Admin | dashboard / packs / templates / users / llm / lanes / prompts / sp / release | pass | `admin-dashboard.png`, `admin-release-before-checklist.png` | 各 `data-testid` は一意。raw JSON dump / raw trace stream / projection internals dump は通常画面に見えない。 |
| Release Dry-run | canary / release gate | fail | `admin-release-after-timeout.png` | canary probe は pass。release checklist は timeout 扱いで中断。Admin verdict は `blocked`、created は `not run` のまま。 |
| Responsive | Player/Admin 375x812 | pass | `mobile-player-oblivion-breach.png`, `mobile-admin-release.png` | `scrollWidth=clientWidth=375`。検査対象要素の viewport はみ出しなし。 |

## 4. UX 評価

| 領域 | 評価 | 観察 | 改善案 |
| --- | --- | --- | --- |
| Login | good | Player/Admin とも Keycloak SSO で復帰できた。 | backend recreate 後の token validation failed からの復帰導線を明示する。 |
| World select | good | playable world が選択済みで、pack 名が明確。 | なし。 |
| Player profile | acceptable | 既存 profile は選びやすいが、E2E が state を先に作ると manual test の前提が崩れる。 | 手動 stack 起動で `frontend-e2e` が走らない compose profile 分離を検討する。 |
| Turn execution wait | needs work | 1 回目の progress は約 78 秒。`選択待ち` へ戻るまで待ちが長い。 | action area 近くに phase / elapsed / retry guidance を出す。 |
| Choice / free text switch | acceptable | mode switch は明確。free text は prefilled text のまま送信できる。 | free text 初回切替時は placeholder 化、または prefill の意図を明確にする。 |
| SP shortage recovery | acceptable | SP は execution budget として表示され、世界内報酬には見えない。 | Admin SP adjustment の対象 user/world を現在 session から補完できると追いやすい。 |
| Player streams readability | acceptable | story、quest、人物、移動先は読める。ops stream は長くなる。 | ops stream は折りたたみまたは filter を追加する。 |
| Admin navigation | good | 左/上ナビから各管理領域へ迷わず移動できる。 | mobile では Users & Permissions が 2 行になるため、項目間隔を少し広げる。 |
| Admin information density | good | KPI、一覧、フォームが raw dump ではなく管理画面として読める。 | なし。 |
| Admin world-pack operations | acceptable | pack、template、scaffold、archive import、publish status の導線は見える。 | destructive / irreversible 操作には確認状態を追加する。 |
| Error display | acceptable | backend recreate 後に `Token validation failed` banner が出た。reload で復帰。 | token refresh 失敗時は再ログイン CTA を banner 内に出す。 |
| Responsive layout | good | Player/Admin とも 375px で横スクロール、ボタンはみ出し、明確な重なりなし。 | Admin nav の長い label だけ折返し後の行間を調整する。 |
| Release gate readability | blocked | release summary の blocked 状態は読めるが、CLI checklist が完了せず created timestamp も更新されない。 | checklist 実行中の timeout、進捗、最後に実行中の check 名を CLI/Admin の両方で見せる。 |

## 5. 不具合 / 回帰

### Issue 1

- 重大度: medium
- 状態: open
- 領域: compose / testplay state isolation
- URL: http://localhost:5173
- world pack: GESTALOKA Reference
- session id: `44292a39-28b2-4886-b5a7-89adb2d0eccc`
- world id: `gestaloka_reference`
- 操作: `docker compose up --build -d` 後、manual testplay を開始。
- 期待: manual testplay 前の state が runbook 前提どおり fresh で、quest progress が `0/2` から始まる。
- 実際: `frontend-e2e` service も起動していた影響と見られる既存 `Demo Player` / SP 9 / quest progress `1/2` から開始。
- 証跡: `player-profile-ready.png`, `player-session-start.png`
- 再現手順: clean volume 後に full `docker compose up --build -d` を実行し、`frontend-e2e` が同じ stack 上で走る状態のまま Player UI にログインする。
- 推奨修正: `frontend-e2e` を default compose 起動対象から外し、manual stack と E2E stack を profile または override で分ける。

### Issue 2

- 重大度: high
- 状態: open
- 領域: Release dry-run
- URL: terminal / http://localhost:5174
- world pack: n/a
- session id: n/a
- 操作: `make canary-up && make canary-probe && make release-checklist && make canary-down`
- 期待: release checklist が完了し、Admin Release の created timestamp と verdict が更新される。
- 実際: `make release-checklist` が 7 分以上無出力で停止。`docker compose exec ... python -m app.modules.eval_harness gate` を kill し Error 130。Admin は `Created: not run` / `No release checklist report exists` のまま。
- 証跡: `admin-release-before-checklist.png`, `admin-release-after-timeout.png`
- 再現手順: 起動済み stack で上記コマンドを実行する。
- 推奨修正: gate/checklist に per-check timeout と進捗ログを入れ、外部 provider 待ちまたは OpenAPI schema fetch loop のどちらで詰まっているか判別できるようにする。

### Issue 3

- 重大度: low
- 状態: open
- 領域: Admin auth / backend restart recovery
- URL: http://localhost:5174
- 操作: `make canary-up` により backend が recreate された後、Admin の refresh を実行。
- 期待: token refresh または再ログイン導線が分かる。
- 実際: `Token validation failed` banner が表示された。ページ reload 後は dashboard 表示へ復帰。
- 証跡: Playwright observation。release 画面自体は `admin-release-after-timeout.png` で復帰後を保存。
- 再現手順: Admin login 済み状態で backend recreate 後、Admin refresh。
- 推奨修正: token validation failed 時に再ログイン CTA を表示し、単なる backend 一時 restart と認証失効を区別する文言にする。

## 6. 実行コマンド

```bash
make verify-v2
docker compose up --build -d
curl -fsS http://localhost:8000/health
docker compose ps
make canary-up && make canary-probe && make release-checklist && make canary-down
kill 75360 75376 75359 75109 || true
make canary-down
curl -fsS http://localhost:8000/health
```

## 7. 最終まとめ

- 総合結果: Player / Admin の探索的テストプレイは主要 flow pass。Release dry-run は timeout で fail。
- 完了した pack / template: `GESTALOKA Reference / Nexus Foundation` を Oblivion Breach 到着まで確認。
- release readiness: not ready。release checklist report が作成されず、Admin verdict は blocked。
- 残リスク: compose 起動時の E2E state 汚染、release checklist hang、backend recreate 後の Admin token error、turn execution の長い待ち時間。
- follow-up ticket / task: compose profile 分離、release gate timeout/progress logging、Admin auth error CTA、turn progress visibility 改善。
