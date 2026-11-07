# プレイヤーCLIの配布と試遊

使い方は[同梱README](../packages/player-cli/README.md)、設計と受入条件は[ADR-032](adr/ADR-032-player-cli.md)を参照してください。

## 配布物を作る

```sh
pnpm install --frozen-lockfile
pnpm build:server
pnpm build:player-cli
pnpm --filter @gestaloka/player-cli pack --pack-destination artifacts/player-cli
```

`artifacts/player-cli/gestaloka-player-cli-0.1.0.tgz`をMuseへ渡します。公開npmレジストリへの登録は不要です。tarballには公開契約を含む実行ファイル・ヘルプ・READMEを収録し、実行時のnpm依存はありません。

## Museで試遊する

1. 同梱READMEの導入手順でtarballをインストールし、持ち主が指定した公開URLと村のURLまたはIDで`connect`を実行する。
2. 持ち主が認可URLを手元のブラウザーで開き、確認コードを照合して新規参加を許可する。別ユーザーのMuseでも同じ村への接続・許可を行う。
3. 両方のMuseで`join`と`status`を実行し、異なる`device.actorId`が返ることを確認する。表示された人物IDを以後の報告に使う。
4. AのMuseで`prepare`・`start`・`act`・`finish`を実行する。処理中は`status`で照会し、`finished`になった後にリザルトを読む。
5. BのMuseで後続のシーンを準備する。提示された観測・あらすじから、状況や人物・関係の解釈、今後の予想、選択の意味がどう変わったかを原文とともに記録する。B自身の見聞から一手を入力し、終了後にAでも続きを読む。特定の返答・結末を期待値にしない。
6. 一手の送信後にCLIまたはMuseを再起動する。保存したプロファイルを使って`status`と`recover --request <保存した要求ID>`を実行し、同じ人物・シーン・要求結果へ戻ることを確認する。`act`を新規に打ち直さない。
7. 持ち主がWebから許可を解除し、そのMuseの`status`・`recover`が拒否されることを確認する。

## 開発時の検証

```sh
pnpm check
pnpm db:up
pnpm test:integration
```

`tests/integration/participants.test.ts`は、実DBとHTTPを使い、呼出しごとに別のCLIプロセスを起動します。モデル応答は試験用で、外部LLMへ送信しません。通信の応答を捨てた後の再照合、2ユーザーの人物と履歴の分離、双方の確定後の参照、認可解除を確認します。固定した文字列はデータの到達を追跡する印であり、物語品質の評価ではありません。

## 確認記録

2026年11月8日時点。

- `pnpm check`: 成功。生成物、型、lint、整形、単体テスト65件、CLI・Web・管理画面のビルドを確認した。
- CLI・認可・既存プレイの統合テスト: `participants`・`operations`・`world-api`・`scene`・`mcp`の5ファイル46件が成功。Windows上のNode.js 22.23.4、専用のPostgreSQLスキーマとNeo4jを使用した。CLIは呼出しごとに新しいプロセスで実行した。
- 認可画面: Chromiumで新規参加の許可と解除のE2Eテスト1件が成功。同意画面と許可一覧のスクリーンショットを`artifacts/screenshots/player-device-*.png`へ保存した。
- Linux配布物の導入: DebianベースのNode.js 24.22.1コンテナーで、ネットワークを無効にしてtarballをnpmでインストールし、ヘルプのJSON出力とエラー時の終了コード1を確認した。Linuxでの通常プレイ全体の実測とは区別する。
- 公開先: ユーザー指定の`https://play.gestaloka.com`と`https://api.gestaloka.com`を確認した。公開APIのhealthは正常だが、新しい`GET /api/player-device`は両URLとも404。今回のコードの配置は未実施で、配置先の接続情報を確認中。
- Muse実機: 未接続。公開環境の更新と持ち主の認可を経た試遊は未確認。通常のCLI統合テストやLinuxコンテナーの導入確認を、Muse実機の確認として扱わない。
