# v2 Testplay Runbook

この runbook は、`rebuild_plan_v2.md` の Shared World Core 完了後に人間が実施する Full smoke
テストプレイ手順です。手動確認は playable surface と Ops 表示を対象にし、cross-player feedback の詳細な
正しさは `make shared-world-regressions` で固定します。

Codex Desktop の Browser Use で実施する場合は、補助手順
[codex-browser-use-testplay.md](codex-browser-use-testplay.md) と記録テンプレート
[testplay-report-template.md](testplay-report-template.md) を併用します。

## 1. 前提

- `.env` は `.env.example` から作成しておく。
- 起動は container-first を正とする。
- Player UI: `http://localhost:5173`
- Admin UI: `http://localhost:5173/admin`
- Langfuse: `http://localhost:3001`
- Demo login: `demo / demo-password`
- Bundled playable packs:
  - `GESTALOKA Reference / Nexus Foundation`
- 公式 smoke 検証は Make target 経由で `MODEL_PROVIDER=stub` / `EMBEDDING_PROVIDER=stub` 相当の設定を使う。
- 探索的な手動テストプレイでは `.env` の live provider 設定を使う。live provider を使わない確認は、`.env` 側で stub provider に寄せる。

## 2. Preflight

作業ツリーで以下を実行する。

```bash
make verify-v2
```

失敗した場合は、失敗箇所に応じて以下で切り分ける。

```bash
make backend-test
make pack-validate
make scan-pack-leaks
make shared-world-regressions
PYTHONPATH=backend python -m app.modules.eval_harness shared-world-health
make eval-pack-regressions
make frontend-e2e
```

`make verify-v2` が green になってから手動テストプレイへ進む。

## 3. Stack 起動

```bash
docker compose up --build
```

起動後、以下を確認する。

- `http://localhost:5173` が開ける。
- `http://localhost:5173/admin` が login 後に開ける。
- `http://localhost:8000/health` が `status` と database / projection / world pack health を返す。
- `http://localhost:3001` で Langfuse が開ける。

## 4. GESTALOKA Reference 手動テスト

1. Player UI で新しい session を開始できる状態にする。必要なら page refresh する。
2. world selector で `GESTALOKA Reference` を選択して session を開始する。
3. 以下を確認する。
   - WebSocket status が open
   - session pack が `GESTALOKA Reference (gestaloka_reference) / Nexus Foundation`
   - ops stream に `session.connected` と `GESTALOKA Reference`
   - ops stream に `missing world context` が出ない
   - ops stream に不適切な `global` 表示が出ない
   - current place が `Nexus Gate`
   - active quest が `First Stabilizer Request`
   - quest progress が `0/2`
   - local figures に `Gate Steward Rikka`
   - nearby routes または choices に `Lift Tower Concourse`
   - faction standing が表示される
4. `progress` choice を 2 回実行する。
5. 以下を確認する。
   - quest progress が `2/2`
   - inventory に `Nexus Writ`
   - `Nexus Writ` が route unlock 用 effect を持つ
   - choice list に writ / breach / restoration 系の選択肢
6. `progress` choice を実行する。
7. 以下を確認する。
   - active quest が `Breach Restoration`
   - quest stage が `breach_restoration`
   - inventory 上で `Nexus Writ` が used 扱い
   - nearby routes に `Oblivion Breach`
8. さらに `progress` choice を実行する。
9. 以下を確認する。
   - current place が `Oblivion Breach`
   - recent travel history に breach / restoration 系の変化
   - recent consequence history または recent scene history に Shared World Core の反映
   - faction standing、relationship summary、recent world beats のいずれかに turn 結果が反映される

## 5. Admin / Ops 確認

Admin UI で以下を確認する。

- Catalog health が ready。
- Catalog の pack 数が 1、template 数が 1、failure が 0。
- Pack/template context が world ごとに表示される。
- Projection の pending / failed が増え続けない。
- Graph runtime が ready または想定内の状態。
- Embedding runtime が ready または想定内の状態。
- Graph summary または Ops stream で faction projection が確認できる。
- Relationship ops、consequence threads、history / title の Ops 表示または regression 結果で Shared World Core の state が追える。
- SP overview と SP ledger で、turn 実行に応じた消費と調整が追える。
- SP は execution budget であり、世界内通貨、quest 進行力、title power として扱われていない。
- Operations health timeline が更新される。
- LLM observability が enabled の場合、Langfuse runtime status と base URL が表示される。

異常がある場合は、該当 world の session id、world id、pack id、template id、時刻、直前の操作を控える。

## 6. Release Dry-run

canary と release checklist を確認する。

```bash
make canary-up
make canary-probe
make release-checklist
```

nightly 相当の gate を確認する場合は以下も実行する。

```bash
make nightly-eval
```

promote 可能条件は以下。

```text
verdict == passed and canary_promote_status == ready
```

必須 check は以下。

```text
turn_resolution_smoke
turn_resolution_failure_injection
shadow_replay
shared_world_health
turn_resolution_gestaloka_regression
```

Admin UI の release gate でも以下を確認する。

- verdict が passed。
- canary_promote_status が ready。
- blocked reasons が空。
- cutover_status.promote_ready が true。
- missing checks がない。
- bundled pack regressions が `turn_resolution_gestaloka_regression` を含み、pass。
- shared_world_health が ready。
- shadow failures がない。
- canary health が healthy。
- runbook 表示の `canary_up`, `canary_probe`, `pre_promote_checklist`, `nightly_gate`, `promote_condition`, `promote`, `rollback` が実装と一致する。
- promote 表示が `cp config/release/candidate.yaml config/release/current.yaml && docker compose up -d --build backend`。
- rollback 表示が `make canary-down && docker compose up -d --build backend`。

## 7. Cleanup

canary を落とす。

```bash
make canary-down
```

テスト用 stack を完全に落として volume も消す場合は以下を実行する。

```bash
docker compose down -v --remove-orphans
```

手動テストの state を残して調査する場合は、volume を消さずに以下だけ実行する。

```bash
docker compose down --remove-orphans
```

## 8. Troubleshooting

- Login できない場合は、Keycloak の readiness と realm import を確認する。

```bash
docker compose logs keycloak
```

- Catalog が空または error の場合は、`PACK_DIR` と pack validation を確認する。

```bash
make pack-validate
docker compose logs backend
```

- turn が遅い、または model/embedding で失敗する場合は、`.env` の live provider API key を確認する。外部 provider を使わない smoke では stub provider 設定で再実行する。
- graph / projection が不調な場合は、backend、projection worker、Nebula init の log を確認する。

```bash
docker compose logs backend
docker compose logs projection-worker
docker compose logs nebula-init
```

- SP 不足で turn が進まない場合は、Admin UI の SP adjustment で demo player の balance を補充する。
- Shared World Core の health が ready ではない場合は、focused check で axis drift、memory gap、event integrity gap を確認する。

```bash
PYTHONPATH=backend python -m app.modules.eval_harness shared-world-health
make shared-world-regressions
```

## 9. 記録項目

テスト完了時に以下を残す。

- 実施日時
- git commit
- `.env` の provider 種別
- 実施した world pack
- `make verify-v2` 結果
- `make shared-world-regressions` 結果
- canary probe 結果
- release checklist 結果
- 発見した不具合と再現手順
