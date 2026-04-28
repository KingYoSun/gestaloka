# テストプレイレポート - Codex Playwright MCP フォローアップ - 2026-04-28

## 1. 実施情報

- 実施日時: 2026-04-28T18:10:02+09:00
- 実施者 / Codex session: Codex / Playwright MCP
- git commit: 6df1546
- branch: main
- `.env` provider 種別: stack 実行時は設定済み `.env` を使用。`make verify-v2` は stub provider を使用。
- stack 起動方法: `docker compose up --build -d` を試行後、`docker compose up -d` と `frontend-e2e` を除く対象 service 起動で実施。
- Playwright MCP 対象 URL:
  - Player UI: http://localhost:5173
  - Admin UI: http://localhost:5173/admin
  - Backend health: http://localhost:8000/health
  - Langfuse: http://localhost:3001

## 2. 事前検証

| チェック | コマンド | 結果 | 備考 |
| --- | --- | --- | --- |
| v2 verify | `make verify-v2` | 修正後 pass | 初回は Alembic revision id が PostgreSQL の `alembic_version.version_num varchar(32)` を超過して失敗。revision id を短縮し、再発防止テストを追加して修正。最終実行は backend 126 passed / 1 skipped、frontend e2e 2 passed。 |
| shared world regressions | `make verify-v2` に含む | pass | 10 passed。shared-world-health は ready、drift_count 0。 |
| frontend e2e | `make verify-v2` に含む | pass | Playwright test 2 件 pass。 |
| canary probe | `make canary-probe` | pass | Canary healthy / graph ready。 |
| release checklist | `make release-checklist` | completed / blocked | Report `f887ade2-9fef-4abf-b9e0-8ea8b9944423`。verdict は blocked。 |

## 3. Playwright MCP 実施結果

| 領域 | 対象 | 結果 | 証跡 | 備考 |
| --- | --- | --- | --- | --- |
| Preflight | login / health / 初期描画 | pass | `artifacts/testplay-report-2026-04-28-codex-playwright-mcp-followup/testplay-health.png`, `testplay-player-reset-initial.png`, `testplay-player-profile-ready.png` | health ok、login ok、auth-status authenticated、SP 10、catalog ready。profile 作成前は start-session が disabled。 |
| GESTALOKA Reference | reference smoke flow | UI issue ありで pass | `testplay-player-session-start.png`, `testplay-player-quest-complete.png`, `testplay-player-writ-used.png`, `testplay-player-oblivion-breach.png` | Nexus Gate、First Stabilizer Request 0/2、Gate Steward Rikka、Lift Tower Concourse、2/2 進行、Nexus Writ、Breach Restoration、writ used、Oblivion Breach への移動を確認。route state は更新されたが、unlock 後も一部 route/travel 説明が breach sealed のまま残る。 |
| Admin / Ops | catalog / projection / graph / SP / observability | pass | `testplay-admin-ops.png` | catalog ready、pack 1 / template 1 / failure 0。graph / embedding / Langfuse ready。projection pending / failed は 0 で安定。graph summary、relationship、chapter、route、SP ledger を確認。Idle pass で world tick / offstage beat が追加された。 |
| Release Dry-run | release gate / runbook 表示 | fail | `testplay-admin-release-blocked.png` | `release-gate-verdict` は blocked で、期待値の passed ではない。Smoke、failure injection、shadow replay、GESTALOKA pack regression が failed。runbook 表示の command 名は期待どおり。 |
| Responsive layout | 375x812 mobile Player | note ありで pass | `testplay-mobile-player.png` | 横スクロールなし（`scrollWidth=clientWidth=375`）。重なりは見えない。choice text は密だが読める。 |

## 4. UX 評価

| 領域 | 評価 | 観察 | 改善案 |
| --- | --- | --- | --- |
| Login | good | Keycloak 経由の sign in は完了し、Player UI に正常復帰した。 | なし。 |
| World select | good | playable world が自動選択され、catalog readiness も見える。 | なし。 |
| Player profile | good | profile 作成、選択済み profile 表示、profile 未選択時の開始 disabled が期待どおり動作した。 | なし。 |
| Turn execution wait | acceptable | turn execution は数十秒かかることがある。status は in-progress になり、完了後に choice wait へ戻る。 | 長い待ち時間中は action area 近くに progress phase をより目立つ形で出す。 |
| Choice / free text switch | acceptable | mode switch は動作し、free text mode で submit が表示される。 | mode switch 時は free text input を空にするか placeholder にする。現状の prefilled text は誤送信される可能性がある。 |
| SP shortage recovery | acceptable | SP は execution budget として表示され、Admin ledger でも turn cost を追える。 | dense な Admin ページでは adjustment controls を current balance の近くに寄せる。 |
| Player streams readability | acceptable | 重要な stream は更新されるが、ops や route/history text が非常に長くなる。 | raw JSON と長い stream entry は初期状態で折りたたむ。 |
| Admin information density | acceptable | 情報量は多いが、scope summary があり運用上は使える。 | release / SP / graph などへ移動できる anchor か sticky section navigation を追加する。 |
| Error display | acceptable | この実行では blocking error banner は出なかった。release dry-run 中の backend 再作成タイミングで frontend fetch error が一時的に console に出た。 | backend restart window 中の noisy な fetch error を抑制する。 |
| Responsive layout | good | mobile Player で横スクロールや text overlap は見えなかった。 | 長い日本語 choice を含む active-session mobile view の確認を継続する。 |
| Release gate readability | good | blocked reason、failed check、shadow failure category、runbook が読める。 | canary-down 後の現在状態と、保存済み release report snapshot の canary 状態を分けて見せる。 |

