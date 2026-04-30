# swarm-test attempt summary 2026-04-30T13-18-36Z-fastseed-r01

- 生成日時: 2026-04-30T13:24:39.926Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 合格

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | judge warnings | report |
| --- | --- | --- | --- | ---: | --- |
| attempt-1 | 2026-04-30T13:24:39.921Z | 合格 | ai-researcher=良好<br>speedrunner=良好<br>raid-planner=良好 | 1 | swarm-test-report-attempt-1.md |

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
- attempt-1: 評価=良好; 観測=支援行動が shared-world context に現れている。; 証跡=c7498d6a-8bf6-4780-a154-d8bdc0968709 | 66cc1736-01a4-47a8-bba1-ec768179354b | session state / ops history / memory scan

### speedrunner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- attempt-1: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。; 証跡=16a17f39-7613-41bf-8c8b-d1997e46c9e8 | event payload resource_constraints scan

### raid-planner

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- attempt-1: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=852e9c26-110a-42f8-a5d2-8884aeffea21 | session state broadcast constraint scan

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

