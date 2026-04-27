# World Pack Regression Authoring

This guide fixes the minimum release-gate work for adding a bundled world pack.

For external pack archive export/import operations, see [world-pack-operations.md](world-pack-operations.md).

## Required artifacts

- Add the declarative pack under `packs/<pack_id>/`.
- Add a pack regression dataset under `evals/datasets/turn_resolution_<pack_short_name>_regression.yaml`.
- Add backend pack tests under `tests/backend/packs/<pack_id>/`.
- Add a Playwright smoke flow under `tests/e2e/` when the pack is bundled in the product UI.
- Register the dataset in `PACK_REGRESSION_DATASETS` so `make release-checklist` and `make nightly-eval` require it.

## Dataset contract

- Use `prompt_id: session.turn_resolution` and `expected_output_schema: council_turn_resolution_v1`.
- Every case must set `pack_id` and `world_template_id`.
- Include at least one starter progression case and one follow-up or reward-unlock case.
- Include retrieval assertions when the case depends on memory:
  - `expect_retrieval_status: ready`
  - `expect_retrieval_min_hits`
  - `expect_retrieval_hit_substring` when a specific memory should be used
- Keep world-specific nouns in the dataset and pack files, not engine modules.

## Verification

Run these before declaring the pack release-gate ready:

```bash
make pack-validate
make eval-pack-regressions
make scan-pack-leaks
make frontend-e2e
make verify-v2
```

The release checklist must report the new dataset in `checks.pack_regressions`, and `cutover_status.promote_ready` must only become `true` when all required checks pass.
