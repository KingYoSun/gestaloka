# swarm-test attempt summary 2026-05-02T12-32-13Z

- 生成日時: 2026-05-02T12:58:16.971Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 合格

## Attempt 一覧

| attempt | mode | 作成日時 | 結果 | persona 評価 | judge warnings | report |
| --- | --- | --- | --- | --- | ---: | --- |
| attempt-1 | long | 2026-05-02T12:58:16.958Z | 合格 | ai-researcher=良好<br>speedrunner=良好<br>raid-planner=良好 | 3 | swarm-test-report-attempt-1.md |

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
| クエスト prologue が観測可能 | 合格 | 1/1 |
| クエスト離脱後 paused と再開操作が観測可能 | 合格 | 1/1 |
| クエスト離脱後の探索 turn が解決 | 合格 | 1/1 |
| クエスト再開が観測可能 | 合格 | 1/1 |
| クエスト epilogue が観測可能 | 合格 | 1/1 |

## ペルソナ別総合評価

### ai-researcher

- 最新評価: 良好
- 最新観測: クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。
- attempt-1: 評価=良好; 観測=クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。; 証跡=f7a29a76-efe6-42db-b860-d99b8d04e001 | 1c053852-7db9-4497-acd5-c7b91c41a4f0 | 282c6463-d321-4a0c-92b4-2ad7e9ba1fb4 | b642c8b2-5393-4a81-b134-f16bb1bc2960 | 5fda4ea1-e1bf-44aa-a7c6-6def0492fe52 | 02914956-b5c4-4caa-adf7-e6f6f06beade | quest journal / session state / ops history / memory scan

### speedrunner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- attempt-1: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。; 証跡=2c4ead58-dd1a-48aa-9cfb-c9030b0f28a5 | event payload resource_constraints scan

### raid-planner

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- attempt-1: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=6575fc5d-e300-4106-8a48-1fcaa11589ba | session state broadcast constraint scan

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

