# swarm-test 実装評価レポート 72f56c2e076a

- 生成日時: 2026-05-02T10:08:05.014Z
- 実装コミット: 72f56c2e076a
- run group dir: /workspace/documents/testplay-reports/artifacts/swarm-test-commit-72f56c2e076a
- run 数: 7
- 完了 run: 7
- 合格 run: 4
- 失敗 run: 3
- レポート未生成 run: 0
- 最新完了 run: 2026-05-02T10-00-20Z
- 最新完了結果: 合格

## Run 一覧

| run_id | 状態 | 作成日時 | world_id | report |
| --- | --- | --- | --- | --- |
| 2026-05-02T07-48-20Z | 失敗 | 2026-05-02T07:50:22.019Z | gestaloka_reference | swarm-test-2026-05-02T07-48-20Z/swarm-test-report.md |
| 2026-05-02T07-55-42Z | 失敗 | 2026-05-02T07:58:54.280Z | gestaloka_reference | swarm-test-2026-05-02T07-55-42Z/swarm-test-report.md |
| 2026-05-02T08-00-50Z | 失敗 | 2026-05-02T08:05:47.090Z | gestaloka_reference | swarm-test-2026-05-02T08-00-50Z/swarm-test-report.md |
| 2026-05-02T08-07-38Z | 合格 | 2026-05-02T08:20:40.542Z | gestaloka_reference | swarm-test-2026-05-02T08-07-38Z/swarm-test-report.md |
| 2026-05-02T09-06-48Z | 合格 | 2026-05-02T09:17:02.080Z | gestaloka_reference | swarm-test-2026-05-02T09-06-48Z/swarm-test-report.md |
| 2026-05-02T09-39-40Z | 合格 | 2026-05-02T09:49:09.107Z | gestaloka_reference | swarm-test-2026-05-02T09-39-40Z/swarm-test-report.md |
| 2026-05-02T10-00-20Z | 合格 | 2026-05-02T10:08:05.002Z | gestaloka_reference | swarm-test-2026-05-02T10-00-20Z/swarm-test-report.md |

## ストーリー展開・世界影響・イベント発生

| run_id | ストーリー展開 | 世界への影響 | 発生イベント |
| --- | --- | --- | --- |
| 2026-05-02T07-48-20Z | なし | なし | なし |
| 2026-05-02T07-55-42Z | なし | なし | なし |
| 2026-05-02T08-00-50Z | なし | なし | なし |
| 2026-05-02T08-07-38Z | AI 研究者: クエスト提示で進行を実行<br>AI 研究者: クエスト受諾でクエスト受諾を実行<br>AI 研究者: クエスト進行で進行を実行<br>効率走者: リソース競合で進行を実行<br>MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行 | 探索から任意クエストが提示され、受諾後の chapter が見える形で残った。<br>同時行動の圧力により、resource constraint が記録された。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | AI 研究者 クエスト提示: 6c76fd01-5aae-4f22-bc91-c65db608c89c<br>AI 研究者 クエスト受諾: 4fcc71bb-0957-47b6-acd0-09b42092a0b4<br>AI 研究者 クエスト進行: 099d7946-b19d-4976-8bc4-5739ef24d730<br>効率走者 リソース競合: e0ac061b-a74a-4685-b1a0-a11954e83df3<br>MMO レイド攻略者 世界イベント: d6022bad-0121-48ea-9f1d-9ef29c16af41 |
| 2026-05-02T09-06-48Z | AI 研究者: クエスト提示で進行を実行<br>AI 研究者: クエスト受諾でクエスト受諾を実行<br>AI 研究者: クエスト進行で進行を実行<br>効率走者: リソース競合で進行を実行<br>MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行 | 探索から任意クエストが提示され、受諾後の chapter が見える形で残った。<br>同時行動の圧力により、resource constraint が記録された。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | AI 研究者 クエスト提示: e3a48a81-5462-43d7-a5c3-427b644f2b96<br>AI 研究者 クエスト受諾: 0c950f99-a45f-478a-951f-7a186fc073cb<br>AI 研究者 クエスト進行: 50636d2c-1f1f-4cb9-9350-972a52580c71<br>効率走者 リソース競合: 703b199a-82a9-4183-97be-5b6da0c32513<br>MMO レイド攻略者 世界イベント: ab207c9e-5a20-43c9-9a74-2d34f645ae17 |
| 2026-05-02T09-39-40Z | AI 研究者: クエスト提示で進行を実行<br>AI 研究者: クエスト受諾でクエスト受諾を実行<br>AI 研究者: クエスト進行で進行を実行<br>効率走者: リソース競合で進行を実行<br>MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行 | 探索から任意クエストが提示され、受諾後の chapter が見える形で残った。<br>同時行動の圧力により、resource constraint が記録された。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | AI 研究者 クエスト提示: 08f56c49-434c-4972-865c-bedf2b8b2663<br>AI 研究者 クエスト受諾: e8d0a7db-adfd-4128-9abf-51d0b6eb7d93<br>AI 研究者 クエスト進行: d80c6c46-de99-4fd1-a29d-1c4a6afb6d0e<br>効率走者 リソース競合: 4345c6e4-0c7f-4c36-b484-8332a437098b<br>MMO レイド攻略者 世界イベント: ab5906d4-4cab-4aac-8d09-ea4abdd3595d |
| 2026-05-02T10-00-20Z | AI 研究者: クエスト提示で進行を実行<br>AI 研究者: クエスト受諾でクエスト受諾を実行<br>AI 研究者: クエスト進行で進行を実行<br>効率走者: リソース競合で進行を実行<br>MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行 | 探索から任意クエストが提示され、受諾後の chapter が見える形で残った。<br>同時行動の圧力により、resource constraint が記録された。<br>遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。 | AI 研究者 クエスト提示: 17e9f5cd-9231-4526-a613-6db14792064e<br>AI 研究者 クエスト受諾: 3d85a2fa-196d-499c-9b95-aefc7b09e191<br>AI 研究者 クエスト進行: da8f0970-6438-47af-924b-1c6c97a4ee06<br>効率走者 リソース競合: 0f536a77-30ad-4a82-8bf7-cb17f4a5eccc<br>MMO レイド攻略者 世界イベント: b753b53e-f7ea-442e-878f-ad3874d4b8ea |

