# World Pack Operations

This document fixes the v2 external world pack handoff path. External packs use the same declarative contract as bundled packs; they do not add engine code, hooks, prompt schemas, or migrations.

## Export

Export a validated pack from the active `PACK_DIR`:

```bash
make pack-export PACK_ID=ember_harbor PACK_ARCHIVE=dist/world-packs/ember_harbor-1.0.0.tar.gz
```

The archive contains one root directory named `<pack_id>/` and only:

- `pack.yaml`
- YAML files referenced by `content_refs`

The export command validates the pack before writing the archive. Invalid manifests, unsafe content refs, unsupported engine API versions, and symlinked content files fail with a JSON diagnostic.

## Import

Import an archive into the active `PACK_DIR`:

```bash
PACK_DIR=/path/to/external-packs make pack-import PACK_ARCHIVE=/path/to/ember_harbor-1.0.0.tar.gz
```

The import command extracts into a temporary directory, validates the pack, then copies it into `PACK_DIR/<pack_id>` only after validation succeeds. Existing packs are not overwritten by the Make target. Use the CLI directly when replacement is intentional:

```bash
PACK_DIR=/path/to/external-packs PYTHONPATH=backend python -m app.modules.world_pack import --archive /path/to/ember_harbor-1.0.0.tar.gz --replace
```

## Rejection Conditions

Import rejects archives that contain:

- anything other than `.tar.gz`
- absolute paths, parent-directory traversal, duplicate paths, symlinks, hard links, devices, or FIFOs
- multiple root directories
- a root directory that is not a valid pack slug
- a root name that does not match `pack.yaml` `pack_id`
- missing or invalid manifest/content YAML

## Release Gate Use

For a pack that should become bundled/product-visible, follow [world-pack-regression-authoring.md](world-pack-regression-authoring.md) after import validation. At minimum, add pack backend tests, a pack regression dataset, and smoke E2E coverage before registering it in release checklist requirements.
