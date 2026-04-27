# v2 Testplay Runbook

この runbook は、`rebuild_plan_v2.md` 完了後に人間が実施する Full smoke テストプレイ手順です。

## 1. 前提

- `.env` は `.env.example` から作成しておく。
- 起動は container-first を正とする。
- Player UI: `http://localhost:5173`
- Admin UI: `http://localhost:5173/admin`
- Langfuse: `http://localhost:3001`
- Demo login: `demo / demo-password`
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

## 4. Founders Reach 手動テスト

1. `http://localhost:5173` を開く。
2. `Sign in` から `demo / demo-password` で login する。
3. auth status が authenticated になり、SP balance が表示されることを確認する。
4. world selector で `Founders Reach` を選択して session を開始する。
5. 以下を確認する。
   - WebSocket status が open
   - session pack が `Founders Reach`
   - ops stream に `session.connected` と `Founders Reach`
   - ops stream に `missing world context` が出ない
   - ops stream に不適切な `global` 表示が出ない
   - current place が `Founders Square`
   - active quest が `First Watch Request`
   - quest progress が `0/2`
   - local figures に `Courier Pell`
   - nearby routes または choices に `Archive Steps`
6. `explore` choice を実行する。
7. current place が `Archive Steps` へ変わり、travel history と local figures に移動結果が出ることを確認する。
8. Admin UI へ移動し、idle pass を実行する。
9. 以下を確認する。
   - world tick stream に `idle_world_pass`
   - NPC location stream に pack 内 NPC の移動または状態変化
   - offstage beat が空表示のままではない
10. Player UI に戻り、ops stream に `idle.updated` と `Founders Reach` が出ることを確認する。
11. `safe` choice で `Founders Square` へ戻れることを確認する。
12. `progress` choice を 2 回実行し、以下を確認する。
   - quest progress が `1/2` から `2/2` へ進む
   - inventory に `Lantern Sigil`
   - relationship summary に trust / warm 系の変化
13. SP が足りない場合は Admin UI の SP adjustment で最低 6 以上に戻す。
14. `progress` choice を実行し、以下を確認する。
   - active quest が `Watch Path Unsealed`
   - quest stage が `watch_path_followup`
   - inventory 上で reward item が used 扱い
   - nearby routes に `Watch Path`
15. さらに `progress` choice を実行し、以下を確認する。
   - current place が `Watch Path`
   - current chapter に `watch path` または `Lantern Sigil`
   - local figures に `Lamplighter Sera`
16. Free text mode に切り替え、以下の入力を 1-2 回実行する。

```text
Archivist Neraとの約束を守り、Watch OathとしてLantern Sigilの務めを引き受ける
```

17. choice list または chapter summary に follow-up route / formal oath / watch path 系の変化が出ることを確認する。
18. `progress` choice を実行し、latest reaction、recent world beats、recent scene history に follow-up の反映があることを確認する。

## 5. Ember Harbor 手動テスト

1. Player UI で新しい session を開始できる状態にする。必要なら page refresh する。
2. world selector で `Ember Harbor` を選択して session を開始する。
3. 以下を確認する。
   - WebSocket status が open
   - session pack が `Ember Harbor`
   - ops stream に `session.connected` と `Ember Harbor`
   - ops stream に `missing world context` が出ない
   - ops stream に不適切な `global` 表示が出ない
   - current place が `Ember Quay`
   - active quest が `First Harbor Request`
   - quest progress が `0/2`
   - local figures に `Runner Eska`
4. `progress` choice を 2 回実行する。
5. 以下を確認する。
   - quest progress が `2/2`
   - inventory に `Harbor Seal`
   - choice list に seal / breakwater 系の選択肢
6. `progress` choice を実行する。
7. 以下を確認する。
   - active quest が `Breakwater Unsealed`
   - quest stage が `breakwater_unsealed`
   - inventory 上で `Harbor Seal` が used 扱い
   - nearby routes に `Cinder Breakwater`
8. さらに `progress` choice を実行する。
9. current place が `Cinder Breakwater` になり、travel history と chapter summary に breakwater / harbor 系の変化が出ることを確認する。

## 6. Admin / Ops 確認

Admin UI で以下を確認する。

- Catalog health が ready。
- Pack/template context が world ごとに表示される。
- Projection の pending / failed が増え続けない。
- Graph runtime が ready または想定内の状態。
- Embedding runtime が ready または想定内の状態。
- SP overview と SP ledger で、turn 実行に応じた消費と調整が追える。
- Operations health timeline が更新される。
- LLM observability が enabled の場合、Langfuse runtime status と base URL が表示される。

異常がある場合は、該当 world の session id、world id、pack id、template id、時刻、直前の操作を控える。

## 7. Release Dry-run

canary と release checklist を確認する。

```bash
make canary-up
make canary-probe
make release-checklist
```

promote 可能条件は以下。

```text
verdict == passed and canary_promote_status == ready
```

Admin UI の release gate でも以下を確認する。

- verdict が passed。
- blocked reasons が空。
- bundled pack regressions が pass。
- shadow failures がない。
- canary health が healthy。
- cutover status が ready。
- runbook 表示の `canary_up`, `canary_probe`, `pre_promote_checklist`, `rollback` が Make target と一致する。

## 8. Cleanup

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

## 9. Troubleshooting

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

## 10. 記録項目

テスト完了時に以下を残す。

- 実施日時
- git commit
- `.env` の provider 種別
- 実施した world pack
- `make verify-v2` 結果
- canary probe 結果
- release checklist 結果
- 発見した不具合と再現手順
