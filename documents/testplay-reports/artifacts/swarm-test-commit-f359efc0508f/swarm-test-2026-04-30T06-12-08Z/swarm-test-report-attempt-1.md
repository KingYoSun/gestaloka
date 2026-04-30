# swarm-test レポート 2026-04-30T06-12-08Z

- 作成日時: 2026-04-30T06:19:54.636Z
- world_id: gestaloka_reference
- 試行: attempt-1

## ハードチェック

- ユーザーペルソナとプレイヤープロフィールの分離: 合格
- 実行時データへのユーザーペルソナ漏えいなし: 合格
- 全ターンが event_id を返す: 合格
- 全ターンイベントが同一 world_id に属する: 合格
- canonical sequence が一意: 合格
- 共有世界への影響が観測可能: 合格
- リソース競合が記録される: 合格
- 世界イベントまたは制約が観測可能: 合格

## ユーザーペルソナ

- AI 研究者: 性別=女性, 年齢=45, 職業=AI researcher, 趣味=agent systems, procedural narrative, paper reading, 性格=probing, theory-minded, skeptical, 評価観点=Does generation respect canonical state?
- 効率走者: 性別=未指定, 年齢=22, 職業=part-time worker, 趣味=speedrunning, route notes, timer comparisons, 性格=impatient, experimental, optimization-heavy, 評価観点=Does dynamic narrative preserve actionable progress?
- MMO レイド攻略者: 性別=男性, 年齢=29, 職業=営業職, 趣味=MMO, レイド攻略, ビルド検証, 性格=目標志向, 効率重視, 競争を楽しむ, 評価観点=同じ目標を巡る競合が公平に解決され、プレイが進み続けるか。

## 派生プレイヤープロフィール

- ai-researcher: Sena Engineer; 性別=女性; プレイ言語=en
- speedrunner: Kaito Optimizer; 性別=未指定; プレイ言語=en
- raid-planner: Kaito Mmo; 性別=男性; プレイ言語=en

## ペルソナ別行動ログ

- ai-researcher: シナリオ=共有影響; 入力=選択肢; 行動=進行; 理由=AI 研究者 values actions that can become shared memory through this lens: Does generation respect canonical state?; 期待する世界影響=局所的な支援行動が、後続の噂・関係性・world beat として現れることを期待する。
- ai-researcher: シナリオ=リソース競合; 入力=選択肢; 行動=進行; 理由=AI 研究者 pressure-tests progress paths and shared-resource contention through this play style: Tests whether generated explanations match stored state.; 期待する世界影響=同時進行時の競合が公平に解決され、プレイを止めずに resource constraint が記録されることを期待する。
- speedrunner: シナリオ=リソース競合; 入力=選択肢; 行動=進行; 理由=効率走者 pressure-tests progress paths and shared-resource contention through this play style: Repeats progress actions and checks where time or resources are lost.; 期待する世界影響=同時進行時の競合が公平に解決され、プレイを止めずに resource constraint が記録されることを期待する。
- raid-planner: シナリオ=世界イベント; 入力=自由入力; 行動=現在の門の報告と旅人たちの発言を照合し、どの直近行動が地域状況を変えたのかを尋ねる。; 理由=MMO レイド攻略者 joins late and probes whether public world events have a traceable cause.; 期待する世界影響=応答から broadcast、memory、recent history を通じた共有世界の連続性が観測できることを期待する。

## ペルソナ別体験評価

- ai-researcher: 評価=良好; 観測された影響=支援行動が shared-world context に現れている。; 証跡=0dd0250d-77d5-4fb2-a1a8-a051856ea5ad | 143fcfb6-e836-48f5-aa9d-c8592a13a92b | session state / ops history / memory scan
- speedrunner: 評価=良好; 観測された影響=同時行動の圧力により、resource constraint が記録された。; 証跡=a1039fcc-5521-440b-8323-30ce7accebd7 | event payload resource_constraints scan
- raid-planner: 評価=良好; 観測された影響=遅れて参加した後の追跡行動で、世界イベントまたは broadcast constraint を観測できた。; 証跡=cf3045d8-e341-4868-82e5-a7471874d651 | session state broadcast constraint scan

## 実行時 ID

- ai-researcher: actor_id=e91ddc81-c1bf-4d2a-8c13-ebc5d1832fe4; session_id=2d08e63e-bfde-4042-a4c1-07973fbe4b41; location_id=gestaloka_reference:nexus_gate; event_ids=0dd0250d-77d5-4fb2-a1a8-a051856ea5ad, 143fcfb6-e836-48f5-aa9d-c8592a13a92b; turn_ids=56ce1e74-e3de-413f-a1b6-a9b13eeba52a, 9ba77639-392a-4ea2-b640-07eae415bf43
- speedrunner: actor_id=d76fad35-f2cb-460b-a6ab-dc92f7d6891f; session_id=b1c4bd09-24c4-4715-a994-d054a6c1f42c; location_id=gestaloka_reference:nexus_gate; event_ids=a1039fcc-5521-440b-8323-30ce7accebd7; turn_ids=bbde7335-fbf2-4ff8-ad95-d4185f769c2c
- raid-planner: actor_id=7df7d946-ab39-46f3-9ac9-6ac06b43efd4; session_id=75eb2be4-abea-4ce1-a8a8-e35e914873cf; location_id=gestaloka_reference:nexus_gate; event_ids=cf3045d8-e341-4868-82e5-a7471874d651; turn_ids=7710ba33-4d1c-42b8-9e26-203063b281b1

