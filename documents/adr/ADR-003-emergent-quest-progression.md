# ADR-003: Emergent quest progression

## Status

Accepted

## Context

v2 のクエスト進行は決定論的なプラミングで駆動されていた:

- `_infer_choice_effect_contract` がプレイヤー入力本文をキーワード照合し `advance`/`complete`/`observe` を推測する。
- `_world_tags_for_effect_contract` がそこから `aid_local`/`promise_followup` を合成する。
- `QuestRuleEngine` が world_tags を計数し `progress` を `+1` する(`aid_local`/`promise_followup` 限定)。

この構造は AI GM の物語判断を一切経由しない。結果として探索・観察中心のプレイでは種クエストが永遠に進まず、報酬・後続・創発がすべて閉じてデッドロックした(testplay I1 / Issue #3)。さらに「最初のクエスト → 報酬アイテム(鍵)→ ルート解放 → 後続クエスト seed」という固定スパインが、世界状態と無関係に進行を一本道で固定していた。

決定論的にクエストが進むこと自体が gestaloka のプロダクト思想(動的な物語体験)に反する。pack 側で進行を逐次宣言する解法も、表現の幅をすぐに塞ぐため採らない。

## Decision

1. **AI GM がクエスト解決の一次判定者である。** アクティブクエストが解決したかは、AI GM がそのターンで生成した物語に基づく canonical 出力 `active_quest_resolution` で表明する。決定論コードの役割は「正本との照合・幻覚の拒否・適用」に限定する(AGENTS の deterministic code 規約と一致)。

2. **クエストに数値進行カウンタを持たせない。** クエストは `active`(進行中)→ `completed`(解決)の二状態。`progress` / `progress_target` / `completion_target` は廃止する。クエスト内のペーシングは既存の chapter / scene フレーム(`chapter_directive`, `scene_move`)が担う。

3. **アクセスと後続は固定スパインでなく世界状態と創発から生まれる。**
   - エリア/ルートのアクセスは「報酬アイテム=鍵」ではなく world-axis のしきい値とクエスト解決履歴で判定する(world-axis に gate 評価を追加)。複数の遊び方が同じ軸を押すため、到達経路は一意に固定されない。
   - 後続クエストは固定 seed でなく既存の創発系(`quest_offer` / `followup_quest_offer`)から発生する。アクティブクエスト解決で live quest が消えると `suppress_primary_offer_when_live_quest_exists` が自然に解除され、次の objective が提案可能になる。
   - pack は世界制約・場所・人物・物・公開 alias を素材として提供するが、post-first-turn の固定進行カードは持たない。

4. **LLM には内部メタデータを渡さない。** `active_quest_resolution` はクエスト ID を含まない。アクティブクエストは public game state として既に AI GM から見えており、サーバが単一のアクティブクエストを正本として照合する。

## Consequences

- 撤去: `_infer_choice_effect_contract`, `_world_tags_for_effect_contract`, `apply_quest_effect_contract` の complete 経路, `QuestRuleEngine`, `apply_world_tag_updates` のクエスト進行。world_tags は world/派閥 consequence 専用に戻る(派閥 standing は `ConsequenceRuleEngine` 経由で維持)。
- 追加: `CouncilWorldProgressPayload.active_quest_resolution`、`apply_active_quest_resolution`、world-axis しきい値による route gate 評価。
- `quest_resolution_hint`(非アクティブクエストの解決保留)と `active_quest_resolution`(アクティブクエストの即時解決)は「AI GM のクエスト解決判定」として対称に扱う。
- DB: `quest_assignments.progress` / `progress_target`、`quest_templates.completion_target` を削除する(alembic migration)。
- 契約変更につき後方互換は前提にしない(旧 turn payload / 旧セッション移行を要求しない)。
- 新たなソフトロック(AI GM が解決を出し渋る)を避けるため、world_progress プロンプトに解決判定の指示を明記し、eval / 回帰テスト(探索専一プレイでデッドロックしない)で固定する。

## Verification

- `PYTHONPATH=backend python -m pytest tests/backend`
- `cd frontend && npm run build`
- `make scan-v1-terms`
- ashlight_frontier: 探索・観察専一のターン列でアクティブクエストが解決へ到達し、後続が創発し得ることを回帰テストで固定する。
