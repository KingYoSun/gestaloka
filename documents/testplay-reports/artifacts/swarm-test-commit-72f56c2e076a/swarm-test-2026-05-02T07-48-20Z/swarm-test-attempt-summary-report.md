# swarm-test attempt summary 2026-05-02T07-48-20Z

- 生成日時: 2026-05-02T07:50:22.022Z
- world_id: gestaloka_reference
- attempt 数: 1
- 最新 attempt: attempt-1
- 最新結果: 失敗

## Attempt 一覧

| attempt | 作成日時 | 結果 | persona 評価 | judge warnings | report |
| --- | --- | --- | --- | ---: | --- |
| attempt-1 | 2026-05-02T07:50:22.019Z | 失敗 | ai-researcher=ブロック<br>speedrunner=ブロック<br>raid-planner=ブロック | 0 | swarm-test-report-attempt-1.md |

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
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.; 証跡=UI session did not render a ready play surface for speedrunner: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

Locator: getByTestId('choice-progress')
Expected: visible
Timeout: 60000ms
Error: element(s) not found

Call log:
[2m  - Expect "toBeVisible" with timeout 60000ms[22m
[2m  - waiting for getByTestId('choice-progress')[22m
; story=進行中; active-quest=クエスト探索中...探索中...; turn-progress-status=選択待ち; actions-button enabled=not-found; status-button enabled=not-found; toggle-free-text enabled=true; choices=進行中; error-banner=(empty)

### speedrunner

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at ui_session_setup.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.; 証跡=UI session did not render a ready play surface for speedrunner: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

Locator: getByTestId('choice-progress')
Expected: visible
Timeout: 60000ms
Error: element(s) not found

Call log:
[2m  - Expect "toBeVisible" with timeout 60000ms[22m
[2m  - waiting for getByTestId('choice-progress')[22m
; story=進行中; active-quest=クエスト探索中...探索中...; turn-progress-status=選択待ち; actions-button enabled=not-found; status-button enabled=not-found; toggle-free-text enabled=true; choices=進行中; error-banner=(empty)

### raid-planner

- 最新評価: ブロック
- 最新観測: swarm-test stopped before hard checks at ui_session_setup.
- attempt-1: 評価=ブロック; 観測=swarm-test stopped before hard checks at ui_session_setup.; 証跡=UI session did not render a ready play surface for speedrunner: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed

Locator: getByTestId('choice-progress')
Expected: visible
Timeout: 60000ms
Error: element(s) not found

Call log:
[2m  - Expect "toBeVisible" with timeout 60000ms[22m
[2m  - waiting for getByTestId('choice-progress')[22m
; story=進行中; active-quest=クエスト探索中...探索中...; turn-progress-status=選択待ち; actions-button enabled=not-found; status-button enabled=not-found; toggle-free-text enabled=true; choices=進行中; error-banner=(empty)

## 個別レポート

- attempt-1: swarm-test-report-attempt-1.md, swarm-test-result-attempt-1.json

