# swarm-test レポート 2026-04-30T05-31-40Z

- 作成日時: 2026-04-30T05:40:10.688Z
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

## 失敗診断

- stage: observation_poll
- message: shared-world observation hard checks should become visible

[2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

Expected: [32mtrue[39m
Received: [31mfalse[39m

Call Log:
- Timeout 120000ms exceeded while waiting on the predicate
- stack: Error: shared-world observation hard checks should become visible

## ユーザーペルソナ

- 小説愛好家の編集者: 性別=女性, 年齢=34, 職業=編集者, 趣味=小説, TRPG, 登場人物考察, 性格=共感的, 観察好き, 伏線や余韻を重視, 評価観点=自分の行動が他者の物語の一部になったと感じられるか。
- MMO レイド攻略者: 性別=男性, 年齢=29, 職業=営業職, 趣味=MMO, レイド攻略, ビルド検証, 性格=目標志向, 効率重視, 競争を楽しむ, 評価観点=同じ目標を巡る競合が公平に解決され、プレイが進み続けるか。
- 因果検証エンジニア: 性別=未指定, 年齢=41, 職業=ソフトウェアエンジニア, 趣味=技術検証, シミュレーションゲーム, ログ分析, 性格=分析的, 慎重, 因果関係を重視, 評価観点=broadcast、memory、timeline sequence、constraint の整合性が取れているか。

## 派生プレイヤープロフィール

- novel-editor: Mio NovelEditor; 性別=女性; プレイ言語=en
- raid-planner: Kaito RaidPlanner; 性別=男性; プレイ言語=en
- causality-engineer: Sena CausalityEngineer; 性別=未指定; プレイ言語=en

## ペルソナ別行動ログ


## ペルソナ別体験評価

- novel-editor: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at observation_poll.; 証跡=shared-world observation hard checks should become visible

[2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

Expected: [32mtrue[39m
Received: [31mfalse[39m

Call Log:
- Timeout 120000ms exceeded while waiting on the predicate
- raid-planner: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at observation_poll.; 証跡=shared-world observation hard checks should become visible

[2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

Expected: [32mtrue[39m
Received: [31mfalse[39m

Call Log:
- Timeout 120000ms exceeded while waiting on the predicate
- causality-engineer: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at observation_poll.; 証跡=shared-world observation hard checks should become visible

[2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m

Expected: [32mtrue[39m
Received: [31mfalse[39m

Call Log:
- Timeout 120000ms exceeded while waiting on the predicate

## 実行時 ID

- novel-editor: actor_id=12870496-dfd4-4b81-898c-e3efa4cb123a; session_id=166cca32-dec6-4288-a19d-bed7e472be1a; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=
- raid-planner: actor_id=bebb0949-dc4d-42b8-ba8d-36945304e90b; session_id=5ef634c0-e8a9-4e0c-a4c6-7172d02f35e9; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=
- causality-engineer: actor_id=cb0496ce-f44a-402f-bb3d-5a8406de0824; session_id=8f34aa2b-cf3f-4569-b47f-783718af3f27; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=

