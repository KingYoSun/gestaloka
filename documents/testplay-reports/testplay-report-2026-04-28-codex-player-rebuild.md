# テストプレイレポート: Player 再構築

## 1. 実施情報

- 実施日時: 2026-04-28 13:20:14 JST
- 実施者 / Codex セッション: Codex / Playwright MCP
- git commit: `234d0d43ee07314e94a0259c0cf9685a3ee82e32`
- branch: `main`
- `.env` provider 種別: `MODEL_PROVIDER=gemini_developer_api`, `EMBEDDING_PROVIDER=gemini_developer_api`
- stack 起動方法: `docker compose up --build -d`
- Playwright MCP 対象 URL:
  - Player UI: `http://localhost:5173`
  - Admin UI: `http://localhost:5173/admin`
  - Backend health: `http://localhost:8000/health`
  - Langfuse: `http://localhost:3001`

## 2. 事前検証

| 確認項目 | コマンド | 結果 | メモ |
| --- | --- | --- | --- |
| v2 verify | `make verify-v2` | 失敗 | backend / pack / shared-world / frontend build は通過。`frontend-e2e` が最終 travel turn で disabled のまま timeout。 |
| shared world regressions | `make shared-world-regressions` | 成功 | `10 passed`; shared-world-health は `ready`。 |
| frontend e2e | `make frontend-e2e` | 失敗 | mobile overflow test は成功。reference smoke は最終 `choice-progress` が disabled のまま timeout。 |
| canary probe | `make canary-probe` | 失敗 | backend container 内 CLI が metrics port `9464` を再 bind して `Address already in use`。 |
| release checklist | `make release-checklist` | 未実行 | `canary-probe` 失敗により dry-run chain を停止。 |

## 3. Playwright MCP 実施結果

| 領域 | 対象 | 結果 | 証跡 | メモ |
| --- | --- | --- | --- | --- |
| 事前確認 | health / 初期描画 / login | 成功 | `01-backend-health.png`, `02-player-first-view.png`, `03-auth-world-start.png` | First View は `GESTALOKA` と 2 ボタンのみ。認証後は world selector / start / SP のみ。 |
| GESTALOKA Reference | reference smoke flow | 注記付き成功 | `04-session-started.png` - `07-after-oblivion-travel.png` | MCP 手動操作では Nexus Gate 開始、Writ 獲得、Writ used、Oblivion Breach 到達を確認。開始時 state は既存 world 状態の影響で `1/2` から開始。 |
| Admin / Ops | catalog / projection / graph / SP / observability | 成功 | `08-admin-ops.png`, `09-admin-idle-pass.png` | catalog ready、pack 1、template 1、failure 0、graph / embedding / Langfuse ready、idle pass 更新を確認。 |
| Release Dry-run | release gate / runbook 表示 | blocked | `10-release-gate-blocked.png` | canary-up は成功。canary-probe が metrics port bind で失敗。Admin release gate は checklist 未実行として blocked。 |
| レスポンシブ | 375x812 mobile | 注記付き成功 | `11-mobile-start.png`, `12-mobile-play.png` | 横スクロールなし。choice summary が長く、mobile では縦に非常に長い。 |

## 4. UX 評価

| 領域 | 評価 | 観察 | 改善案 |
| --- | --- | --- | --- |
| ログイン | 良好 | First View の操作が 2 つだけで迷いがない。 | なし。 |
| 世界選択 | 許容 | 認証後 UI は最小情報で成立。SP 表示も短い。 | catalog loading 時の短い状態ラベルがあると、世界選択が一時的に disabled の理由が分かる。 |
| ターン実行待ち | 許容 | `進行中` と disabled で二重送信は抑止できる。 | 長時間 pending 時の 1 文エラーまたは復帰が必要。e2e では最終 travel turn が pending 固着した。 |
| 選択肢 / 自由入力切替 | 良好 | 選択肢 / 自由入力の関係は明確。 | なし。 |
| SP 不足時の復旧 | 許容 | Player では SP を短く表示し、Admin で ledger が追える。 | SP 不足時の実 UI は今回未確認。 |
| Player stream の読みやすさ | 要改善 | choice summary が長く、内部状態に見える状態文が本文に混ざる。mobile では非常に長い。 | choice は label + 1 文 summary に抑え、backend 由来 summary の整形または短縮表示を入れる。 |
| Admin 情報密度 | 許容 | 主要 KPI は見えるがカードが多く縦に長い。 | Release / graph / SP などを task group 単位で折りたたむ余地あり。 |
| エラー表示 | 要改善 | backend が OTel retry で詰まった時、Player は world catalog が disabled になるだけで原因が見えない。 | health / catalog failure 時に 1 文だけ visible error を出す。 |
| レスポンシブレイアウト | 許容 | 横スクロールや重なりはなし。 | mobile play 中の choice card が長すぎるため情報設計改善が必要。 |
| Release gate の読みやすさ | 良好 | blocked / missing checks / runbook commands は読める。 | canary-probe 実行不能を解消後に passed 状態を再確認する。 |

