# swarm-test 実装評価レポート 906db58ae9a9

- 生成日時: 2026-05-02T12:58:16.977Z
- 実装コミット: 906db58ae9a9
- run group dir: /workspace/documents/testplay-reports/artifacts/swarm-test-commit-906db58ae9a9
- run 数: 1
- 完了 run: 1
- 合格 run: 1
- 失敗 run: 0
- レポート未生成 run: 0
- 最新完了 run: 2026-05-02T12-32-13Z
- 最新完了結果: 合格

## Run 一覧

| run_id | mode | 状態 | 作成日時 | world_id | report |
| --- | --- | --- | --- | --- | --- |
| 2026-05-02T12-32-13Z | long | 合格 | 2026-05-02T12:58:16.958Z | gestaloka_reference | swarm-test-2026-05-02T12-32-13Z/swarm-test-report.md |

## ストーリー展開・世界影響・イベント発生

| run_id | ストーリー展開 | 世界への影響 | 発生イベント |
| --- | --- | --- | --- |
| 2026-05-02T12-32-13Z | AI 研究者: クエスト提示で進行を実行<br>AI 研究者: クエスト受諾でクエスト受諾を実行<br>AI 研究者: クエスト進行で進行を実行<br>効率走者: リソース競合で進行を実行<br>AI 研究者: クエスト離脱でクエスト離脱を実行<br>AI 研究者: 離脱後探索で探索を実行<br>AI 研究者: クエスト再開でクエスト再開を実行<br>AI 研究者: クエストエピローグ進行で進行を実行<br>AI 研究者: クエストエピローグ進行で進行を実行<br>AI 研究者: クエストエピローグ進行で進行を実行<br>AI 研究者: クエストエピローグ進行で進行を実行<br>MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行 | クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。<br>同時行動の圧力により、resource constraint が記録された。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | AI 研究者 クエスト提示: f7a29a76-efe6-42db-b860-d99b8d04e001<br>AI 研究者 クエスト受諾: 62164993-d831-422d-9990-0584280576cd<br>AI 研究者 クエスト進行: 1c053852-7db9-4497-acd5-c7b91c41a4f0<br>効率走者 リソース競合: 2c4ead58-dd1a-48aa-9cfb-c9030b0f28a5<br>AI 研究者 クエスト離脱: f53cdd84-0d96-483b-b738-97fe68ef73dc<br>AI 研究者 離脱後探索: d58ca1c3-b2e1-4009-90e7-1c749014d5e5<br>AI 研究者 クエスト再開: c490bf7f-30df-4777-826c-a710bf4137ca<br>AI 研究者 クエストエピローグ進行: 282c6463-d321-4a0c-92b4-2ad7e9ba1fb4<br>AI 研究者 クエストエピローグ進行: b642c8b2-5393-4a81-b134-f16bb1bc2960<br>AI 研究者 クエストエピローグ進行: 5fda4ea1-e1bf-44aa-a7c6-6def0492fe52<br>AI 研究者 クエストエピローグ進行: 02914956-b5c4-4caa-adf7-e6f6f06beade<br>MMO レイド攻略者 世界イベント: 6575fc5d-e300-4106-8a48-1fcaa11589ba |

## Turn timing telemetry

- turn 数: 12
- HTTP duration: p50=114ms, p95=42058ms, max=42058ms
- final resolution duration: p50=45635ms, p95=126077ms, max=126077ms

| phase | samples | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| ambient_world_pass | 8 | 4255ms | 7028ms | 7028ms |
| choice_generation | 11 | 0ms | 0ms | 0ms |
| consequence_resolution | 7 | 6ms | 15ms | 15ms |
| dynamic_quest_offer | 7 | 2ms | 10ms | 10ms |
| intent_interpretation | 1 | 0ms | 0ms | 0ms |
| memory_materialization | 7 | 1402ms | 1500ms | 1500ms |
| narrative | 7 | 1622ms | 1892ms | 1892ms |
| post_state_build | 10 | 37ms | 66ms | 66ms |
| quest_lifecycle | 3 | 4ms | 6ms | 6ms |
| read_world_state_query | 1 | 0ms | 0ms | 0ms |
| resource_release | 7 | 2ms | 3ms | 3ms |
| response_localization | 12 | 24065ms | 66157ms | 66157ms |
| rules_arbiter | 5 | 0ms | 0ms | 0ms |
| safety_guard | 6 | 0ms | 0ms | 0ms |
| scene_framing | 8 | 41ms | 45ms | 45ms |
| shared_consequence | 7 | 708ms | 750ms | 750ms |
| timeline_broadcast | 11 | 10ms | 17ms | 17ms |
| travel_resolution | 1 | 0ms | 0ms | 0ms |
| world_progress | 1 | 3326ms | 3326ms | 3326ms |
| world_tag_updates | 7 | 7ms | 7ms | 7ms |

