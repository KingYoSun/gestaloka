# swarm-test 実装評価レポート 7432270a665f

- 生成日時: 2026-05-01T13:15:33.368Z
- 実装コミット: 7432270a665f
- run group dir: /workspace/documents/testplay-reports/artifacts/swarm-test-commit-7432270a665f
- run 数: 1
- 完了 run: 1
- 合格 run: 1
- 失敗 run: 0
- レポート未生成 run: 0
- 最新完了 run: 2026-05-01T13-13-50Z
- 最新完了結果: 合格

## Run 一覧

| run_id | 状態 | 作成日時 | world_id | report |
| --- | --- | --- | --- | --- |
| 2026-05-01T13-13-50Z | 合格 | 2026-05-01T13:15:33.360Z | gestaloka_reference | swarm-test-2026-05-01T13-13-50Z/swarm-test-report.md |

## ストーリー展開・世界影響・イベント発生

| run_id | ストーリー展開 | 世界への影響 | 発生イベント |
| --- | --- | --- | --- |
| 2026-05-01T13-13-50Z | AI 研究者: 共有影響で進行を実行<br>AI 研究者: リソース競合で進行を実行<br>効率走者: リソース競合で進行を実行<br>MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行 | 支援行動が shared-world context に現れている。<br>同時行動の圧力により、resource constraint が記録された。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | AI 研究者 共有影響: 75057a41-d106-4944-915d-64b8957eea5f<br>AI 研究者 リソース競合: 9d8e395d-f4e3-435a-9f82-7d679757b6c4<br>効率走者 リソース競合: e3ad6dba-3745-4bdc-bfdf-c46de896abc5<br>MMO レイド攻略者 世界イベント: 8dc8b3aa-20f0-4a5b-8fdf-f3dce11b6ec1 |

## Turn timing telemetry

- turn 数: 4
- HTTP duration: p50=119ms, p95=211ms, max=211ms
- final resolution duration: p50=19099ms, p95=24071ms, max=24071ms

| phase | samples | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| ambient_world_pass | 3 | 0ms | 0ms | 0ms |
| choice_generation | 3 | 0ms | 0ms | 0ms |
| consequence_resolution | 3 | 0ms | 0ms | 0ms |
| intent_interpretation | 3 | 0ms | 0ms | 0ms |
| memory_council | 3 | 2246ms | 2342ms | 2342ms |
| narrative | 3 | 2207ms | 2385ms | 2385ms |
| npc_council | 3 | 2155ms | 2441ms | 2441ms |
| read_world_state_query | 1 | 0ms | 0ms | 0ms |
| rules_arbiter | 3 | 0ms | 0ms | 0ms |
| safety_guard | 3 | 0ms | 0ms | 0ms |
| scene_framing | 3 | 0ms | 0ms | 0ms |
| world_progress | 3 | 3687ms | 3700ms | 3700ms |

## シナリオ別の展開

### 共有影響

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: 支援行動が shared-world context に現れている。
- 2026-05-01T13-13-50Z: 観測あり; 展開=AI 研究者: 共有影響で進行を実行; 影響=支援行動が shared-world context に現れている。; event_ids=75057a41-d106-4944-915d-64b8957eea5f

### リソース競合

- 観測 run: 1/1
- 発生 event 数: 2
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 2026-05-01T13-13-50Z: 観測あり; 展開=AI 研究者: リソース競合で進行を実行 / 効率走者: リソース競合で進行を実行; 影響=同時行動の圧力により、resource constraint が記録された。; event_ids=9d8e395d-f4e3-435a-9f82-7d679757b6c4, e3ad6dba-3745-4bdc-bfdf-c46de896abc5

### 世界イベント

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-05-01T13-13-50Z: 観測あり; 展開=MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=8dc8b3aa-20f0-4a5b-8fdf-f3dce11b6ec1


## UX・ゲームプレイ・ストーリー評価

- warning 件数: 1
- warning run: 1/1

| 評価軸 | 平均 score | 良好 | 許容 | 要改善 | ブロック |
| --- | ---: | ---: | ---: | ---: | ---: |
| UX 評価 | 4 | 2 | 1 | 0 | 0 |
| ゲームプレイの面白さ | 3.7 | 2 | 1 | 0 | 0 |
| ストーリー展開評価 | 4.3 | 3 | 0 | 0 | 0 |
| 総合体験 | 4 | 3 | 0 | 0 | 0 |

## LLM judge warnings

- 2026-05-01T13-13-50Z: speedrunner: 一部のターンで待機時間が24秒に達しており、UX上のボトルネックになる可能性があります。

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
- 2026-05-01T13-13-50Z: 評価=良好; 観測=支援行動が shared-world context に現れている。

### speedrunner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=0
- 2026-05-01T13-13-50Z: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。

### raid-planner

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=0
- 2026-05-01T13-13-50Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。

## 現時点の評価

- 少なくとも 1 run では、shared impact / resource conflict / world event / privacy separation の hard check が通過しています。
- 現時点の完了 run 群では、実装評価は合格です。

