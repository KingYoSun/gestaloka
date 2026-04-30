# swarm-test 実装評価レポート 256241a93177

- 生成日時: 2026-04-30T03:00:09.921Z
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

## ストーリー展開・世界影響・イベント発生

| run_id | ストーリー展開 | 世界への影響 | 発生イベント |
| --- | --- | --- | --- |
| 2026-04-30T01-20-16-522Z | 未生成 | 未生成 | 未生成 |
| 2026-04-30T01-24-18-460Z | Persona A: 小説愛好家: 共有影響でprogressを実行<br>Persona A: 小説愛好家: リソース競合でprogressを実行<br>Persona B: MMO ゲーマー: リソース競合でprogressを実行<br>Persona C: IT エンジニア: 世界イベントでI compare the current gate reports with what travelers are saying and ask which recent action changed the local situation.を実行 | shared-world context のプローブで支援行動を確認できなかった。<br>同時行動の圧力により、resource constraint が記録された。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | Persona A: 小説愛好家 共有影響: 0d429348-d1c1-45c9-bf14-487de94f3a3e<br>Persona A: 小説愛好家 リソース競合: 7139d6a7-65f4-43ca-bc8c-e211bcf867c1<br>Persona B: MMO ゲーマー リソース競合: e55f1972-30e4-45e2-a7ad-81f00c76cd6b<br>Persona C: IT エンジニア 世界イベント: 72e16138-ef47-43f1-a2b9-0e88d3cd90ab |
| 2026-04-30T01-30-23-228Z | 未生成 | 未生成 | 未生成 |
| 2026-04-30T01-36-09-976Z | Persona A: 小説愛好家: 共有影響でprogressを実行<br>Persona A: 小説愛好家: リソース競合でprogressを実行<br>Persona B: MMO ゲーマー: リソース競合でprogressを実行<br>Persona C: IT エンジニア: 世界イベントでI compare the current gate reports with what travelers are saying and ask which recent action changed the local situation.を実行 | shared-world context のプローブで支援行動を確認できなかった。<br>同時行動は完了したが、観測可能な resource constraint は残らなかった。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | Persona A: 小説愛好家 共有影響: d8133e53-9326-44c8-9f2b-98c117f633d7<br>Persona A: 小説愛好家 リソース競合: 78be035f-7680-4b3a-9480-25ad41c09856<br>Persona B: MMO ゲーマー リソース競合: 55b3b451-4c6d-4945-b97d-77a3dc8cc23e<br>Persona C: IT エンジニア 世界イベント: 8e850dcc-aac7-4220-89e9-dfc4be18697e |
| 2026-04-30T01-41-16-185Z | Persona A: 小説愛好家: 共有影響でprogressを実行<br>Persona A: 小説愛好家: リソース競合でprogressを実行<br>Persona B: MMO ゲーマー: リソース競合でprogressを実行<br>Persona C: IT エンジニア: 世界イベントでI compare the current gate reports with what travelers are saying and ask which recent action changed the local situation.を実行 | 支援行動が shared-world context に現れている。<br>同時行動の圧力により、resource constraint が記録された。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | Persona A: 小説愛好家 共有影響: 2fa116db-35f9-4324-8b65-57b8429c60a2<br>Persona A: 小説愛好家 リソース競合: 052efffc-98ac-4338-b8c0-a5ccb24d14b9<br>Persona B: MMO ゲーマー リソース競合: 410b78c7-890f-4bf1-b41c-48f03a9fca6f<br>Persona C: IT エンジニア 世界イベント: f5d97a09-21d7-4366-9321-cd897c9ad2d6 |
| 2026-04-30T02-22-25-315Z | 未生成 | 未生成 | 未生成 |

## シナリオ別の展開

### 共有影響

- 観測 run: 1/3
- 発生 event 数: 3
- 最新観測: 支援行動が shared-world context に現れている。
- 2026-04-30T01-24-18-460Z: 観測なし; 展開=Persona A: 小説愛好家: 共有影響で進行を実行; 影響=shared-world context のプローブで支援行動を確認できなかった。; event_ids=0d429348-d1c1-45c9-bf14-487de94f3a3e
- 2026-04-30T01-36-09-976Z: 観測なし; 展開=Persona A: 小説愛好家: 共有影響で進行を実行; 影響=shared-world context のプローブで支援行動を確認できなかった。; event_ids=d8133e53-9326-44c8-9f2b-98c117f633d7
- 2026-04-30T01-41-16-185Z: 観測あり; 展開=Persona A: 小説愛好家: 共有影響で進行を実行; 影響=支援行動が shared-world context に現れている。; event_ids=2fa116db-35f9-4324-8b65-57b8429c60a2

### リソース競合

- 観測 run: 2/3
- 発生 event 数: 6
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 2026-04-30T01-24-18-460Z: 観測あり; 展開=Persona A: 小説愛好家: リソース競合で進行を実行 / Persona B: MMO ゲーマー: リソース競合で進行を実行; 影響=同時行動の圧力により、resource constraint が記録された。; event_ids=7139d6a7-65f4-43ca-bc8c-e211bcf867c1, e55f1972-30e4-45e2-a7ad-81f00c76cd6b
- 2026-04-30T01-36-09-976Z: 観測なし; 展開=Persona A: 小説愛好家: リソース競合で進行を実行 / Persona B: MMO ゲーマー: リソース競合で進行を実行; 影響=同時行動は完了したが、観測可能な resource constraint は残らなかった。; event_ids=78be035f-7680-4b3a-9480-25ad41c09856, 55b3b451-4c6d-4945-b97d-77a3dc8cc23e
- 2026-04-30T01-41-16-185Z: 観測あり; 展開=Persona A: 小説愛好家: リソース競合で進行を実行 / Persona B: MMO ゲーマー: リソース競合で進行を実行; 影響=同時行動の圧力により、resource constraint が記録された。; event_ids=052efffc-98ac-4338-b8c0-a5ccb24d14b9, 410b78c7-890f-4bf1-b41c-48f03a9fca6f

### 世界イベント

- 観測 run: 3/3
- 発生 event 数: 3
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-04-30T01-24-18-460Z: 観測あり; 展開=Persona C: IT エンジニア: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=72e16138-ef47-43f1-a2b9-0e88d3cd90ab
- 2026-04-30T01-36-09-976Z: 観測あり; 展開=Persona C: IT エンジニア: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=8e850dcc-aac7-4220-89e9-dfc4be18697e
- 2026-04-30T01-41-16-185Z: 観測あり; 展開=Persona C: IT エンジニア: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=f5d97a09-21d7-4366-9321-cd897c9ad2d6


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

