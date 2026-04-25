# GESTALOKA v2 汎用テキストMMOエンジン転換プラン

最終更新: 2026-04-26

## 1. エグゼクティブサマリ

GESTALOKA v2 は、特定の世界観に密結合したアプリケーションではなく、**same-world 前提の汎用テキストMMOエンジン**として再定義する。

この方針転換により、`Founders Reach` は engine 本体の特例ではなく、`packs/founders_reach/` に入る **bundled reference pack** として扱う。engine 側は `sessions / actors / events / memories / prompt schema / persistence / projection / verification` を担い、世界観固有の設定は **宣言型 world pack** へ分離する。

現時点では、v2 の基盤 A〜D 相当、検証 hardening、engine pivot close-out、pack-aware realtime/admin/SP surface の close-out slice は完了している。次の主戦場は、新機能追加ではなく **release hardening / canary cutover completion** である。

## 2. 固定済み前提

| 項目 | v2の固定前提 | 備考 |
|---|---|---|
| 世界モデル | プレイヤー/NPC/イベント/記憶は同一 `world_id` 名前空間に属する | cross-world は禁止 |
| 正本 | PostgreSQL + pgvector | 主要状態、イベント、記憶、SP、監査の正本 |
| グラフ | NebulaGraph は投影ストア | outbox 経由で再構築可能にする |
| 認証境界 | OIDC adapter 境界の内側に閉じ込める | domain module から Keycloak 直接依存を作らない |
| プロンプト | `prompts/` で管理 | Python/TypeScript 直書きは禁止 |
| world pack | 宣言型のみ | 任意コード、任意 hook、任意 prompt schema は初期版では認めない |
| 公式検証経路 | container-first | `make build-frontend` / `make frontend-e2e` / `make verify-v2` |
| legacy | `legacy/v1/` は凍結済み参考資料 | import / copy-forward しない |

## 3. 現在地

### 3.1 進捗サマリ

| 区分 | 状態 | 現在の到達点 | 残課題 |
|---|---|---|---|
| A. foundation / repo hygiene | 完了 | same-world 前提、NebulaGraph 投影、Prompt Registry、SP、legacy 凍結が repo 全体に反映済み | なし |
| B. data foundation | 完了 | PostgreSQL 正本、pgvector、outbox、NebulaGraph 投影、`world_id` invariant が実装済み | なし |
| C. core domain slice | 完了 | session / actor / world_state / memory / event の same-world 基盤は動作中 | engine 化に向けた残ハードコード除去は継続 |
| D. model router / prompt / eval baseline | 完了 | model lanes、Prompt Registry、structured output 検証、eval harness、pack regression gate の基盤あり | なし |
| verification hardening | 完了 | `make build-frontend` / `make frontend-e2e` / `make verify-v2` / CI `verify-v2` を導入済み | なし |
| G. baseline freeze | 完了 | `Founders Reach` の既存体験を golden path として維持しつつ棚卸し開始済み | 追加棚卸しは runtime 一般化と並走 |
| H. pack contract | 完了 | `world_pack` module、`pack.yaml` contract、loader、discovery、version check、validator CLI/target を実装済み | なし |
| I. runtime generalization | 完了 | session bootstrap、seed、NPC 初期化、prompt overlay、branch / scene / consequence / ambient は pack-aware 化済み。pack leak scan も `verify-v2` に固定済み | なし |
| J. engine-first surface | 完了 | `GET /worlds/packs`、`POST /sessions` の `pack_id` / `world_template_id`、frontend pack selector を実装済み | なし |
| K. prompt / eval / tooling | 完了 | pack overlay 解決、pack validation、engine/pack test 階層、pack leak scan、pack regression dataset、release checklist 統合を実装済み | なし |
| L. generality proof | 完了 | `packs/ember_harbor/` で backend smoke / turn flow / world pack tests、frontend smoke E2E、pack regression を `verify-v2` に固定済み | なし |
| E/F 再定義後フェーズ | 完了 | realtime/admin/SP/admin eval と release hardening / canary cutover completion は完了 | なし |

### 3.2 実装済みの engine pivot first slice

