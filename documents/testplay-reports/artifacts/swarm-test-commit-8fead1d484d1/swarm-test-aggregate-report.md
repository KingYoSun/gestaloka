# swarm-test 実装評価レポート 8fead1d484d1

- 生成日時: 2026-04-30T17:51:53.148Z
- 実装コミット: 8fead1d484d1
- run group dir: /workspace/documents/testplay-reports/artifacts/swarm-test-commit-8fead1d484d1
- run 数: 1
- 完了 run: 1
- 合格 run: 1
- 失敗 run: 0
- レポート未生成 run: 0
- 最新完了 run: 2026-04-30T17-47-28Z
- 最新完了結果: 合格

## Run 一覧

| run_id | 状態 | 作成日時 | world_id | report |
| --- | --- | --- | --- | --- |
| 2026-04-30T17-47-28Z | 合格 | 2026-04-30T17:51:53.140Z | gestaloka_reference | swarm-test-2026-04-30T17-47-28Z/swarm-test-report.md |

## ストーリー展開・世界影響・イベント発生

| run_id | ストーリー展開 | 世界への影響 | 発生イベント |
| --- | --- | --- | --- |
| 2026-04-30T17-47-28Z | AI 研究者: 共有影響で進行を実行<br>AI 研究者: リソース競合で進行を実行<br>効率走者: リソース競合で進行を実行<br>MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行 | 支援行動が shared-world context に現れている。<br>同時行動の圧力により、resource constraint が記録された。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | AI 研究者 共有影響: 8465f5df-7c02-4d6d-a2c4-85ad7331b90c<br>AI 研究者 リソース競合: ae3e3a81-2270-47cc-acfd-fee3b207d6ff<br>効率走者 リソース競合: e5c36ab0-697d-475b-ad77-0acadf4c0296<br>MMO レイド攻略者 世界イベント: eebfd661-42e3-4ea0-b673-e428f131804a |

## シナリオ別の展開

### 共有影響

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: 支援行動が shared-world context に現れている。
- 2026-04-30T17-47-28Z: 観測あり; 展開=AI 研究者: 共有影響で進行を実行; 影響=支援行動が shared-world context に現れている。; event_ids=8465f5df-7c02-4d6d-a2c4-85ad7331b90c

### リソース競合

- 観測 run: 1/1
- 発生 event 数: 2
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 2026-04-30T17-47-28Z: 観測あり; 展開=AI 研究者: リソース競合で進行を実行 / 効率走者: リソース競合で進行を実行; 影響=同時行動の圧力により、resource constraint が記録された。; event_ids=ae3e3a81-2270-47cc-acfd-fee3b207d6ff, e5c36ab0-697d-475b-ad77-0acadf4c0296

### 世界イベント

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-04-30T17-47-28Z: 観測あり; 展開=MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=eebfd661-42e3-4ea0-b673-e428f131804a


## UX・ゲームプレイ・ストーリー評価

- warning 件数: 1
- warning run: 1/1

| 評価軸 | 平均 score | 良好 | 許容 | 要改善 | ブロック |
| --- | ---: | ---: | ---: | ---: | ---: |
| UX 評価 | 3.7 | 2 | 1 | 0 | 0 |
| ゲームプレイの面白さ | 3.3 | 1 | 2 | 0 | 0 |
| ストーリー展開評価 | 3.7 | 2 | 1 | 0 | 0 |
| 総合体験 | 3.3 | 1 | 2 | 0 | 0 |

## LLM judge warnings

- 2026-04-30T17-47-28Z: speedrunner: 126秒の待機は効率走者の許容範囲を超える可能性が高い。

## ハードチェック横断

| 項目 | 最新完了 run | 通過 run |
| --- | --- | --- |
| ユーザーペルソナとプレイヤープロフィールの分離 | 合格 | 1/1 |
| 実行時データへのユーザーペルソナ漏えいなし | 合格 | 1/1 |
| 全ターンが event_id を返す | 合格 | 1/1 |
| 全ターンイベントが同一 world_id に属する | 合格 | 1/1 |
| canonical sequence が一意 | 合格 | 1/1 |
| 共有世界への影響が観測可能 | 合格 | 1/1 |
| リソース競合が記録される | 合格 | 1/1 |
| 世界イベントまたは制約が観測可能 | 合格 | 1/1 |

## ペルソナ別横断評価

### ai-researcher

- 最新評価: 良好
- 最新観測: 支援行動が shared-world context に現れている。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=0
- 2026-04-30T17-47-28Z: 評価=良好; 観測=支援行動が shared-world context に現れている。

### speedrunner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=0
- 2026-04-30T17-47-28Z: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。

### raid-planner

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=0
- 2026-04-30T17-47-28Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。

## 現時点の評価

- 少なくとも 1 run では、shared impact / resource conflict / world event / privacy separation の hard check が通過しています。
- 現時点の完了 run 群では、実装評価は合格です。

