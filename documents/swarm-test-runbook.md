# swarm-test Runbook

`swarm-test` は、複数ユーザーが同じ `world_id` で同時にプレイしたときの共有世界体験を評価する live provider 向けテストです。

## 1. 前提

- 対象 world は `GESTALOKA Reference / Nexus Foundation`。
- stack は起動済みにする。

```bash
docker compose up --build -d
```

- Keycloak realm には `swarm-a`, `swarm-b`, `swarm-c`, `swarm-ops` が必要です。既存 volume が古い realm を保持している場合は、テスト用環境で `docker compose down -v --remove-orphans` 後に起動し直してください。
- `swarm-test` は live provider の揺れを評価対象に含めるため、`make verify-v2` の代替ではありません。

## 2. 実行

```bash
make swarm-test
```

主要な環境変数:

- `SWARM_API_BASE_URL`: default `http://localhost:8000`
- `SWARM_KEYCLOAK_TOKEN_URL`: default `http://localhost:8080/realms/gestaloka/protocol/openid-connect/token`
- `SWARM_ARTIFACT_DIR`: default `documents/testplay-reports/artifacts/swarm-test-<run-id>`

## 3. ユーザーペルソナとプレイヤープロフィール

ユーザーペルソナは現実ユーザーの属性です。ゲーム内設定ではありません。

- user persona: 性別、年齢、職業、趣味、性格、動機、評価観点。
- derived player profile: user persona を元に作ったゲーム内プロフィール。

テスト runner は user persona を artifact に保存しますが、backend には derived player profile だけを送ります。

## 4. 評価軸

- Shared Impact: 自分の行動が他プレイヤーの記憶、噂、world beat、shared context に現れるか。
- Resource Conflict: 同じ NPC/location/route への同時圧力が破綻せず、resource constraint として記録されるか。
- World Event: broadcast や shared-world event が late join のプレイヤーにも体験されるか。
- Privacy / Separation: `occupation`, `hobbies`, `personality` など user persona 専用情報が runtime state、events、memories、shared-world context に漏れないか。

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
- `good / acceptable / needs work / blocked` の体験評価

## 6. 成果物

`swarm-test` は以下を出力します。

- `swarm-test-result.json`
- `swarm-test-report.md`
- 各 persona の login 後 screenshot

不具合化する場合は、run id、persona id、session id、turn id、event id、hard check 名を記録してください。

