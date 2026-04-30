# swarm-test 総合レポート 2026-04-30T01-41-16-185Z

- 生成日時: 2026-04-30T02:37:23.938Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 合格

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | report |
| --- | --- | --- | --- | --- |
| attempt-1 | 2026-04-30T01:46:04.657Z | 合格 | Persona A: 小説愛好家=良好<br>Persona B: MMO ゲーマー=良好<br>Persona C: IT エンジニア=良好 | swarm-test-report-attempt-1.md |

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

### Persona A: 小説愛好家

- 最新評価: 良好
- 最新観測: 支援行動が shared-world context に現れている。
- attempt-1: 評価=良好; 観測=支援行動が shared-world context に現れている。; 証跡=2fa116db-35f9-4324-8b65-57b8429c60a2 | 052efffc-98ac-4338-b8c0-a5ccb24d14b9 | session state / ops history / memory scan

### Persona B: MMO ゲーマー

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- attempt-1: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。; 証跡=410b78c7-890f-4bf1-b41c-48f03a9fca6f | event payload resource_constraints scan

### Persona C: IT エンジニア

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- attempt-1: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=f5d97a09-21d7-4366-9321-cd897c9ad2d6 | session state broadcast constraint scan

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

