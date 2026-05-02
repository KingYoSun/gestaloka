# swarm-test レポート 2026-05-02T07-55-42Z

- 作成日時: 2026-05-02T07:58:54.280Z
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

- stage: ui_session_setup
- message: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

Locator: getByTestId('active-quest')
Expected substring: [32m"探索中..."[39m
Received string:    [31m"クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[39m
Timeout: 60000ms

Call log:
[2m  - Expect "toContainText" with timeout 60000ms[22m
[2m  - waiting for getByTestId('active-quest')[22m
[2m    63 × locator resolved to <div data-testid="active-quest" class="rounded-lg border border-border bg-card text-card-foreground shadow-sm grid min-w-0 gap-3 p-4">…</div>[22m
[2m       - unexpected value "クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[22m

- stack: Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

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

- ai-researcher: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at ui_session_setup.; 証跡=[2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

Locator: getByTestId('active-quest')
Expected substring: [32m"探索中..."[39m
Received string:    [31m"クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[39m
Timeout: 60000ms

Call log:
[2m  - Expect "toContainText" with timeout 60000ms[22m
[2m  - waiting for getByTestId('active-quest')[22m
[2m    63 × locator resolved to <div data-testid="active-quest" class="rounded-lg border border-border bg-card text-card-foreground shadow-sm grid min-w-0 gap-3 p-4">…</div>[22m
[2m       - unexpected value "クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[22m

- speedrunner: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at ui_session_setup.; 証跡=[2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

Locator: getByTestId('active-quest')
Expected substring: [32m"探索中..."[39m
Received string:    [31m"クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[39m
Timeout: 60000ms

Call log:
[2m  - Expect "toContainText" with timeout 60000ms[22m
[2m  - waiting for getByTestId('active-quest')[22m
[2m    63 × locator resolved to <div data-testid="active-quest" class="rounded-lg border border-border bg-card text-card-foreground shadow-sm grid min-w-0 gap-3 p-4">…</div>[22m
[2m       - unexpected value "クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[22m

- raid-planner: 評価=ブロック; 観測された影響=swarm-test stopped before hard checks at ui_session_setup.; 証跡=[2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

Locator: getByTestId('active-quest')
Expected substring: [32m"探索中..."[39m
Received string:    [31m"クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[39m
Timeout: 60000ms

Call log:
[2m  - Expect "toContainText" with timeout 60000ms[22m
[2m  - waiting for getByTestId('active-quest')[22m
[2m    63 × locator resolved to <div data-testid="active-quest" class="rounded-lg border border-border bg-card text-card-foreground shadow-sm grid min-w-0 gap-3 p-4">…</div>[22m
[2m       - unexpected value "クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[22m


## UX・ゲームプレイ・ストーリー評価

## 実行時 ID

- ai-researcher: actor_id=89dacfaa-b810-4463-99a5-0846550c474d; session_id=e3c36828-8870-418d-b290-0591891ee25a; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=
- speedrunner: actor_id=2e061224-1dce-4ef5-8913-691119ea047d; session_id=263b7fdf-9d32-42b7-b62a-7a534b576189; location_id=gestaloka_reference:nexus_gate; event_ids=; turn_ids=
- raid-planner: actor_id=e428ea47-95bb-4aec-9b34-e8d7195595cd; session_id=; location_id=; event_ids=; turn_ids=

