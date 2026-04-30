# swarm-test 実装評価レポート ffbc2d0a7927

- 生成日時: 2026-04-30T06:01:28.575Z
- 実装コミット: ffbc2d0a7927
- run group dir: /workspace/documents/testplay-reports/artifacts/swarm-test-commit-ffbc2d0a7927
- run 数: 10
- 完了 run: 5
- 合格 run: 1
- 失敗 run: 4
- レポート未生成 run: 5
- 最新完了 run: 2026-04-30T05-52-33Z
- 最新完了結果: 合格

## Run 一覧

| run_id | 状態 | 作成日時 | world_id | report |
| --- | --- | --- | --- | --- |
| 2026-04-30T03-27-53Z | 未完了 | - | - | 未生成 |
| 2026-04-30T03-33-57Z | 未完了 | - | - | 未生成 |
| 2026-04-30T03-40-09Z | 未完了 | - | - | 未生成 |
| 2026-04-30T03-46-06Z | 未完了 | - | - | 未生成 |
| 2026-04-30T03-51-52Z | 未完了 | - | - | 未生成 |
| 2026-04-30T05-14-56Z | 失敗 | 2026-04-30T05:19:36.829Z | gestaloka_reference | swarm-test-2026-04-30T05-14-56Z/swarm-test-report.md |
| 2026-04-30T05-22-57Z | 失敗 | 2026-04-30T05:28:29.982Z | gestaloka_reference | swarm-test-2026-04-30T05-22-57Z/swarm-test-report.md |
| 2026-04-30T05-31-40Z | 失敗 | 2026-04-30T05:40:10.688Z | gestaloka_reference | swarm-test-2026-04-30T05-31-40Z/swarm-test-report.md |
| 2026-04-30T05-43-33Z | 失敗 | 2026-04-30T05:49:56.372Z | gestaloka_reference | swarm-test-2026-04-30T05-43-33Z/swarm-test-report.md |
| 2026-04-30T05-52-33Z | 合格 | 2026-04-30T06:01:28.568Z | gestaloka_reference | swarm-test-2026-04-30T05-52-33Z/swarm-test-report.md |

## ストーリー展開・世界影響・イベント発生

| run_id | ストーリー展開 | 世界への影響 | 発生イベント |
| --- | --- | --- | --- |
| 2026-04-30T03-27-53Z | 未生成 | 未生成 | 未生成 |
| 2026-04-30T03-33-57Z | 未生成 | 未生成 | 未生成 |
| 2026-04-30T03-40-09Z | 未生成 | 未生成 | 未生成 |
| 2026-04-30T03-46-06Z | 未生成 | 未生成 | 未生成 |
| 2026-04-30T03-51-52Z | 未生成 | 未生成 | 未生成 |
| 2026-04-30T05-14-56Z | なし | なし | なし |
| 2026-04-30T05-22-57Z | なし | なし | なし |
| 2026-04-30T05-31-40Z | なし | なし | なし |
| 2026-04-30T05-43-33Z | なし | なし | なし |
| 2026-04-30T05-52-33Z | 小説愛好家の編集者: 共有影響で進行を実行<br>小説愛好家の編集者: リソース競合で進行を実行<br>MMO レイド攻略者: リソース競合で進行を実行<br>因果検証エンジニア: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行 | 支援行動が shared-world context に現れている。<br>同時行動の圧力により、resource constraint が記録された。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | 小説愛好家の編集者 共有影響: 6fc6aa4f-0ca4-437e-8472-b456aace6234<br>小説愛好家の編集者 リソース競合: f32b7fa4-09cd-4731-844c-4a9efef987c1<br>MMO レイド攻略者 リソース競合: 1080a5a4-f67b-4474-b98f-6f7c52b7b9e5<br>因果検証エンジニア 世界イベント: 78e3c0ce-1e2e-4735-892a-216aeb61599c |

## シナリオ別の展開

### 共有影響

- 観測 run: 1/5
- 発生 event 数: 1
- 最新観測: 支援行動が shared-world context に現れている。
- 2026-04-30T05-14-56Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-22-57Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-31-40Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-43-33Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-52-33Z: 観測あり; 展開=小説愛好家の編集者: 共有影響で進行を実行; 影響=支援行動が shared-world context に現れている。; event_ids=6fc6aa4f-0ca4-437e-8472-b456aace6234

### リソース競合

- 観測 run: 1/5
- 発生 event 数: 2
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 2026-04-30T05-14-56Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-22-57Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-31-40Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-43-33Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-52-33Z: 観測あり; 展開=小説愛好家の編集者: リソース競合で進行を実行 / MMO レイド攻略者: リソース競合で進行を実行; 影響=同時行動の圧力により、resource constraint が記録された。; event_ids=f32b7fa4-09cd-4731-844c-4a9efef987c1, 1080a5a4-f67b-4474-b98f-6f7c52b7b9e5

### 世界イベント

- 観測 run: 1/5
- 発生 event 数: 1
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-04-30T05-14-56Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-22-57Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-31-40Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-43-33Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-04-30T05-52-33Z: 観測あり; 展開=因果検証エンジニア: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=78e3c0ce-1e2e-4735-892a-216aeb61599c


## ハードチェック横断

| 項目 | 最新完了 run | 通過 run |
| --- | --- | --- |
| ユーザーペルソナとプレイヤープロフィールの分離 | 合格 | 1/5 |
| 実行時データへのユーザーペルソナ漏えいなし | 合格 | 1/5 |
| 全ターンが event_id を返す | 合格 | 1/5 |
| 全ターンイベントが同一 world_id に属する | 合格 | 1/5 |
| canonical sequence が一意 | 合格 | 1/5 |
| 共有世界への影響が観測可能 | 合格 | 1/5 |
| リソース競合が記録される | 合格 | 1/5 |
| 世界イベントまたは制約が観測可能 | 合格 | 1/5 |

## ペルソナ別横断評価

### novel-editor

- 最新評価: 良好
- 最新観測: 支援行動が shared-world context に現れている。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=4
- 2026-04-30T05-14-56Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.
- 2026-04-30T05-22-57Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.
- 2026-04-30T05-31-40Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at observation_poll.
- 2026-04-30T05-43-33Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at observation_poll.
- 2026-04-30T05-52-33Z: 評価=良好; 観測=支援行動が shared-world context に現れている。

### raid-planner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=4
- 2026-04-30T05-14-56Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.
- 2026-04-30T05-22-57Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.
- 2026-04-30T05-31-40Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at observation_poll.
- 2026-04-30T05-43-33Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at observation_poll.
- 2026-04-30T05-52-33Z: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。

### causality-engineer

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=4
- 2026-04-30T05-14-56Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.
- 2026-04-30T05-22-57Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at resource_conflict_turns.
- 2026-04-30T05-31-40Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at observation_poll.
- 2026-04-30T05-43-33Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at observation_poll.
- 2026-04-30T05-52-33Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。

## 現時点の評価

- 少なくとも 1 run では、shared impact / resource conflict / world event / privacy separation の hard check が通過しています。
- 4 run で hard check failure があり、該当項目の再確認が必要です。
- 5 run は完了レポート未生成です。live run の安定性または backend concurrency failure を別途確認してください。
- 現時点では体験要件を満たす run はありますが、失敗または未完了 run が残るため安定性評価は保留です。

