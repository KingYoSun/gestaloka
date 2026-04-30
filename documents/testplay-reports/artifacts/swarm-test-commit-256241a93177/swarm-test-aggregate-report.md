# swarm-test 実装評価レポート 256241a93177

- 生成日時: 2026-04-30T02:48:56.133Z
- 実装コミット: 256241a93177
- run group dir: documents/testplay-reports/artifacts/swarm-test-commit-256241a93177
- run 数: 6
- 完了 run: 3
- 合格 run: 1
- 失敗 run: 2
- レポート未生成 run: 3
- 最新完了 run: 2026-04-30T01-41-16-185Z
- 最新完了結果: 合格

## Run 一覧

| run_id | 状態 | 作成日時 | world_id | report |
| --- | --- | --- | --- | --- |
| 2026-04-30T01-20-16-522Z | 未完了 | - | - | 未生成 |
| 2026-04-30T01-24-18-460Z | 失敗 | 2026-04-30T01:28:34.513Z | gestaloka_reference | swarm-test-2026-04-30T01-24-18-460Z/swarm-test-report.md |
| 2026-04-30T01-30-23-228Z | 未完了 | - | - | 未生成 |
| 2026-04-30T01-36-09-976Z | 失敗 | 2026-04-30T01:40:19.276Z | gestaloka_reference | swarm-test-2026-04-30T01-36-09-976Z/swarm-test-report.md |
| 2026-04-30T01-41-16-185Z | 合格 | 2026-04-30T01:46:04.657Z | gestaloka_reference | swarm-test-2026-04-30T01-41-16-185Z/swarm-test-report.md |
| 2026-04-30T02-22-25-315Z | 未完了 | - | - | 未生成 |

## ハードチェック横断

| 項目 | 最新完了 run | 通過 run |
| --- | --- | --- |
| ユーザーペルソナとプレイヤープロフィールの分離 | 合格 | 1/3 |
| 実行時データへのユーザーペルソナ漏えいなし | 合格 | 2/3 |
| 全ターンが event_id を返す | 合格 | 3/3 |
| 全ターンイベントが同一 world_id に属する | 合格 | 3/3 |
| canonical sequence が一意 | 合格 | 3/3 |
| 共有世界への影響が観測可能 | 合格 | 1/3 |
| リソース競合が記録される | 合格 | 2/3 |
| 世界イベントまたは制約が観測可能 | 合格 | 3/3 |

## ペルソナ別横断評価

### Persona A: 小説愛好家

- 最新評価: 良好
- 最新観測: 支援行動が shared-world context に現れている。
- 評価分布: 良好=1, 許容=0, 要改善=2, ブロック=0
- 2026-04-30T01-24-18-460Z: 評価=要改善; 観測=shared-world context のプローブで支援行動を確認できなかった。
- 2026-04-30T01-36-09-976Z: 評価=要改善; 観測=shared-world context のプローブで支援行動を確認できなかった。
- 2026-04-30T01-41-16-185Z: 評価=良好; 観測=支援行動が shared-world context に現れている。

### Persona B: MMO ゲーマー

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 評価分布: 良好=2, 許容=0, 要改善=1, ブロック=0
- 2026-04-30T01-24-18-460Z: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。
- 2026-04-30T01-36-09-976Z: 評価=要改善; 観測=同時行動は完了したが、観測可能な resource constraint は残らなかった。
- 2026-04-30T01-41-16-185Z: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。

### Persona C: IT エンジニア

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 評価分布: 良好=3, 許容=0, 要改善=0, ブロック=0
- 2026-04-30T01-24-18-460Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-04-30T01-36-09-976Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-04-30T01-41-16-185Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。

## 現時点の評価

- 少なくとも 1 run では、shared impact / resource conflict / world event / privacy separation の hard check が通過しています。
- 2 run で hard check failure があり、該当項目の再確認が必要です。
- 3 run は完了レポート未生成です。live run の安定性または backend concurrency failure を別途確認してください。
- 現時点では体験要件を満たす run はありますが、失敗または未完了 run が残るため安定性評価は保留です。