- `backend/app/modules/world_pack/` に pack registry と loader を追加済み
- `packs/founders_reach/` を bundled reference pack として切り出し済み
- `packs/ember_harbor/` を bundled sample pack として追加済み
- `World.state` に `pack_id` / `world_template_id` を保持する migration を追加済み
- `GET /worlds/packs` により pack/template catalog を取得可能
- `POST /sessions` は `pack_id` / `world_template_id` 指定で world bootstrap 可能
- frontend の session start UI は pack/template 選択式に更新済み
- prompt overlay は active pack/template に応じて解決される
- `PACK_DIR` により filesystem ベースの pack discovery を切り替え可能
- realtime/admin/SP/eval/release gate の surface は pack/template context を表示し、eval case result と shadow failure も `pack_context` を返す
- `eval.run` trace は pack/template dimension を持つ
- release checklist は product cutover 用の `cutover_status` と make target ベースの runbook を返す
- bundled pack regression authoring guide を `documents/world-pack-regression-authoring.md` に固定済み

### 3.3 現時点の評価

現状の v2 は、もはや `Founders Reach` 専用アプリではなく、bundled pack を持つ engine-first runtime である。正しい表現は以下である。

- **engine 基盤** は汎用 engine として gate 固定済み
- **Founders Reach / Ember Harbor** は bundled pack regression として release checklist に入っている
- 次は **release hardening / canary cutover completion** を engine-first contract に揃える

## 4. 目標アーキテクチャ

### 4.1 engine core と world pack の責務分離

| 層 | 責務 |
|---|---|
| engine core | `sessions`, `actors`, `events`, `memories`, `relationships`, `same-world invariants`, `persistence`, `projection`, `prompt schema`, `verification`, `model lanes` |
| world pack | `world template`, `starter roster`, `locations`, `factions`, `quest graph`, `scene graph`, `branch graph`, `consequence table`, `semantic tags`, `prompt overlays`, `bootstrap copy` |

### 4.2 pack contract

pack manifest は少なくとも以下を持つ。

- `pack_id`
- `version`
- `engine_api_version`
- `display_name`
- `world_templates`
- `semantic_tags`
- `prompt_overlays`
- `content_refs`

pack は engine の出力契約を変更しない。`session.turn_resolution` や `council.*` の `prompt_id` と schema は engine 所有とし、pack は lore/tone/context の overlay だけを注入する。

### 4.3 engine-first 公開インターフェース

現時点の主な engine-first interface は以下。

- `GET /worlds/packs`
- `POST /sessions`
  - `world_id`
  - `pack_id`
  - `world_template_id`
  - `player_display_name`
  - `world_overrides`
- `PACK_DIR`
- frontend の pack/template selector
- `make build-frontend`
- `make frontend-e2e`
- `make verify-v2`
- `make eval-pack-regressions`
- GitHub Actions `verify-v2`

## 5. 更新後のフェーズ計画

### Phase A-D: v2 foundation

状態: 完了

完了済み内容:

- same-world 制約を v2 の固定前提にした
- PostgreSQL + pgvector を正本に固定した
- NebulaGraph を outbox 投影に固定した
- Prompt Registry / model lanes / eval harness の基盤を導入した
- SP ledger と observability の基礎を導入した

### Phase V: verification hardening

状態: 完了

完了済み内容:

- `make build-frontend` を container-first に統一
- `make frontend-e2e` を compose ベースに整備
- `make verify-v2` を canonical local/CI entrypoint に設定
- `verify-v2.yml` による GitHub Actions 実行を追加

### Phase G-H-J: engine pivot first slice

状態: 完了

完了済み内容:

- `Founders Reach` を core から切り出して `packs/founders_reach/` へ移行
- pack loader / discovery / version compatibility check を追加
- sample pack `ember_harbor` を追加
- session bootstrap を `pack_id` / `world_template_id` 中心に変更
- frontend を pack/template 中心の起動導線へ切り替え

### Phase I: runtime generalization

状態: 完了

完了済み内容:

1. `world_state`, `scene`, `branch`, `consequence`, `ambient`, `gm_council` の runtime は pack data を参照する
2. chapter key / branch label / reward effect / stage key は pack role / pack data から解決する
3. engine 層の bundled pack 固有語混入を `make scan-pack-leaks` で検出する
4. `make verify-v2` が pack leak scan を含む

完了済み条件:

- engine module 側に `Founders Reach` 固有名詞や固有 stage key が残らない
- progression と branch 遷移が pack 宣言だけで成立する
- `make verify-v2` が pack leak scan を含んで green になる

