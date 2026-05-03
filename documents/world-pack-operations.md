# World Pack 運用手順

この文書は、v2 の world pack を外部へ受け渡すための現行手順を固定します。外部 pack も bundled pack と同じ宣言的 contract を使います。engine code、hook、prompt schema、migration は pack へ追加しません。

## 現在の実装範囲

- pack の正本は `PACK_DIR` 配下の `<pack_id>/` です。既定値は repo root の `packs/` です。
- 現在 bundled されている playable pack は `gestaloka_world_reference`、template は `layered_world_foundation` です。
- CLI は `python -m app.modules.world_pack` で提供され、Make target から呼び出します。
- Admin UI / Admin API は scaffold 作成、archive import、pack publish status 更新、world template publish status 更新を提供します。
- export/import は `.tar.gz` archive のみ対応します。archive は 1 つの root directory `<pack_id>/` を持ちます。

## 一覧と検証

pack catalog の現状確認:

```bash
make pack-list
```

すべての pack を検証:

```bash
make pack-validate
```

1 pack だけ検証する場合:

```bash
PACK_DIR=/path/to/packs PYTHONPATH=backend python -m app.modules.world_pack validate --pack gestaloka_world_reference
```

検証が失敗した場合、CLI は JSON diagnostic を返します。`status=ready`、`failure_count=0`、期待する `pack_count` / `template_count` が揃っている状態を受け入れ条件にします。

## Export

有効な pack を現在の `PACK_DIR` から archive として書き出します。

```bash
make pack-export PACK_ID=gestaloka_world_reference PACK_ARCHIVE=dist/world-packs/gestaloka_world_reference-1.0.0.tar.gz
```

archive に含まれるものは以下だけです。

- `<pack_id>/pack.yaml`
- `pack.yaml` の `content_refs` が参照する YAML file

export 前に pack validation が走ります。manifest 不正、content ref 不正、未対応の `engine_api_version`、symlink content は JSON diagnostic 付きで失敗します。

## Import

archive を現在の `PACK_DIR` へ取り込みます。

```bash
PACK_DIR=/path/to/external-packs make pack-import PACK_ARCHIVE=/path/to/gestaloka_world_reference-1.0.0.tar.gz
```

import は一時 directory へ展開し、pack validation に成功してから `PACK_DIR/<pack_id>` へコピーします。Make target は既存 pack を上書きしません。

意図して置き換える場合だけ CLI を直接使います。

```bash
PACK_DIR=/path/to/external-packs PYTHONPATH=backend python -m app.modules.world_pack import --archive /path/to/gestaloka_world_reference-1.0.0.tar.gz --replace
```

Admin UI の Packs 画面から archive path を指定して import する場合、現在の UI は `replace=true` で `/admin/packs/import` を呼びます。既存 pack を守りたい運用では CLI の Make target を先に使って validation し、置き換え判断を明示してください。

## 拒否条件

import は以下を拒否します。

- `.tar.gz` 以外の archive
- absolute path、parent-directory traversal、duplicate path
- symlink、hard link、device、FIFO など通常 file/directory 以外の member
- 複数 root directory
- pack slug として不正な root directory 名
- root directory 名と `pack.yaml` の `pack_id` の不一致
- `pack.yaml` がない archive
- manifest または content YAML の schema 不正
- 既存 pack への上書き。ただし `--replace` 指定時を除く

## Admin での pack 操作

Admin frontend は `http://localhost:5174` で起動します。現在の pack 運用画面は以下を扱います。

- Dashboard: pack status、template 数、failure 数を表示します。
- Packs: catalog 表示、scaffold 作成、archive import、pack publish status の `playable` / `draft` 切替を扱います。
- World Templates: template の effective visibility / publish status を表示し、template publish status を切り替えます。

scaffold は最小 contract を満たす draft pack を作るための補助です。生成後に `pack.yaml`、`world_templates.yaml`、`npcs.yaml`、`prompts.yaml` を編集し、`make pack-validate` と release gate 用の regression を追加してください。

## Release Gate へ入れる条件

bundled/product-visible にする pack は、import validation だけでは完了ではありません。[world-pack-regression-authoring.md](world-pack-regression-authoring.md) に従い、少なくとも以下を追加します。

- `tests/backend/packs/<pack_id>/` の backend pack tests
- `evals/datasets/turn_resolution_<pack_short_name>_regression.yaml`
- product UI に表示する場合の Playwright smoke flow
- `PACK_REGRESSION_DATASETS` への dataset 登録

完了前に以下を実行します。

```bash
make pack-validate
make scan-pack-leaks
make eval-pack-regressions
make frontend-e2e
make verify-v2
```