## Turn timing telemetry

- turn 数: 21
- HTTP duration: p50=130ms, p95=410ms, max=451ms
- final resolution duration: p50=36595ms, p95=124266ms, max=154051ms

| phase | samples | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| ambient_world_pass | 14 | 5069ms | 5613ms | 5613ms |
| choice_generation | 19 | 0ms | 0ms | 0ms |
| consequence_resolution | 14 | 6ms | 13ms | 13ms |
| dynamic_quest_offer | 9 | 3ms | 5ms | 5ms |
| intent_interpretation | 5 | 0ms | 0ms | 0ms |
| memory_council | 5 | 1826ms | 1860ms | 1860ms |
| memory_materialization | 9 | 1392ms | 1432ms | 1432ms |
| narrative | 14 | 1924ms | 2202ms | 2202ms |
| npc_council | 5 | 2003ms | 2123ms | 2123ms |
| post_state_build | 12 | 44ms | 53ms | 53ms |
| quest_lifecycle | 5 | 4ms | 7ms | 7ms |
| read_world_state_query | 4 | 0ms | 0ms | 0ms |
| resource_release | 9 | 2ms | 3ms | 3ms |
| response_localization | 10 | 3ms | 6ms | 6ms |
| rules_arbiter | 12 | 0ms | 0ms | 0ms |
| safety_guard | 14 | 0ms | 0ms | 0ms |
| scene_framing | 14 | 39ms | 53ms | 53ms |
| shared_consequence | 9 | 747ms | 803ms | 803ms |
| timeline_broadcast | 15 | 14ms | 19ms | 19ms |
| world_progress | 7 | 3575ms | 4099ms | 4099ms |
| world_tag_updates | 9 | 1ms | 9ms | 9ms |

## シナリオ別の展開

### クエスト提示

- 観測 run: 4/7
- 発生 event 数: 4
- 最新観測: 探索から任意クエストが提示され、受諾後の chapter が見える形で残った。
- 2026-05-02T07-48-20Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T07-55-42Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T08-00-50Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T08-07-38Z: 観測あり; 展開=AI 研究者: クエスト提示で進行を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=6c76fd01-5aae-4f22-bc91-c65db608c89c
- 2026-05-02T09-06-48Z: 観測あり; 展開=AI 研究者: クエスト提示で進行を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=e3a48a81-5462-43d7-a5c3-427b644f2b96
- 2026-05-02T09-39-40Z: 観測あり; 展開=AI 研究者: クエスト提示で進行を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=08f56c49-434c-4972-865c-bedf2b8b2663
- 2026-05-02T10-00-20Z: 観測あり; 展開=AI 研究者: クエスト提示で進行を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=17e9f5cd-9231-4526-a613-6db14792064e

### クエスト受諾

