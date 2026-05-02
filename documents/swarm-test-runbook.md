# swarm-test Runbook

`swarm-test` は、複数ユーザーが同じ `world_id` で同時にプレイしたときの共有世界体験を評価する live provider 向けテストです。プレイ入力、生成される player-facing narrative、UX / gameplay / story 評価は日本語で実施します。

## 1. 前提

- 対象 world は `GESTALOKA Reference / Nexus Foundation`。
- `make swarm-test` / `make swarm-test-long` は、既存 stack が起動している場合も含め、必ず一度終了してから再ビルド・再起動します。稼働中 container を再利用すると、修正済みコードが backend / frontend process に反映されない可能性があります。

```bash
make swarm-test
```

- Keycloak realm には `swarm-a`, `swarm-b`, `swarm-c`, `swarm-ops` が必要です。上記の `docker compose down -v --remove-orphans` で古い realm volume を残さず初期化してください。
- `swarm-test` は live provider の揺れを評価対象に含めるため、`make verify-v2` の代替ではありません。

## 2. 実行

```bash
make swarm-test
```

デフォルトは short mode です。クエスト lifecycle を最後まで確認する場合は long mode を使います。

```bash
make swarm-test-long
# または
SWARM_TEST_MODE=long make swarm-test
```

主要な環境変数:

- `SWARM_API_BASE_URL`: default `http://localhost:8000`
- `SWARM_KEYCLOAK_TOKEN_URL`: default `http://localhost:8080/realms/gestaloka/protocol/openid-connect/token`
- `SWARM_TEST_MODE`: default `short`。`short` は既存の共有世界・競合・動的クエスト導入確認、`long` はそれに加えてクエスト離脱、離脱後探索、再開、epilogue 到達まで確認する。
- `SWARM_RUN_ID`: default は `make swarm-test` 実行開始時の UTC timestamp。
- `SWARM_RUN_GROUP_ID`: default は `git rev-parse --short=12 HEAD`。
- `SWARM_RUN_GROUP_DIR`: default `documents/testplay-reports/artifacts/swarm-test-commit-<SWARM_RUN_GROUP_ID>`
- `SWARM_ARTIFACT_DIR`: default `<SWARM_RUN_GROUP_DIR>/swarm-test-<SWARM_RUN_ID>`
- `SWARM_TURN_TIMEOUT_MS`: default `600000`
- `SWARM_TEST_TIMEOUT_MS`: default `1800000`
- `SWARM_POLL_TIMEOUT_MS`: default `120000`
- `SWARM_JUDGE_ENABLED`: default `true`。UX / gameplay / story の LLM judge を有効化する。設定不足時は warning として記録し、hard check は継続する。
- `SWARM_JUDGE_MODEL_ID`: default empty。未指定時は `MODEL_LITE_ID`、次に `MODEL_MAIN_ID` を使う。固定 model ID へ依存しない。
- `SWARM_JUDGE_TIMEOUT_MS`: default `120000`
- `SWARM_EXPERIENCE_WARNING_THRESHOLD`: default `3`。UX / gameplay / story / overall score がこの値未満なら warning として集計する。

## 3. ユーザーペルソナとプレイヤープロフィール

ユーザーペルソナは現実ユーザーの属性です。ゲーム内設定ではありません。

- user persona: 性別、年齢、職業、趣味、性格、動機、評価観点。
- derived player profile: user persona を元に作ったゲーム内プロフィール。`swarm-test` では play language を日本語に固定します。

user persona は `tests/e2e/swarm/userPersonas.xml` で管理します。現在は 30 persona を定義し、`swarm-test` 実行時に 3 persona を選びます。

- default: `SWARM_RUN_ID` を seed にして 30 persona から 3 persona を deterministic random selection。
- `SWARM_PERSONA_SEED`: selection seed を明示する。
- `SWARM_PERSONA_IDS`: comma-separated persona ids を指定し、ランダム選出を上書きする。

テスト runner は user persona を artifact に保存しますが、backend には derived player profile だけを送ります。選ばれた 3 persona は実行時に `swarm-a`, `swarm-b`, `swarm-c` のテスト用 Keycloak ユーザーへ割り当てます。

## 4. 評価軸

- Shared Impact: 自分の行動が他プレイヤーの記憶、噂、world beat、shared context に現れるか。
- Resource Conflict: 同じ NPC/location/route への同時圧力が破綻せず、resource constraint として記録されるか。
- World Event: broadcast や shared-world event が late join のプレイヤーにも体験されるか。
- Privacy / Separation: `occupation`, `hobbies`, `personality` など user persona 専用情報が runtime state、events、memories、shared-world context に漏れないか。
- UX Clarity: UI で session 開始、turn 実行、待機状態、choice/free-text 切替、主要 stream の読み取りが迷わずできるか。
- Gameplay Fun: ペルソナの動機に合う行動ができ、進行・競合・探索が意味ある結果として返るか。
- Story Progression: 直前行動、他プレイヤーの痕跡、scene / consequence / world beat の因果と連続性が読めるか。
- Quest Lifecycle: long mode では、動的クエストの prologue、body、離脱、paused 状態での探索、再開、completed + epilogue chapter 到達までが同じ `world_id` 上で成立するか。

## 5. Codex サブエージェント運用

探索評価では、各サブエージェントに 1 persona を割り当てます。

入力:

- user persona
- derived player profile
- 現在の UI state
- scenario objective
- 利用可能な choice または free-text constraints

出力:

- 選んだ行動
- 行動理由
- 期待した世界影響
- 観測された影響
- UX / gameplay / story / overall の score と warning
- `good / acceptable / needs work / blocked` の体験評価

## 6. 成果物

`swarm-test` は commit hash ごとの run group directory を作り、その配下に run ごとの folder を出力します。

```text
documents/testplay-reports/artifacts/
└── swarm-test-commit-<commit-hash>/
    ├── swarm-test-aggregate-report.md
    ├── swarm-test-aggregate-result.json
    └── swarm-test-<SWARM_RUN_ID>/
        ├── swarm-test-report-attempt-N.md
        ├── swarm-test-result-attempt-N.json
        ├── swarm-test-report.md
        └── swarm-test-result.json
```

run folder には以下を出力します。

- `swarm-test-result-attempt-N.json`
- `swarm-test-report-attempt-N.md`
- `swarm-test-result.json`: 最新 attempt の JSON コピー
- `swarm-test-report.md`: 最新 attempt の日本語 Markdown コピー
- `swarm-test-attempt-summary-result.json`: 同一 `SWARM_RUN_ID` 内の attempt を要約した JSON
- `swarm-test-attempt-summary-report.md`: 同一 `SWARM_RUN_ID` 内の attempt 要約 Markdown
- 各 persona の login 後 screenshot

run group folder には以下を出力します。

- `swarm-test-aggregate-result.json`: 同一 commit hash の複数 swarm run を統合した JSON
- `swarm-test-aggregate-report.md`: 現時点の実装コミットに対する日本語の総合評価レポート

総合レポートには hard check と persona 評価に加え、複数 run を通したストーリー展開、世界への影響、発生 event / turn の観測状況を記録します。

同一 `make swarm-test` 実行内で Playwright retry が発生しても、同じ `SWARM_RUN_ID` の run folder に attempt 番号付きで集約します。複数回の `make swarm-test` 実行結果は、同じ `SWARM_RUN_GROUP_ID` の run group folder 直下の総合レポートに集約します。

不具合化する場合は、run id、persona id、session id、turn id、event id、hard check 名を記録してください。