## 5. 不具合 / 回帰

### 課題 1

- 重大度: 高
- 状態: working tree で修正済み
- 領域: Observability / stack health
- URL: `http://localhost:8000/health`
- ワールドパック: N/A
- セッション ID: N/A
- 操作: `docker compose up --build -d` 後に health / Player catalog を確認
- 期待: backend health が即時応答し、frontend が `/health`, `/worlds/playable` を読める
- 実際: backend が unhealthy になり、health request が timeout。backend log に `otel-collector:4318` connection refused と span export timeout。
- 証跡: `01-backend-health.png`; OTel collector log
- 再現手順:
  1. `docker compose up --build -d`
  2. `curl -m 5 http://localhost:8000/health`
  3. backend が timeout し、frontend world selector が disabled
- 修正案: `docker/otel-collector-config.yaml` の OTLP receiver を `0.0.0.0:4318` / `0.0.0.0:4317` で listen する。

### 課題 2

- 重大度: 高
- 状態: 未解決
- 領域: Release dry-run
- URL: N/A
- ワールドパック: N/A
- セッション ID: N/A
- 操作: `make canary-probe`
- 期待: backend container 内で canary probe が実行される
- 実際: CLI startup が Prometheus metrics port `9464` を再 bind し、`OSError: [Errno 98] Address already in use`
- 証跡: command output
- 再現手順:
  1. `docker compose up --build -d`
  2. `make canary-up`
  3. `make canary-probe`
- 修正案: one-off CLI 実行時は metrics server を起動しない、または `OTEL_METRICS_PORT=0` 等で衝突しない設定を Make target に入れる。

### 課題 3

- 重大度: 中
- 状態: 未解決
- 領域: Frontend e2e / stub flow
- URL: `http://localhost:5173`
- ワールドパック: `GESTALOKA Reference / Nexus Foundation`
- セッション ID: e2e isolated stack generated session
- 操作: Writ use 後の最終 `choice-progress`
- 期待: turn が解決され、現在地が `Oblivion Breach` になる
- 実際: `choice-progress` が 180 秒 disabled のまま。画面は Writ used / route unlocked state に留まる。
- 証跡: `frontend/test-results/gestaloka-reference-smoke--fe7d3--clear-the-nexus-smoke-flow/error-context.md`
- 再現手順:
  1. `make frontend-e2e`
  2. reference smoke flow の最終 travel step まで待つ
- 修正案: verify / stub stack の backend `/turns` を調査し、UI が `進行中` のまま固着しないよう server-side timeout / error propagation を追加する。

### 課題 4

- 重大度: 中
- 状態: 未解決
- 領域: Player UX
- URL: `http://localhost:5173`
- ワールドパック: `GESTALOKA Reference / Nexus Foundation`
- セッション ID: `65892bae-333a-4265-b98e-9f1d6b9b71e3`
- 操作: desktop / mobile で choice list を読む
- 期待: 次の行動が短時間で読み取れる
- 実際: 各 choice に長い生成 summary と重複した場面文が含まれる。
- 証跡: `04-session-started.png`, `12-mobile-play.png`
- 再現手順:
  1. login
  2. GESTALOKA Reference を開始
  3. choice list を確認
- 修正案: choice label を主表示にし、summary は 1 短文へ collapse / truncate する。または backend で player-facing short choice summary を提供する。

## 6. 実行コマンド

```bash
make verify-v2
make frontend-e2e
docker compose up --build -d
docker compose up -d --force-recreate otel-collector backend projection-worker backend-canary world-scheduler release-scheduler
make canary-up && make canary-probe && make release-checklist && make canary-down
make canary-down
```

## 7. 最終まとめ

- 総合結果: 部分成功 / release dry-run は blocked
- 完了 pack: `GESTALOKA Reference / Nexus Foundation` は Playwright MCP 手動 flow で成功
- リリース準備状況: not ready。`canary-probe` が blocked し、Admin release gate も blocked のまま。
- 残リスク:
  - verify / stub e2e の最終 travel turn が pending のまま固着する可能性がある
  - release CLI は metrics port collision により live backend container 内で実行できない
  - 選択肢の文量が Player copy budget に対して多すぎる
- 残タスク:
  - one-off eval CLI の metrics binding を修正する
  - stub `/turns` の final travel step hang を調査する
  - player choice summaries を短くする