## 5. 不具合 / リグレッション

### Issue 1

- Severity: high
- Status: fixed in working tree
- Area: backend migration / compose startup
- URL: n/a
- World pack: n/a
- Session id: n/a
- Operation: `make verify-v2` / `docker compose up --build`
- Expected: PostgreSQL migration が head まで到達する。
- Actual: revision `0021_canonical_timeline_shared_locks` を書き込む際、backend が `psycopg.errors.StringDataRightTruncation: value too long for type character varying(32)` で終了した。
- Evidence: terminal output。修正箇所は `backend/alembic/versions/0021_canonical_timeline_shared_locks.py` と `tests/backend/engine/test_alembic.py`。
- Reproduction steps: 修正前に clean PostgreSQL volume から compose stack を起動する。
- Suggested fix: Alembic revision id を default の 32 文字 version table limit 内に収め、test でガードする。

### Issue 2

- Severity: medium
- Status: open
- Area: Player route/travel display
- URL: http://localhost:5173
- World pack: GESTALOKA Reference
- Session id: `edc41321-55ba-4d59-9bf4-e6782dee3525`
- Operation: First Stabilizer Request を完了し、Nexus Writ を使い、Oblivion Breach へ移動する。
- Expected: route/travel text が Oblivion Breach open 後の状態を反映する。
- Actual: Writ 使用後および travel 後も route/travel summary に "The breach route stays sealed until Nexus recognizes the writ." が残る。
- Evidence: `testplay-player-writ-used.png`, `testplay-player-oblivion-breach.png`, `testplay-mobile-player.png`。
- Reproduction steps: profile 作成、session 開始、progress を 2 回クリック、progress で Nexus Writ 使用、progress で travel。
- Suggested fix: item use 後は route state から表示用 copy を更新する。もしくは locked-route prerequisite text と opened-route summary を別に保持する。

### Issue 3

- Severity: high
- Status: open
- Area: Release dry-run
- URL: http://localhost:5173/admin
- World pack: GESTALOKA Reference
- Session id: `edc41321-55ba-4d59-9bf4-e6782dee3525`
- Operation: `make canary-up && make canary-probe && make release-checklist && make canary-down`
- Expected: guide 上は `release-gate-verdict` passed、promote ready を期待。
- Actual: release gate は blocked。smoke、failure injection、shadow replay、pack regression が failed。shadow failure には graph / retrieval / lane と、Oblivion Breach に対する candidate の schema / same-world failure が含まれる。
- Evidence: `testplay-admin-release-blocked.png`。report id `f887ade2-9fef-4abf-b9e0-8ea8b9944423`。
- Reproduction steps: 実行中 compose stack 上で release dry-run command chain を実行し、Admin release gate を refresh する。
- Suggested fix: failed eval run の case result と shadow failure を確認し、degraded graph/retrieval status の原因を切り分ける。live provider output、retrieval setup、gate expectation のどこが不整合か確認する。

### Issue 4

- Severity: low
- Status: open
- Area: Docker build
- URL: terminal
- World pack: n/a
- Session id: n/a
- Operation: `docker compose up --build -d`
- Expected: image build/export が成功する。
- Actual: frontend image export が一度 BuildKit snapshot parent missing で失敗した。事前に build 済みの image を使った `docker compose up -d` では起動できた。
- Evidence: terminal output。
- Reproduction steps: build/down を複数回繰り返した後に full compose build を実行する。
- Suggested fix: 再現しない限り Docker builder cache instability として扱う。再発する場合は `docker builder prune` で local cache を消す。

## 6. 実行コマンド

```bash
make verify-v2
PYTHONPATH=backend python -m pytest tests/backend/engine/test_alembic.py
docker compose up --build backend
docker compose down -v --remove-orphans
docker compose up --build -d
docker compose up -d
docker compose down -v --remove-orphans && docker compose up -d langfuse-web backend-canary frontend projection-worker world-scheduler release-scheduler grafana
curl -sS http://localhost:8000/health
docker compose ps
make canary-up && make canary-probe && make release-checklist && make canary-down
```

## 7. 最終サマリー

- Overall result: PostgreSQL 固有の Alembic startup blocker を修正した後、Player / Admin の探索的テストプレイは pass。Release dry-run は fail。
- Packs completed: GESTALOKA Reference / Nexus Foundation を Oblivion Breach travel まで完了。
- Release readiness: not ready。report `f887ade2-9fef-4abf-b9e0-8ea8b9944423` は blocked。
- Remaining risks: route unlock 後に stale な route/travel copy が残る、release gate checks が failed、Admin streams が非常に密、長い turn wait 中の local progress visibility が弱い。
- Follow-up tickets / tasks: release eval failure を調査する。route unlock copy を修正する。free-text placeholder behavior を検討する。Docker snapshot export failure が再発する場合は builder cache cleanup を行う。
