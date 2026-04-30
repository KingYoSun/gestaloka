# swarm-test 総合レポート 2026-04-30T01-36-09-976Z

- 生成日時: 2026-04-30T02:37:23.937Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 失敗

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | report |
| --- | --- | --- | --- | --- |
| attempt-1 | 2026-04-30T01:40:19.276Z | 失敗 | Persona A: 小説愛好家=要改善<br>Persona B: MMO ゲーマー=要改善<br>Persona C: IT エンジニア=良好 | swarm-test-report-attempt-1.md |

## ハードチェック総合

| 項目 | 最新 | 通過 attempt |
| --- | --- | --- |
| ユーザーペルソナとプレイヤープロフィールの分離 | 失敗 | 0/1 |
| 実行時データへのユーザーペルソナ漏えいなし | 合格 | 1/1 |
| 全ターンが event_id を返す | 合格 | 1/1 |
| 全ターンイベントが同一 world_id に属する | 合格 | 1/1 |
| canonical sequence が一意 | 合格 | 1/1 |
| 共有世界への影響が観測可能 | 失敗 | 0/1 |
| リソース競合が記録される | 失敗 | 0/1 |
| 世界イベントまたは制約が観測可能 | 合格 | 1/1 |

## ペルソナ別総合評価

### Persona A: 小説愛好家

- 最新評価: 要改善
- 最新観測: shared-world context のプローブで支援行動を確認できなかった。
- attempt-1: 評価=要改善; 観測=shared-world context のプローブで支援行動を確認できなかった。; 証跡=d8133e53-9326-44c8-9f2b-98c117f633d7 | 78be035f-7680-4b3a-9480-25ad41c09856 | session state / ops history / memory scan

### Persona B: MMO ゲーマー

- 最新評価: 要改善
- 最新観測: 同時行動は完了したが、観測可能な resource constraint は残らなかった。
- attempt-1: 評価=要改善; 観測=同時行動は完了したが、観測可能な resource constraint は残らなかった。; 証跡=55b3b451-4c6d-4945-b97d-77a3dc8cc23e | event payload resource_constraints scan

### Persona C: IT エンジニア

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- attempt-1: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=8e850dcc-aac7-4220-89e9-dfc4be18697e | session state broadcast constraint scan

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

