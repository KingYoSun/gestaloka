# swarm-test attempt summary 2026-05-02T08-07-38Z

- 生成日時: 2026-05-02T08:20:40.550Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 合格

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | judge warnings | report |
| --- | --- | --- | --- | ---: | --- |
| attempt-1 | 2026-05-02T08:20:40.542Z | 合格 | ai-researcher=良好<br>speedrunner=良好<br>raid-planner=良好 | 3 | swarm-test-report-attempt-1.md |

## ハードチェック総合

| 項目 | 最新 | 通過 attempt |
| --- | --- | --- |
| ユーザーペルソナとプレイヤープロフィールの分離 | 合格 | 1/1 |
| 実行時データへのユーザーペルソナ漏えいなし | 合格 | 1/1 |
| 全ターンが event_id を返す | 合格 | 1/1 |
| 全ターンイベントが同一 world_id に属する | 合格 | 1/1 |
| canonical sequence が一意 | 合格 | 1/1 |
| 共有世界への影響が観測可能 | 合格 | 1/1 |
| リソース競合が記録される | 合格 | 1/1 |
| 世界イベントまたは制約が観測可能 | 合格 | 1/1 |
| 探索中表示が観測可能 | 合格 | 1/1 |
| 動的クエスト提示が観測可能 | 合格 | 1/1 |
| クエスト受諾 turn が解決 | 合格 | 1/1 |
| クエスト chapter が観測可能 | 合格 | 1/1 |
| クエスト lifecycle event が同一 world に属する | 合格 | 1/1 |

## ペルソナ別総合評価

### ai-researcher

- 最新評価: 良好
- 最新観測: 探索から任意クエストが提示され、受諾後の chapter が見える形で残った。
- attempt-1: 評価=良好; 観測=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; 証跡=6c76fd01-5aae-4f22-bc91-c65db608c89c | 099d7946-b19d-4976-8bc4-5739ef24d730 | quest journal / session state / ops history / memory scan

### speedrunner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- attempt-1: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。; 証跡=e0ac061b-a74a-4685-b1a0-a11954e83df3 | event payload resource_constraints scan

### raid-planner

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- attempt-1: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=d6022bad-0121-48ea-9f1d-9ef29c16af41 | session state broadcast constraint scan

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

