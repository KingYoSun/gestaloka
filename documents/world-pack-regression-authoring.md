# World Pack Regression 作成手順

この文書は、bundled world pack を追加または playable 化するときに必要な最小 release-gate 作業を固定します。

外部 pack archive の export/import 手順は [world-pack-operations.md](world-pack-operations.md) を参照してください。

## 現在の基準

現時点の bundled playable pack は以下です。

- pack: `gestaloka_reference`
- template: `nexus_foundation`
- regression dataset: `turn_resolution_gestaloka_regression`
- backend tests: `tests/backend/packs/gestaloka_reference/`
- Playwright smoke: `tests/e2e/gestaloka-reference-smoke.spec.ts`

新しい bundled pack は、この粒度を下回らない coverage を持たせます。

## 必須成果物

- 宣言的 pack を `packs/<pack_id>/` に追加する。
- pack manifest は `engine_api_version: v2` を使い、公開前は `visibility: private` / `publish_status: draft` を既定にする。
- pack 固有の prompt overlay は pack 内の `prompts.yaml` に置く。Python / TypeScript へ直書きしない。
- pack regression dataset を `evals/datasets/turn_resolution_<pack_short_name>_regression.yaml` に追加する。
- backend pack tests を `tests/backend/packs/<pack_id>/` に追加する。
- product UI で playable にする場合は `tests/e2e/` に Playwright smoke flow を追加する。
- dataset を `backend/app/modules/eval_harness/service.py` の `PACK_REGRESSION_DATASETS` に登録し、`make release-checklist` と `make nightly-eval` の必須 check にする。

## Dataset contract

- `prompt_id: session.turn_resolution` を使う。
- `expected_output_schema: council_turn_resolution_v1` を使う。
- すべての case に `pack_id` と `world_template_id` を設定する。
- 少なくとも starter progression case を 1 件含める。
- follow-up、reward unlock、route unlock、title/relationship/faction など、その pack の固有 progression を固定する case を 1 件以上含める。
- memory に依存する case では retrieval assertion を明示する。
  - `expect_retrieval_status: ready`
  - `expect_retrieval_min_hits`
  - 特定 memory を使う場合は `expect_retrieval_hit_substring`
- world 固有名詞は dataset と pack file に閉じ込める。engine module や shared frontend runtime へ混ぜない。
- case の `world_id` は dataset 内で一貫させ、cross-world 参照を作らない。

## Backend tests

backend pack tests では最低限以下を固定します。

- `/sessions` で pack/template 指定から session を開始できる。
- session response と state に `pack_id`、`world_template_id`、`world_pack` metadata が入る。
- starter location、opening chapter、starter quest、local figure、nearby route が pack 定義から seed される。
- progression により quest progress、reward item、route unlock、follow-up quest または follow-up location が期待どおり変わる。
- SP は execution budget として ledger に記録され、pack 固有報酬や progression power と混同されない。
- Shared World Core へ反映される history、relationship、faction、title、consequence が pack の意図に沿う。

## Playwright smoke

product UI に表示する pack は、E2E で以下を確認します。

- login 後、world selector に playable world として表示される。
- player profile 作成または選択後に session を開始できる。
- `session-pack` に pack display name と template display name が表示される。
- starter location、active quest、local figure、nearby route が表示される。
- choice flow で starter progression が進み、reward / unlock / follow-up が UI に反映される。
- ops stream に `missing world context` や不適切な `global` context 表示が出ない。
- mobile 375x812 viewport で横スクロールや主要 text overlap がない。

## Release gate 登録

`PACK_REGRESSION_DATASETS` に dataset ID を追加すると、以下に反映されます。

- `make eval-pack-regressions`
- `make nightly-eval`
- `make release-checklist`
- Admin Release 画面の bundled pack regressions 表示
- release checklist payload の `checks.pack_regressions` / `runs.pack_regressions`

release checklist では dataset の `pack_scope` に対象 `pack_id` と `world_template_id` が出ることを確認します。

## 検証

pack を release-gate ready と宣言する前に以下を実行します。

```bash
make pack-validate
make scan-pack-leaks
make eval-pack-regressions
make frontend-e2e
make verify-v2
```

`make verify-v2` は backend tests、pack validation、pack leak scan、v1 term scan、legacy check、shared-world regressions、pack regressions、frontend build、frontend E2E を含みます。

release checklist は新 dataset を `checks.pack_regressions` に含める必要があります。`cutover_status.promote_ready` は、必須 check がすべて通ったときだけ `true` になります。
