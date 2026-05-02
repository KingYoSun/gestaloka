# swarm-test レポート 2026-05-02T08-00-50Z

- 作成日時: 2026-05-02T08:05:47.090Z
- world_id: gestaloka_reference
- 試行: attempt-1

## ハードチェック

- ユーザーペルソナとプレイヤープロフィールの分離: 失敗
- 実行時データへのユーザーペルソナ漏えいなし: 失敗
- 全ターンが event_id を返す: 失敗
- 全ターンイベントが同一 world_id に属する: 失敗
- canonical sequence が一意: 失敗
- 共有世界への影響が観測可能: 失敗
- リソース競合が記録される: 失敗
- 世界イベントまたは制約が観測可能: 失敗
- 探索中表示が観測可能: 失敗
- 動的クエスト提示が観測可能: 失敗
- クエスト受諾 turn が解決: 失敗
- クエスト chapter が観測可能: 失敗
- クエスト lifecycle event が同一 world に属する: 失敗

## 失敗診断

- stage: quest_accept_turn
- message: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

Expected: [32mtrue[39m
Received: [31mfalse[39m

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
- stack: Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

## ユーザーペルソナ

- AI 研究者: 性別=女性, 年齢=45, 職業=AI researcher, 趣味=agent systems, procedural narrative, paper reading, 性格=probing, theory-minded, skeptical, 評価観点=Does generation respect canonical state?
- 効率走者: 性別=未指定, 年齢=22, 職業=part-time worker, 趣味=speedrunning, route notes, timer comparisons, 性格=impatient, experimental, optimization-heavy, 評価観点=Does dynamic narrative preserve actionable progress?
- MMO レイド攻略者: 性別=男性, 年齢=29, 職業=営業職, 趣味=MMO, レイド攻略, ビルド検証, 性格=目標志向, 効率重視, 競争を楽しむ, 評価観点=同じ目標を巡る競合が公平に解決され、プレイが進み続けるか。

## 派生プレイヤープロフィール

- ai-researcher: Sena JP Engineer; 性別=女性; プレイ言語=ja
- speedrunner: Kaito JP Optimizer; 性別=未指定; プレイ言語=ja
- raid-planner: Kaito JP Mmo; 性別=男性; プレイ言語=ja

## ペルソナ別行動ログ


## ペルソナ別体験評価

- ai-researcher: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at quest_accept_turn.; 証跡=[2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

Expected: [32mtrue[39m
Received: [31mfalse[39m

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
- speedrunner: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at quest_accept_turn.; 証跡=[2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

Expected: [32mtrue[39m
Received: [31mfalse[39m

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate
- raid-planner: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at quest_accept_turn.; 証跡=[2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

Expected: [32mtrue[39m
Received: [31mfalse[39m

Call Log:
- Timeout 60000ms exceeded while waiting on the predicate

## UX・ゲームプレイ・ストーリー評価

## 実行時 ID

- ai-researcher: actor_id=d3bc7b1e-3d85-4017-bdda-b48fa2b134bd; session_id=906d7aa8-4241-4380-b75b-f4e28dd004b3; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=
- speedrunner: actor_id=242f2de5-852d-4d1e-8c98-fc9cddb39639; session_id=93eec89a-0551-4b21-9c07-7ae33dbfe419; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=
- raid-planner: actor_id=c04223d3-5708-4851-a779-76a52ad41eda; session_id=; location_id=; event_ids=; turn_ids=

