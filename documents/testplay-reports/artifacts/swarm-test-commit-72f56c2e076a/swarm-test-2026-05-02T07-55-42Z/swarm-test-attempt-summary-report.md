# swarm-test attempt summary 2026-05-02T07-55-42Z

- 生成日時: 2026-05-02T07:58:54.285Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 失敗

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | judge warnings | report |
| --- | --- | --- | --- | ---: | --- |
| attempt-1 | 2026-05-02T07:58:54.280Z | 失敗 | ai-researcher=ブロック<br>speedrunner=ブロック<br>raid-planner=ブロック | 0 | swarm-test-report-attempt-1.md |

## ハードチェック総合

| 項目 | 最新 | 通過 attempt |
| --- | --- | --- |
| ユーザーペルソナとプレイヤープロフィールの分離 | 失敗 | 0/1 |
| 実行時データへのユーザーペルソナ漏えいなし | 失敗 | 0/1 |
| 全ターンが event_id を返す | 失敗 | 0/1 |
| 全ターンイベントが同一 world_id に属する | 失敗 | 0/1 |
| canonical sequence が一意 | 失敗 | 0/1 |
| 共有世界への影響が観測可能 | 失敗 | 0/1 |
| リソース競合が記録される | 失敗 | 0/1 |
| 世界イベントまたは制約が観測可能 | 失敗 | 0/1 |
| 探索中表示が観測可能 | 失敗 | 0/1 |
| 動的クエスト提示が観測可能 | 失敗 | 0/1 |
| クエスト受諾 turn が解決 | 失敗 | 0/1 |
| クエスト chapter が観測可能 | 失敗 | 0/1 |
| クエスト lifecycle event が同一 world に属する | 失敗 | 0/1 |

## ペルソナ別総合評価

### ai-researcher

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at ui_session_setup.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.; 証跡=[2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

Locator: getByTestId('active-quest')
Expected substring: [32m"探索中..."[39m
Received string:    [31m"クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[39m
Timeout: 60000ms

Call log:
[2m  - Expect "toContainText" with timeout 60000ms[22m
[2m  - waiting for getByTestId('active-quest')[22m
[2m    63 × locator resolved to <div data-testid="active-quest" class="rounded-lg border border-border bg-card text-card-foreground shadow-sm grid min-w-0 gap-3 p-4">…</div>[22m
[2m       - unexpected value "クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[22m


### speedrunner

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at ui_session_setup.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.; 証跡=[2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

Locator: getByTestId('active-quest')
Expected substring: [32m"探索中..."[39m
Received string:    [31m"クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[39m
Timeout: 60000ms

Call log:
[2m  - Expect "toContainText" with timeout 60000ms[22m
[2m  - waiting for getByTestId('active-quest')[22m
[2m    63 × locator resolved to <div data-testid="active-quest" class="rounded-lg border border-border bg-card text-card-foreground shadow-sm grid min-w-0 gap-3 p-4">…</div>[22m
[2m       - unexpected value "クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[22m


### raid-planner

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at ui_session_setup.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.; 証跡=[2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed

Locator: getByTestId('active-quest')
Expected substring: [32m"探索中..."[39m
Received string:    [31m"クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[39m
Timeout: 60000ms

Call log:
[2m  - Expect "toContainText" with timeout 60000ms[22m
[2m  - waiting for getByTestId('active-quest')[22m
[2m    63 × locator resolved to <div data-testid="active-quest" class="rounded-lg border border-border bg-card text-card-foreground shadow-sm grid min-w-0 gap-3 p-4">…</div>[22m
[2m       - unexpected value "クエストゲート登録の監査ゲート登録の監査1/3ゲート登録の監査: 1/3 (active) [aid_local]ゲート登録の監査 begins. Gate Steward Rikkaは、最近の登録の不整合を修正するために、外部からの監査人を求めている。Nexus Gateの記録の完全性を証明し、Civic Trustを向上させる。The opening chapter of GESTALOKA: Nexus Foundation now turns on whether ゲート登録の監査 will be carried through.離れるdynamic_quest_c216d648afbb4c4598f6dynamic"[22m


## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

