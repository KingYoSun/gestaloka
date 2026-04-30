# swarm-test 総合レポート 2026-04-30T01-24-18-460Z

- 生成日時: 2026-04-30T02:37:23.935Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 失敗

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | report |
| --- | --- | --- | --- | --- |
| attempt-1 | 2026-04-30T01:28:34.513Z | 失敗 | Persona A: 小説愛好家=要改善<br>Persona B: MMO ゲーマー=良好<br>Persona C: IT エンジニア=良好 | swarm-test-report-attempt-1.md |

## ハードチェック総合

| 項目 | 最新 | 通過 attempt |
| --- | --- | --- |
| ユーザーペルソナとプレイヤープロフィールの分離 | 失敗 | 0/1 |
| 実行時データへのユーザーペルソナ漏えいなし | 失敗 | 0/1 |
| 全ターンが event_id を返す | 合格 | 1/1 |
| 全ターンイベントが同一 world_id に属する | 合格 | 1/1 |
| canonical sequence が一意 | 合格 | 1/1 |
| 共有世界への影響が観測可能 | 失敗 | 0/1 |
| リソース競合が記録される | 合格 | 1/1 |
| 世界イベントまたは制約が観測可能 | 合格 | 1/1 |

## ペルソナ別総合評価

### Persona A: 小説愛好家

- 最新評価: 要改善
- 最新観測: shared-world context のプローブで支援行動を確認できなかった。
- attempt-1: 評価=要改善; 観測=shared-world context のプローブで支援行動を確認できなかった。; 証跡=0d429348-d1c1-45c9-bf14-487de94f3a3e | ops shared-world trace

### Persona B: MMO ゲーマー

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- attempt-1: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。; 証跡=e55f1972-30e4-45e2-a7ad-81f00c76cd6b | event payload resource_constraints scan

### Persona C: IT エンジニア

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- attempt-1: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=72e16138-ef47-43f1-a2b9-0e88d3cd90ab | session state broadcast constraint scan

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

