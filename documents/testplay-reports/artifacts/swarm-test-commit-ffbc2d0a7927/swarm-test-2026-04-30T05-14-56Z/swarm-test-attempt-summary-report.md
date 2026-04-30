# swarm-test attempt summary 2026-04-30T05-14-56Z

- 生成日時: 2026-04-30T05:19:36.838Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 失敗

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | report |
| --- | --- | --- | --- | --- |
| attempt-1 | 2026-04-30T05:19:36.829Z | 失敗 | novel-editor=ブロック<br>raid-planner=ブロック<br>causality-engineer=ブロック | swarm-test-report-attempt-1.md |

## ハードチェック総合

| 項目 | 最新 | 通過 attempt |
| --- | --- | --- |
| ユーザーペルソナとプレイヤープロフィールの分離 | 失敗 | 0/1 |
| 実行時データへのユーザーペルソナ漏えいなし | 失敗 | 0/1 |
| 全ターンが event_id を返す | 失敗 | 0/1 |
| 全ターンイベントが同一 world_id に属する | 失敗 | 0/1 |
| canonical sequence が一意 | 失敗 | 0/1 |
| 共有世界への影響が観測可能 | 失敗 | 0/1 |
| リソース競合が記録される | 失敗 | 0/1 |
| 世界イベントまたは制約が観測可能 | 失敗 | 0/1 |

## ペルソナ別総合評価

### novel-editor

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at resource_conflict_turns.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=/turns failed: 500 Internal Server Error

### raid-planner

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at resource_conflict_turns.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=/turns failed: 500 Internal Server Error

### causality-engineer

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at resource_conflict_turns.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.; 証跡=/turns failed: 500 Internal Server Error

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

