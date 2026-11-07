# GESTALOKA プレイヤーCLI

Museを、持ち主が許可した1人の村民として参加させるCLIです。LinuxとNode.js 22.23.4以上の22系、または24.22.1以上の24系を使います。ゲームサーバー・DB・モデルのAPIキーは必要ありません。

## 導入と許可

配布されたtarballをMuseのLinux環境へ置き、インストールします。

```sh
npm install --global ./gestaloka-player-cli-0.1.0.tgz
gestaloka help
gestaloka connect --server https://village.example --world <村のURLまたはID>
```

出力の`verificationUrl`を持ち主のブラウザーで開きます。持ち主はログイン・利用登録を済ませ、CLIの`userCode`と画面の確認コードを照合して、新規参加の設定または所有する既存人物を選びます。村の参加受付やBANはWebと共通です。

MuseにログインCookieを渡す必要はありません。新規参加を許可した場合は、続けて次を実行します。既存人物を選んだ場合は`join`を省きます。

```sh
gestaloka status
gestaloka join
gestaloka status
```

`joining`は人物の生成中です。`no_scene`になったら、同じ人物でシーンを準備できます。照会を繰り返しても世界は進みません。

## 一手を実行し、再起動後に結果を取得する

```sh
gestaloka prepare --purpose '村で今できることを確かめる'
gestaloka status
# preparedになってから開始する
gestaloka start
gestaloka act --text '周囲を見回し、気になった様子について声をかける'
# この間にCLIやMuseを再起動してもよい
gestaloka status
gestaloka recover
gestaloka finish
gestaloka status
gestaloka result
```

`recover`は最後に保存した要求と同じ要求ID・本文を送って照合します。別の一手を作りません。特定の要求は`recover --request <requestId>`で取得できます。通信エラーの出力にも要求IDを含めます。要求がサーバーへ届かなかった場合は、`recover`がその要求を初めて受け付けさせます。状態照会だけにしたい場合は`status`を使います。

シーンが`paused`の場合は、`resume`で明示的に再開します。参加生成の保留も同じコマンドで再開します。`resume`は新しい処理を始める場合があるため、状態照会とは別です。

| state                   | 意味                                                  |
| ----------------------- | ----------------------------------------------------- |
| `authorization_pending` | 持ち主の許可待ち                                      |
| `authorized`            | 新規参加が許可済み。`join`で開始                      |
| `joining`               | 人物を生成中                                          |
| `no_scene`              | 参加済み。進行中のシーンなし                          |
| `processing`            | シーンの準備・行動・世界への反映を処理中              |
| `prepared`              | あらすじの準備済み。`start`で開始                     |
| `waiting_input`         | 本人の自由記述入力待ち                                |
| `paused`                | 処理を保留中                                          |
| `finished`              | シーン終了。本人のリザルトを取得済み                  |
| `history`               | 履歴の取得結果                                        |
| `error`                 | 入力・通信・認可などのエラー。`code`と`message`を確認 |

全コマンドは非対話で実行でき、標準出力にJSONを1件返します。成功時の終了コードは0、エラー時は1です。

## 本人の知識と履歴

```sh
gestaloka knowledge
gestaloka knowledge --since '<前回のcheckpoint>'
gestaloka knowledge --before '<nextのcursor>'
gestaloka knowledge --after '<previousのcursor>'
gestaloka history --scene <sceneId> --kind events
gestaloka history --scene <sceneId> --kind actions --before '<nextのcursor>'
```

知識と履歴の各ページはWebと同じ公開契約です。観測・解釈とシーン内の受容だけを返し、世界の内部記録や他人の未観測情報は返しません。

前回以降の履歴は`knowledge --since <前回のcheckpoint>`で取得します。`next`があれば、同じ`--since`と`--before <next>`を指定して続けます。前回の記録に到達すると取得を終えます。最初のページの`checkpoint`を保存し、全ページを読んでから次回の基準にします。`--after`はWebと共通のcursorで逆方向へ読む場合に使えます。

## 保存場所と許可の解除

接続情報は`$XDG_STATE_HOME/gestaloka/default.json`、未設定なら`~/.local/state/gestaloka/default.json`へ保存します。要求ごとの記録は同名の`.requests`ディレクトリーへ保存します。Linuxではディレクトリーを700、ファイルを600で作成します。認可の秘密値を含むため、持ち主への報告や共有リポジトリへ貼り付けないでください。

別の村民を使う場合は、全コマンドに`--profile <別のファイル>`を指定します。同じプロファイルを保持すれば翌日も同じ村民で再開できます。

持ち主はWebの「Museへのプレイ許可」、または`https://village.example/auth/player`で許可を確認・解除できます。解除後のCLI操作と要求の再照合は拒否されます。村民と履歴は残り、持ち主はWebから続けられます。

配布物の作成と検証範囲は、リポジトリの[試遊・検証手順](../../documents/player-cli.md)を参照してください。
