# swarm-test attempt summary 2026-05-02T09-06-48Z

- 生成日時: 2026-05-02T09:17:02.089Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 合格

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | judge warnings | report |
| --- | --- | --- | --- | ---: | --- |
| attempt-1 | 2026-05-02T09:17:02.080Z | 合格 | ai-researcher=良好<br>speedrunner=良好<br>raid-planner=良好 | 3 | swarm-test-report-attempt-1.md |

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
- attempt-1: 評価=良好; 観測=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; 証跡=e3a48a81-5462-43d7-a5c3-427b644f2b96 | 50636d2c-1f1f-4cb9-9350-972a52580c71 | quest journal / session state / ops history / memory scan

### speedrunner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- attempt-1: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。; 証跡=703b199a-82a9-4183-97be-5b6da0c32513 | event payload resource_constraints scan

### raid-planner

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- attempt-1: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=ab207c9e-5a20-43c9-9a74-2d34f645ae17 | session state broadcast constraint scan

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