### Phase K: prompt / eval / tooling generalization

状態: 完了

完了済み内容:

1. `make verify-v2` に pack validation と pack leak scan を固定した
2. eval harness を `engine core dataset` と `pack regression dataset` の二段構成へ拡張した
3. bundled pack ごとの regression dataset を `make eval-pack-regressions` で隔離 SQLite DB 上に実行できるようにした
4. release checklist に `turn_resolution_founders_regression` / `turn_resolution_ember_regression` を組み込んだ

完了済み条件:

- engine suite が任意 pack に対して再利用できる
- `Founders Reach` 固有の narrative regression は pack-scoped suite に隔離される
- `Ember Harbor` も pack-scoped regression を持つ

### Phase L: generality proof

状態: 完了

完了済み内容:

1. `ember_harbor` で engine 共通テストを通す
2. `ember_harbor` 用の smoke E2E を追加済み
3. `Founders Reach` と異なる構造の pack でも bootstrap と progression が動くことを確認済み
4. `make verify-v2` で pack regression と smoke E2E を継続的に固定済み

完了済み条件:

- 2 本以上の structurally different pack が同じ engine suite を通る
- 2 本目 pack で smoke E2E が green
- 上記が `make verify-v2` の canonical gate で維持される

### Phase E/F 再定義: engine pivot 後の product cutover

状態: 完了

再定義後の内容:

- realtime/admin/SP を pack-aware surface に寄せる
- canary / shadow / release gate を engine-first contract に揃える
- release checklist を engine core + bundled packs 前提で再整理する

完了済み内容:

1. realtime payload と idle pass notification は `world_context` を必須化済み
2. admin world views / SP ledger / release checklist / eval run view は pack/template 表示へ寄せ済み
3. eval case result と release checklist shadow failure は `pack_context` を返す
4. `eval.run` trace は `eval.pack_ids` / `eval.world_template_ids` を記録する
5. release checklist は smoke / failure injection / shadow replay / bundled pack regressions / canary health / outbox / SP invariant を product cutover 条件として固定する
6. admin UI は verdict / blocked reasons / pack regressions / shadow failures / canary and SLO / runbook の順で release gate を表示する
7. 新 pack 追加時の regression dataset / smoke E2E / validation 手順を `documents/world-pack-regression-authoring.md` に固定する

## 6. 直近の実行順

### 6.1 次に行う縦切り

1. **external pack directory hardening**
   - `PACK_DIR` 差し替え時の validation / discovery / error reporting を product 運用前提に固める
2. **pack catalog / admin filtering UX**
   - pack/template が増えた場合の admin filtering と catalog 表示を整理する
3. **observability dashboard long-run cleanup**
   - release gate / canary / eval / pack dimensions を長期運用向けに見やすく整理する

### 6.2 その次に再開すること

1. external pack import/export の運用設計
2. pack catalog 権限・公開範囲の整理
3. multi-pack regression scale-out の所要時間削減

## 7. 完了条件

汎用テキストMMOエンジンへの転換が完了したと見なす条件は以下。

1. engine module が `Founders Reach` 固有名詞・固有 stage key・固有 branch key に依存していない
2. `Founders Reach` は 1 本の bundled reference pack としてのみ存在する
3. 2 本目の structurally different pack が engine 共通テストと smoke E2E を通る
4. prompt overlay は pack データだけで差し替わり、pack 側に任意コードがない
5. `make verify-v2` と CI が engine-first contract を前提に green である
6. その後に realtime/admin/SP/release gate の再切替が pack-aware で進められる

## 8. 現在の公式検証経路

実行コマンドは以下に固定する。

- `PYTHONPATH=backend python -m pytest tests/backend`
- `make scan-v1-terms`
- `make check-legacy`
- `make build-frontend`
- `make frontend-e2e`
- `make verify-v2`
- `make scan-pack-leaks`
- `make eval-pack-regressions`

`make verify-v2` は local / CI の公式入口とし、frontend build や Playwright smoke は host `npm` ではなく Compose 経由を正とする。

## 9. この文書の役割

この文書は、v2 の詳細仕様書ではなく、**現在の方針と移行順序を固定するための作業計画**である。固定済みの土台は ADR とコード/テストを優先し、この文書は次に何をやるべきか、何が完了したかを追うために使う。
