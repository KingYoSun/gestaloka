# GESTALOKA v2 Agent Guide

このファイルはポインタです。詳細な背景説明は書かず、実装判断に必要な最小限の事実だけを置きます。

## Read First
- AGENTS.local.md

## Source Of Truth

- 実装の最終的な真実はコードとテストです。
- 固定済み前提は [documents/adr/ADR-000-v2-foundation.md](documents/adr/ADR-000-v2-foundation.md) を参照してください。
- ゲーム進行 / AI GM 実践ルールは [GAME.md](GAME.md) を参照してください。
- フロントエンドの視覚設計ルールは [DESIGN.md](DESIGN.md) を参照してください。

## Architecture Rules

- v2 は same-world 前提です。プレイヤー/NPC/イベント/記憶は同じ `world_id` 名前空間に属さなければなりません。
- 正本は PostgreSQL 系です。グラフ更新は outbox 経由で投影し、同期直書きしないでください。
- 認証は OIDC adapter 境界の内側に閉じ込めてください。domain module から Keycloak 直接依存を作らないでください。
- プロンプトは `prompts/` に置き、Python/TypeScript へ直書きしないでください。
- 実装は `backend/app/modules/` の境界を保って追加し、横断ロジックを雑に共有層へ逃がさないでください。
- LLM 入力は public game state と exact `player_action_text` のみにしてください。`/turns` は `session_id` + `player_action_text` を正とし、ボタン選択・自由入力・クエスト関連操作はすべて表示本文由来の `player_action_text` として扱ってください。
- `suggested_actions` は public text の `label` / `summary` / `risk_hint` だけを持たせてください。deterministic code は行動決定ではなく、AI GM 出力の canonical state 照合・拒否・適用にだけ使ってください。
- First Turn 以外で pack / backend が次行動を決定的に固定しないでください。pack は世界制約、場所、人物、物、公開 alias、First Turn 導入素材を持ち、post-first-turn の固定進行カードとして扱わないでください。

## Forbidden

- v1 archived code からの import / copy-forward
- cross-world 参照
- Neo4j / neomodel の再導入
- 廃止済み/存在しない固定 model ID への依存
- Socket.IO 前提の復活
- 「他世界」「NPC化」「dispatch」を v2 実装語彙として復活させること
- LLM prompt に `choice_id`, `action_kind`, `action_type`, `target`, `item_id`, `quest_assignment_id`, `route_key`, hidden effect などの内部メタデータを渡すこと
- 旧 `/turns` payload や hidden choice/action metadata への後方互換を復活させること
- 「矛盾したら本文優先」のような曖昧な prompt 追加で設計問題を処理すること
- First Turn 後に static pack action / target で通常 turn を固定すること

## Verification

- バックエンド変更後: `PYTHONPATH=backend python -m pytest tests/backend`
- v1 用語の残骸確認: `make scan-v1-terms`
- フロント変更後: `cd frontend && npm run build`
- フルスタック確認: `docker compose up --build`

## Working Style

- 最小変更ではなく、全体最適の実装をしてください。
- 新しい設計判断は説明文書の追記ではなく ADR かテストで固定してください。
- コア turn contract 変更では後方互換を前提にせず、旧ローカル volume / 旧セッション移行を要求しないでください。
- 完了宣言の前に、触った層に対応する検証を必ず実行してください。