## シナリオ別の展開

### クエスト提示

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。
- 2026-05-02T12-32-13Z: 観測あり; 展開=AI 研究者: クエスト提示で進行を実行; 影響=クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。; event_ids=f7a29a76-efe6-42db-b860-d99b8d04e001

### クエスト受諾

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。
- 2026-05-02T12-32-13Z: 観測あり; 展開=AI 研究者: クエスト受諾でクエスト受諾を実行; 影響=クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。; event_ids=62164993-d831-422d-9990-0584280576cd

### クエスト進行

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。
- 2026-05-02T12-32-13Z: 観測あり; 展開=AI 研究者: クエスト進行で進行を実行; 影響=クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。; event_ids=1c053852-7db9-4497-acd5-c7b91c41a4f0

### リソース競合

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 2026-05-02T12-32-13Z: 観測あり; 展開=効率走者: リソース競合で進行を実行; 影響=同時行動の圧力により、resource constraint が記録された。; event_ids=2c4ead58-dd1a-48aa-9cfb-c9030b0f28a5

### クエスト離脱

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。
- 2026-05-02T12-32-13Z: 観測あり; 展開=AI 研究者: クエスト離脱でクエスト離脱を実行; 影響=クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。; event_ids=f53cdd84-0d96-483b-b738-97fe68ef73dc

### 離脱後探索

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。
- 2026-05-02T12-32-13Z: 観測あり; 展開=AI 研究者: 離脱後探索で探索を実行; 影響=クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。; event_ids=d58ca1c3-b2e1-4009-90e7-1c749014d5e5

### クエスト再開

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。
- 2026-05-02T12-32-13Z: 観測あり; 展開=AI 研究者: クエスト再開でクエスト再開を実行; 影響=クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。; event_ids=c490bf7f-30df-4777-826c-a710bf4137ca

### クエストエピローグ進行

- 観測 run: 1/1
- 発生 event 数: 4
- 最新観測: クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。
- 2026-05-02T12-32-13Z: 観測あり; 展開=AI 研究者: クエストエピローグ進行で進行を実行 / AI 研究者: クエストエピローグ進行で進行を実行 / AI 研究者: クエストエピローグ進行で進行を実行 / AI 研究者: クエストエピローグ進行で進行を実行; 影響=クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。; event_ids=282c6463-d321-4a0c-92b4-2ad7e9ba1fb4, b642c8b2-5393-4a81-b134-f16bb1bc2960, 5fda4ea1-e1bf-44aa-a7c6-6def0492fe52, 02914956-b5c4-4caa-adf7-e6f6f06beade

### 世界イベント

- 観測 run: 1/1
- 発生 event 数: 1
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-05-02T12-32-13Z: 観測あり; 展開=MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=6575fc5d-e300-4106-8a48-1fcaa11589ba


## UX・ゲームプレイ・ストーリー評価

- warning 件数: 3
- warning run: 1/1

| 評価軸 | 平均 score | 良好 | 許容 | 要改善 | ブロック |
| --- | ---: | ---: | ---: | ---: | ---: |
| UX 評価 | 3.7 | 2 | 1 | 0 | 0 |
| ゲームプレイの面白さ | 4 | 2 | 1 | 0 | 0 |
| ストーリー展開評価 | 4.3 | 3 | 0 | 0 | 0 |
| 総合体験 | 4 | 2 | 1 | 0 | 0 |

## LLM judge warnings

- 2026-05-02T12-32-13Z: ai-researcher: 一部のUIテキスト（クエストの進捗表示など）において、日本語と英語が混在している箇所があるため、ローカライズの統一を推奨する。
- 2026-05-02T12-32-13Z: speedrunner: リソース競合時の待機時間が長いため、プレイヤーがフリーズと誤認する可能性がある。
- 2026-05-02T12-32-13Z: raid-planner: なし

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

## ペルソナ別横断評価

### ai-researcher

- 最新評価: 良好
- 最新観測: クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=0
- 2026-05-02T12-32-13Z: 評価=良好; 観測=クエスト lifecycle が離脱、探索、再開、epilogue 完了まで到達した。

### speedrunner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=0
- 2026-05-02T12-32-13Z: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。

### raid-planner

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 評価分布: 良好=1, 許容=0, 要改善=0, ブロック=0
- 2026-05-02T12-32-13Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。

## 現時点の評価

- 少なくとも 1 run では、shared impact / resource conflict / world event / privacy separation の hard check が通過しています。
- 現時点の完了 run 群では、実装評価は合格です。

