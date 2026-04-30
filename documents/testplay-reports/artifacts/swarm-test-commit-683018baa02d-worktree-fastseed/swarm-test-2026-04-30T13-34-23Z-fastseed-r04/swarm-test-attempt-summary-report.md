# swarm-test attempt summary 2026-04-30T13-34-23Z-fastseed-r04

- 生成日時: 2026-04-30T13:40:53.404Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 合格

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | judge warnings | report |
| --- | --- | --- | --- | ---: | --- |
| attempt-1 | 2026-04-30T13:40:53.400Z | 合格 | ai-researcher=良好<br>speedrunner=良好<br>raid-planner=良好 | 2 | swarm-test-report-attempt-1.md |

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

## ペルソナ別総合評価

### ai-researcher

- 最新評価: 良好
- 最新観測: 支援行動が shared-world context に現れている。
- attempt-1: 評価=良好; 観測=支援行動が shared-world context に現れている。; 証跡=1a719bf1-af5d-4c27-a0b4-0b2d3980ac71 | 7655a6de-af2a-4d6c-80c3-40989a1a375d | session state / ops history / memory scan

### speedrunner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- attempt-1: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。; 証跡=30f41502-2b61-4819-9573-db552c256eed | event payload resource_constraints scan

### raid-planner

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- attempt-1: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=be6ce94a-4ffc-4117-be2e-6f7e1ba1eef1 | session state broadcast constraint scan

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

