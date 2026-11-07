# プレイヤーCLIの配布と試遊

使い方は[同梱README](../packages/player-cli/README.md)、設計と受入条件は[ADR-032](adr/ADR-032-player-cli.md)を参照してください。

## 配布物を作る

```sh
pnpm install --frozen-lockfile
pnpm build:server
pnpm build:player-cli
pnpm --filter @gestaloka/player-cli pack --pack-destination artifacts/player-cli
```

`artifacts/player-cli/gestaloka-player-cli-0.2.0.tgz`をMuseへ渡します。公開npmレジストリへの登録は不要です。tarballには公開契約を含む実行ファイル・ヘルプ・READMEを収録し、実行時のnpm依存はありません。

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

- [PR #127のCI](https://github.com/KingYoSun/gestaloka/actions/runs/42409354206): 全ジョブ成功。`pnpm check`、単体71件、統合222件、認証6件、ブラウザー17件、公開配置と復旧の検証が通過した。CLIは呼出しごとに新しいプロセスで実行し、参加・行動・終了の応答喪失、2ユーザーの分離、許可解除後の拒否を確認した。
- 認可画面: Chromiumで新規参加の許可と解除を確認した。同意画面と許可一覧のスクリーンショットは`artifacts/screenshots/player-device-*.png`へ保存した。
- Linux配布物の導入: DebianベースのNode.js 24.22.1コンテナーで、ネットワークを無効にしてtarballをnpmでインストールし、ヘルプのJSON出力とエラー時の終了コード1を確認した。Linuxでの通常プレイ全体の実測とは区別する。
- 公開先: `local2`の`/home/kingyosun/gestaloka-local2`へ配置した。現地のポート・TLS設定を保ち、API・ワーカー・Webを更新した。`https://play.gestaloka.com`と`https://api.gestaloka.com`の両方で、health、新しい認可APIの保護、ログイン導線を確認した。
- 公開環境での試遊: ユーザー指定の[ぶー村](https://play.gestaloka.com/worlds/d9c806c3-e8ab-40f3-985a-8cfaae1166c9)を世界全体の上限100ドルで生成した。`local2`ではNode.js 24.22.1でtarballを展開し、ブラウザーで確認コードと人物設定を選んで許可した後、Linux CLIから参加・シーン準備・開始・自由記述の一手・終了・リザルト取得まで実モデルで実行した。同じ人物・シーン・要求IDに別プロセスから復帰し、行動が1件のままであることと、既読と重複しない履歴7件の取得を確認した。計算額は合計0.2427216ドル、未精算額は0ドルだった。これはプロバイダーの請求額そのものではない。
- 確認範囲: 公開環境の試遊は、1人の持ち主と1人の村民によるLinux CLIの実行である。2ユーザーと通信応答喪失は通常のCLI統合テストで確認した。Muse本体からの実行は未確認であり、Linux CLIの試遊をMuse実機の確認として扱わない。2026年11月8日のユーザー合意により、#124・#125ではMuse本体の確認をスキップし、[後続の#130](https://github.com/KingYoSun/gestaloka/issues/130)で実施する。
