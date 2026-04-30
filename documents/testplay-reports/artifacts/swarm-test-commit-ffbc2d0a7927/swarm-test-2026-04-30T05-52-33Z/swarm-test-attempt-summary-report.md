# swarm-test attempt summary 2026-04-30T05-52-33Z

- 生成日時: 2026-04-30T06:01:28.572Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 合格

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | report |
| --- | --- | --- | --- | --- |
| attempt-1 | 2026-04-30T06:01:28.568Z | 合格 | novel-editor=良好<br>raid-planner=良好<br>causality-engineer=良好 | swarm-test-report-attempt-1.md |

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

### novel-editor

- 最新評価: 良好
- 最新観測: 支援行動が shared-world context に現れている。
- attempt-1: 評価=良好; 観測=支援行動が shared-world context に現れている。; 証跡=6fc6aa4f-0ca4-437e-8472-b456aace6234 | f32b7fa4-09cd-4731-844c-4a9efef987c1 | session state / ops history / memory scan

### raid-planner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- attempt-1: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。; 証跡=1080a5a4-f67b-4474-b98f-6f7c52b7b9e5 | event payload resource_constraints scan

### causality-engineer

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- attempt-1: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=78e3c0ce-1e2e-4735-892a-216aeb61599c | session state broadcast constraint scan

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