- 観測 run: 4/7
- 発生 event 数: 4
- 最新観測: 探索から任意クエストが提示され、受諾後の chapter が見える形で残った。
- 2026-05-02T07-48-20Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T07-55-42Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T08-00-50Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T08-07-38Z: 観測あり; 展開=AI 研究者: クエスト受諾でクエスト受諾を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=4fcc71bb-0957-47b6-acd0-09b42092a0b4
- 2026-05-02T09-06-48Z: 観測あり; 展開=AI 研究者: クエスト受諾でクエスト受諾を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=0c950f99-a45f-478a-951f-7a186fc073cb
- 2026-05-02T09-39-40Z: 観測あり; 展開=AI 研究者: クエスト受諾でクエスト受諾を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=e8d0a7db-adfd-4128-9abf-51d0b6eb7d93
- 2026-05-02T10-00-20Z: 観測あり; 展開=AI 研究者: クエスト受諾でクエスト受諾を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=3d85a2fa-196d-499c-9b95-aefc7b09e191

### クエスト進行

- 観測 run: 4/7
- 発生 event 数: 4
- 最新観測: 探索から任意クエストが提示され、受諾後の chapter が見える形で残った。
- 2026-05-02T07-48-20Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T07-55-42Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T08-00-50Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T08-07-38Z: 観測あり; 展開=AI 研究者: クエスト進行で進行を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=099d7946-b19d-4976-8bc4-5739ef24d730
- 2026-05-02T09-06-48Z: 観測あり; 展開=AI 研究者: クエスト進行で進行を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=50636d2c-1f1f-4cb9-9350-972a52580c71
- 2026-05-02T09-39-40Z: 観測あり; 展開=AI 研究者: クエスト進行で進行を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=d80c6c46-de99-4fd1-a29d-1c4a6afb6d0e
- 2026-05-02T10-00-20Z: 観測あり; 展開=AI 研究者: クエスト進行で進行を実行; 影響=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。; event_ids=da8f0970-6438-47af-924b-1c6c97a4ee06

### リソース競合

- 観測 run: 4/7
- 発生 event 数: 4
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 2026-05-02T07-48-20Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T07-55-42Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T08-00-50Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T08-07-38Z: 観測あり; 展開=効率走者: リソース競合で進行を実行; 影響=同時行動の圧力により、resource constraint が記録された。; event_ids=e0ac061b-a74a-4685-b1a0-a11954e83df3
- 2026-05-02T09-06-48Z: 観測あり; 展開=効率走者: リソース競合で進行を実行; 影響=同時行動の圧力により、resource constraint が記録された。; event_ids=703b199a-82a9-4183-97be-5b6da0c32513
- 2026-05-02T09-39-40Z: 観測あり; 展開=効率走者: リソース競合で進行を実行; 影響=同時行動の圧力により、resource constraint が記録された。; event_ids=4345c6e4-0c7f-4c36-b484-8332a437098b
- 2026-05-02T10-00-20Z: 観測あり; 展開=効率走者: リソース競合で進行を実行; 影響=同時行動の圧力により、resource constraint が記録された。; event_ids=0f536a77-30ad-4a82-8bf7-cb17f4a5eccc

### 世界イベント

- 観測 run: 4/7
- 発生 event 数: 4
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-05-02T07-48-20Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T07-55-42Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T08-00-50Z: 観測なし; 展開=なし; 影響=なし; event_ids=なし
- 2026-05-02T08-07-38Z: 観測あり; 展開=MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=d6022bad-0121-48ea-9f1d-9ef29c16af41
- 2026-05-02T09-06-48Z: 観測あり; 展開=MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=ab207c9e-5a20-43c9-9a74-2d34f645ae17
- 2026-05-02T09-39-40Z: 観測あり; 展開=MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=ab5906d4-4cab-4aac-8d09-ea4abdd3595d
- 2026-05-02T10-00-20Z: 観測あり; 展開=MMO レイド攻略者: 世界イベントで現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。を実行; 影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; event_ids=b753b53e-f7ea-442e-878f-ad3874d4b8ea


## UX・ゲームプレイ・ストーリー評価

- warning 件数: 12
- warning run: 4/7

| 評価軸 | 平均 score | 良好 | 許容 | 要改善 | ブロック |
| --- | ---: | ---: | ---: | ---: | ---: |
| UX 評価 | 3.3 | 5 | 6 | 1 | 0 |
| ゲームプレイの面白さ | 3.7 | 6 | 6 | 0 | 0 |
| ストーリー展開評価 | 4.2 | 11 | 1 | 0 | 0 |
| 総合体験 | 3.7 | 6 | 6 | 0 | 0 |

## LLM judge warnings

