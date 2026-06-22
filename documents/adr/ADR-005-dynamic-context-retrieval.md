# ADR-005: Dynamic context retrieval for public turns

## Status

Accepted

## Context

v2 の通常ターンは単発の公開 AI GM 呼び出し (`session.turn_resolution`, main_lane) で解決する。意味記憶の検索はその呼び出しの前に一度だけ行われ、クエリは生の `player_action_text` と静的な公開 session state から組み立てられていた (`_retrieval_query_for_public_turn`)。

この構造では、プレイヤーが会話の流れに含まれていなかった新要素を後出しで持ち込んだとき (例: 場所Aで NPC_B と話している最中に NPC_C について尋ねる)、その新要素の正準コンテキストを動的に注入できない。生入力の埋め込み類似度がたまたま該当記憶にヒットしない限り、AI GM は NPC_C を知らないまま応答し、不整合な物語を出す (Issue #20)。

「ユーザーの入力に対する後出しかつ動的な補完情報」を成立させるには、入力を解釈して参照先を特定し、その参照に紐づく正準コンテキストを取得する RAG 的な一段が必要になる。

ADR-004 の `addressed_people` / `addressed_absent` は「不在の人物に話しかけた時の場所整合」を扱うが、参照されたエンティティの正準設定そのものを注入はしない。これは別問題である。

## Decision

1. **context planner を一段挟む。** 新しい公開プロンプト `council.context_planner` (lite_lane) を追加する。入力は他の公開ターン入力と同じく public game state と exact `player_action_text` のみであり、公開 name/alias directory (`world_directory`) は参照認識用の public game state として扱う。出力は、会話に後から持ち込まれた／補完が必要な参照のリストで、各参照は公開名 (`name`)、カテゴリ (`category` ∈ person/place/thing/faction/event)、検索フォーカス文 (`search_focus`) を公開テキストとして持つ。planner は world id / actor id / quest id などの内部 id を発明しない。

2. **エンティティ解決とターゲット検索は決定論コードが行う。** サーバは planner の各参照を既存の正準索引 (`CanonicalPublicAliasIndex`、glossary、actor / location / item / faction テーブル) で正準エンティティに解決し、解決できたエンティティに紐づく記憶を `MemoryService.search` の `actor_id` / `location_id` / scope フィルタでターゲット検索する。決定論コードは行動や進行を決定しない (AGENTS の deterministic code 規約と一致)。

3. **解決結果は `public_game_context.referenced_context` として公開テキストのみで注入する。** 各エントリは `{name, category, public_summary, related_memories}` で構成し、内部 id を含めない。`session.turn_resolution` と `session.turn_resolution_repair` はこれを「会話に後から持ち込まれた要素の正準コンテキスト」として扱い、これと矛盾しない物語を出す。

4. **解決できない参照は何も注入しない。** pack / DB に存在しない名前の参照は referenced_context に幻覚エントリを作らずスキップする。実在するがシーン外のエンティティはコンテキストとして注入するが present 扱いにはしない (ADR-004 の present/addressed/mentioned 整合と衝突させない)。

5. **fail-open。** planner が失敗・空出力・タイムアウト・スキーマ不正のいずれであっても、`referenced_context` を空にして既存のベースライン記憶検索のみで通常通りターンを成立させる。planner の role run は監査のため記録する。レイテンシ低減のため planner はベースライン検索と並列実行する。

6. **First Turn は対象外。** opening はセッション作成時に pack 由来の決定論イベントとして配信され、planner を通る通常ターン経路に乗らない。

## Consequences

- 追加: `prompts/gm_council/context_planner.yaml`、`evals/datasets/council_context_planner_smoke.yaml`、`council_context_planner_v1` schema 登録、`CouncilContextPlannerPayload`、StubModelProvider の `council.context_planner` 分岐、エンティティ解決＋ターゲット検索の決定論ヘルパ、`public_game_context.referenced_context` フィールド。
- 公開ターン入力に `referenced_context` が加わるが、内部メタデータ規約 (`_assert_public_llm_payload` / FORBIDDEN keys) は維持する。
- フロントエンドのロジック変更は不要 (`public_game_context` は backend 内部の LLM 入力専用)。
- 追加コストは lite_lane planner 1 回とターゲット検索/ターン。参照が空ならコスト最小。
- planner 障害がターン全体のソフトロックを作らない (ADR-003 のソフトロック回避方針と一貫)。
- 契約変更につき後方互換は前提にしない (旧 turn payload / 旧セッション移行を要求しない)。

## Verification

- `PYTHONPATH=backend python -m pytest tests/backend`
- `make scan-v1-terms`
- `cd frontend && npm run build`
- 公開ターン入力に referenced_context が含まれ、シーン外参照の公開カードとターゲット記憶が注入されること、内部 id が漏れないこと、planner 失敗時に fail-open でターンが成立することを回帰テストで固定する。
