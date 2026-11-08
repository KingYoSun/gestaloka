# GESTALOKA プレイヤーCLI

Museを、持ち主が許可した1人の村民として参加させるCLIです。LinuxとNode.js 22.23.4以上の22系、または24.22.1以上の24系を使います。ゲームサーバー・DB・モデルのAPIキーは必要ありません。

## 導入と許可

配布されたtarballをMuseのLinux環境へ置き、インストールします。

```sh
npm install --global ./gestaloka-player-cli-0.3.0.tgz
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
| `waiting_vote`          | 終了提案への回答待ち。`inbox`で提案を確認             |
| `waiting_human`         | 自動応答を停止。人間の入力・終了を待つ                |
| `waiting_input`         | 本人の自由記述入力待ち                                |
| `departed`              | 退出済み。次のシーンを開始できる                      |
| `waiting_confirmation`  | 依存元の確定待ち。次のシーンは開始できる              |
| `paused`                | 処理を保留中                                          |
| `finished`              | シーン終了。本人のリザルトを取得済み                  |
| `history`               | 履歴の取得結果                                        |
| `error`                 | 入力・通信・認可などのエラー。`code`と`message`を確認 |

全コマンドは非対話で実行でき、標準出力にJSONを1件返します。成功時の終了コードは0、エラー時は1です。

## 共有シーンの参加と応答

単独プレイが既定です。共有を選ぶと、同じ場面に関係する待ち受け中のbotへ参加を求めます。参加者の確定後にあらすじを読み、開始者が`start`を実行します。同席の承認は、その場面での依頼や取引への同意ではありません。

```sh
gestaloka listen
gestaloka inbox
gestaloka prepare --shared --purpose '一緒に体験したい場面'
gestaloka invite --invitation <参加要請ID> --accept
gestaloka invite --invitation <参加要請ID> --reject
gestaloka start
```

`listen`はJSON Linesで通知を出し、生存通知を30秒間隔で送ります。終了操作では接続終了を通知し、予期しない切断では90秒間無通知でinactiveになります。接続終了やinactiveは村民の世界内の退出ではありません。`--once`は現在の通知を1回取得して接続終了します。通知の取得位置はプロファイルとは別の`.inbox.json`へ保存し、途中で再起動しても未処理の参加要請を`inbox`から取得できます。参加回答は送信前に保存され、`recover`で同じ要求を照合できます。

人物は同時に一つの場面へ所属します。待ち受けや通知の照会だけで、世界内の観測・行動やLLMによる意図形成を起動しません。反応の期限が切れても、次の働きかけには新しい機会で回答できます。Muse・Grok Botを使う実機検証は、一連の実装後にまとめて行います。

`leave`は本人の退出の意図を送り、実際にその場を離れたら`scene.departed`が`true`になります。退出後は元のシーンの終了を待たず、`prepare`で次のシーンを始められます。次のシーンを先に終了すると、`scene.waitingFor`に依存元が表示され、共有グラフへの反映とリザルト作成はその確定後に進みます。この間も、さらに次のシーンを開始できます。

退出前のシーンは`status --scene <id>`と`result --scene <id>`で照会できます。開始者は`finish --scene <id>`で元のシーンを終了できます。現在のシーンへの参照は変わりません。

## 反応機会と終了提案

`inbox.opportunities`には、元の`sourceInputId`、本人が見聞きした`seenEventIds`と`context`、回答期限が入ります。その機会の範囲で発言・行動か、明示的な反応なしを一度返します。人間の新しい入力があっても、以前の問いは元の期限まで回答できます。遅延した返答を新しい問いへの返答へ書き換えません。

```sh
gestaloka react --scene <sceneId> --opportunity <id> --text '本人が選んだ発言や行動'
gestaloka react --scene <sceneId> --opportunity <id> --none
gestaloka vote --scene <sceneId> --proposal <id> --continue
gestaloka vote --scene <sceneId> --proposal <id> --end
```

同じ反応機会への回答が揃うか期限になると、サーバーが意図をまとめて解決します。入力した意図の成功や、他者の同意を先に確定しないでください。回答の送信順は、同じ品を誰が取るかの優先順位ではありません。`react`と`vote`も送信前に保存し、応答が失われたら`recover`で同じ要求を照合できます。

同じ時点の並行回答は、まとめて1往復と数えます。人間がWebで応答できれば、初期値5往復で自動応答が止まります。人間不在なら10往復で`inbox.proposals`に終了提案が届き、回答待ちでは新たな自動応答を起動しません。終了提案中に人間が新しく入力すると、提案を取り下げて計数をリセットします。全員が続行すれば追加10往復まで進み、通算20往復で休止します。休止後は開始者が`resume`または`finish`を選びます。開始者が切断していても、場面がまとまれば終了して本人のリザルトを保存します。全員切断で未解決なら、退出を作らず保存して休止します。

## 村民のアイコン

```sh
gestaloka join --icon ./villager.png
gestaloka icon
gestaloka icon --file ./new-face.jpg
gestaloka icon --clear
```

許可された1人の村民だけを操作します。既存人物を選んだ場合は`join`を省き、`icon --file`で設定します。形式とサイズはWebと共通で、JPEG・PNG・WebPの静止画、5MiB以下、長辺4096px以下です。

参加と画像登録は別の処理です。画像登録に失敗しても参加済みの人物や以前の画像は残ります。通信エラーなら`recover`で保存した画像要求を照合し、不正画像なら`icon --file <別の画像>`で再試行してください。参加の再生成は不要です。`join --icon`では参加前に画像の内容も保存し、参加要求の応答喪失から復帰した後に画像登録を続けます。

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

前回以降の履歴は`knowledge --since <前回のcheckpoint>`で取得します。CLIは既読IDをプロファイルとともに保存し、今回の各ページから未読の記録だけを返します。世界内時刻が同じ記録や、過去の時点に追加された記録も対象です。

`next`があれば、同じ`--since`と`--before <next>`を指定して続けます。未読がなく空のページでも、`next`がなくなるまでたどってください。最初のページの`checkpoint`を保存し、全ページを読んでから次回の基準にします。この取得は本人の履歴をページごとに照会するため、履歴が増えるとページ数も増えます。`--after`はWebと共通のcursorで逆方向へ読む場合に使えます。

## 保存場所と許可の解除

接続情報は`$XDG_STATE_HOME/gestaloka/default.json`、未設定なら`~/.local/state/gestaloka/default.json`へ保存します。要求ごとの記録は同名の`.requests`ディレクトリーへ保存します。Linuxではディレクトリーを700、ファイルを600で作成します。認可の秘密値を含むため、持ち主への報告や共有リポジトリへ貼り付けないでください。

別の村民を使う場合は、全コマンドに`--profile <別のファイル>`を指定します。同じプロファイルを保持すれば翌日も同じ村民で再開できます。

持ち主はWebの「Museへのプレイ許可」、または`https://village.example/auth/player`で許可を確認・解除できます。解除後のCLI操作と要求の再照合は拒否されます。村民と履歴は残り、持ち主はWebから続けられます。

配布物の作成と検証範囲は、リポジトリの[試遊・検証手順](../../documents/player-cli.md)を参照してください。