- 2026-05-02T08-07-38Z: ai-researcher: プレイ情報テキストの一部が英語のまま残っており、日本語環境でのUXを阻害しています。
- 2026-05-02T08-07-38Z: speedrunner: ターン解決に150秒以上の時間がかかっており、プレイヤーの離脱リスクがあります。
- 2026-05-02T08-07-38Z: raid-planner: モバイル環境でのUI表示が崩れており、操作性が著しく低下しています。
- 2026-05-02T08-07-38Z: raid-planner: ux_clarity=2 (needs work)
- 2026-05-02T09-06-48Z: ai-researcher: 一部のプレイ情報テキスト（playInfoTexts）において、英語と日本語が混在しており、UXの統一感が損なわれています。
- 2026-05-02T09-06-48Z: speedrunner: リソース解放（resource release）のフェーズで待ち時間が長く、効率的なプレイを阻害しています。
- 2026-05-02T09-06-48Z: raid-planner: モバイル環境での表示において、一部のテキストが画面からはみ出す可能性があるため、レスポンシブ対応を強化してください。
- 2026-05-02T09-39-40Z: ai-researcher: UIの一部（クエストタイトルや説明）が英語のまま表示されており、日本語環境でのUXを損なっています。
- 2026-05-02T09-39-40Z: speedrunner: 処理待ち時間が長く、効率的なゲームプレイを阻害しています。
- 2026-05-02T09-39-40Z: raid-planner: モバイル環境でのUI表示が最適化されておらず、情報が読み取りにくい箇所があります。
- 2026-05-02T10-00-20Z: ai-researcher: 一部のプレイ情報テキストに英語が混在しています。
- 2026-05-02T10-00-20Z: speedrunner: 一部のクエストタイトルや説明文に英語の識別子が含まれています。
- 2026-05-02T10-00-20Z: raid-planner: 世界イベントの確認結果がやや抽象的で、プレイヤーが次に取るべき行動の指針が不明瞭です。

## ハードチェック横断

| 項目 | 最新完了 run | 通過 run |
| --- | --- | --- |
| ユーザーペルソナとプレイヤープロフィールの分離 | 合格 | 4/7 |
| 実行時データへのユーザーペルソナ漏えいなし | 合格 | 4/7 |
| 全ターンが event_id を返す | 合格 | 4/7 |
| 全ターンイベントが同一 world_id に属する | 合格 | 4/7 |
| canonical sequence が一意 | 合格 | 4/7 |
| 共有世界への影響が観測可能 | 合格 | 4/7 |
| リソース競合が記録される | 合格 | 4/7 |
| 世界イベントまたは制約が観測可能 | 合格 | 4/7 |
| 探索中表示が観測可能 | 合格 | 4/7 |
| 動的クエスト提示が観測可能 | 合格 | 4/7 |
| クエスト受諾 turn が解決 | 合格 | 4/7 |
| クエスト chapter が観測可能 | 合格 | 4/7 |
| クエスト lifecycle event が同一 world に属する | 合格 | 4/7 |

## ペルソナ別横断評価

### ai-researcher

- 最新評価: 良好
- 最新観測: 探索から任意クエストが提示され、受諾後の chapter が見える形で残った。
- 評価分布: 良好=4, 許容=0, 要改善=0, ブロック=3
- 2026-05-02T07-48-20Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.
- 2026-05-02T07-55-42Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.
- 2026-05-02T08-00-50Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at quest_accept_turn.
- 2026-05-02T08-07-38Z: 評価=良好; 観測=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。
- 2026-05-02T09-06-48Z: 評価=良好; 観測=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。
- 2026-05-02T09-39-40Z: 評価=良好; 観測=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。
- 2026-05-02T10-00-20Z: 評価=良好; 観測=探索から任意クエストが提示され、受諾後の chapter が見える形で残った。

### speedrunner

- 最新評価: 良好
- 最新観測: 同時行動の圧力により、resource constraint が記録された。
- 評価分布: 良好=4, 許容=0, 要改善=0, ブロック=3
- 2026-05-02T07-48-20Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.
- 2026-05-02T07-55-42Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.
- 2026-05-02T08-00-50Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at quest_accept_turn.
- 2026-05-02T08-07-38Z: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。
- 2026-05-02T09-06-48Z: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。
- 2026-05-02T09-39-40Z: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。
- 2026-05-02T10-00-20Z: 評価=良好; 観測=同時行動の圧力により、resource constraint が記録された。

### raid-planner

- 最新評価: 良好
- 最新観測: 遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 評価分布: 良好=4, 許容=0, 要改善=0, ブロック=3
- 2026-05-02T07-48-20Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.
- 2026-05-02T07-55-42Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.
- 2026-05-02T08-00-50Z: 評価=ブロック; 観測=swarm-test stopped before hard checks at quest_accept_turn.
- 2026-05-02T08-07-38Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-05-02T09-06-48Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-05-02T09-39-40Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。
- 2026-05-02T10-00-20Z: 評価=良好; 観測=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。

## 現時点の評価

- 少なくとも 4 run では、shared impact / resource conflict / world event / privacy separation の hard check が通過しています。
- 3 run で hard check failure があり、該当項目の再確認が必要です。
- 現時点では体験要件を満たす run はありますが、失敗または未完了 run が残るため安定性評価は保留です。

