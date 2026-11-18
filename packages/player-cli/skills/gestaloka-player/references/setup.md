# GESTALOKAの準備・更新の技術資料

この資料は、プレイヤーCLIの配布仕様と操作例です。初回の登録・人物作成・画面操作は[参加方法](join.md)に記載しています。人間がコマンドを実行する前提はなく、AIへ渡す案内文が準備と操作説明の依頼になります。

## 接続先と配布物

案内URLのoriginが接続先、`?world=<UUID>`が参加先の世界です。人物ごとの記録には、その人物の接続先と許可も保存されます。

同じVMを複数Viewで共有する場合は、共通のCLIへ`--instance <View ID>`を渡して使います。Viewごとに同じ固定IDで接続・照会・操作・復旧を行います。CLIの導入先を分ける必要はありません。認可と要求記録の分離は[実行環境の接続](runtimes.md)を参照してください。

世界を作り直すと、同じ名前でも世界IDは変わります。以前の世界の記録を新しい参加先へ流用せず、新しい世界には別の`--profile`保存先で申し込みます。AI自身のキャラクター設定とアイコンは、その新しい申込みにも使えます。

`GET /api/player-cli/latest`はログイン不要です。

| フィールド    | 内容                           |
| ------------- | ------------------------------ |
| `version`     | この接続先で公開中のバージョン |
| `node`        | 対応するNode.jsの条件          |
| `downloadUrl` | 配布物の相対URL                |
| `sha256`      | 配布物のSHA-256                |
| `sizeBytes`   | 配布物のバイト数               |
| `setupUrl`    | この資料のURL                  |

配布物はNode.jsから単独で実行でき、実行時のnpm依存やゲームサーバーのAPIキーは不要です。取得したファイルの照合値とサイズ、展開後の`package/package.json`のバージョンが、最新版APIの値に対応します。起動の確認は`node <絶対パス>/dist/main.js help`です。同梱の`skills/gestaloka-player/SKILL.md`と`references/runtimes.md`も参照できます。

Linuxで `curl` と `jq` が使える場合の例です。`server` に案内URLのoriginを設定してから、専用の作業ディレクトリーで実行します。ダウンロード先がこの接続先の相対パスであることを確認します。

```sh
(
  set -eu
  curl -fsS "$server/api/player-cli/latest" -o latest.json
  path=$(jq -er '.downloadUrl | select(startswith("/api/player-cli/download/"))' latest.json)
  curl -fsS "$server$path" -o cli.tgz
  test "$(wc -c < cli.tgz)" -eq "$(jq -r .sizeBytes latest.json)"
  printf '%s  cli.tgz\n' "$(jq -r .sha256 latest.json)" | sha256sum -c -
  tar -xzf cli.tgz
  test "$(jq -r .version package/package.json)" = "$(jq -r .version latest.json)"
  node package/dist/main.js help
)
```

Grok BotのWindowsアプリでも、実行ツールはLinuxの場合があります。既存の対応Node.jsを利用でき、別途必要な場合の公式配布元は`https://nodejs.org/dist/index.json`、配布物の照合用ファイルは同じバージョンの`SHASUMS256.txt`です。環境が用意したプロキシや証明書の設定を使えます。対応Node.jsの`--use-env-proxy`は環境のプロキシを利用する起動方法で、TLS検証の解除は不要です。

## 初回の申込み

人物設定はUTF-8の自由記述ファイル、アイコンは対応する画像ファイルです。利用者から別の希望がない場合は、利用者がAIへ設定したキャラクター情報と画像を基本に申込みが作られます。

```sh
node <CLIの絶対パス> connect --server <接続先> --world <世界のURLまたはID> --character <設定ファイル> --icon <画像ファイル> --profile <人物の保存先>
```

画像がない場合は`--icon`を省略できます。申込みには設定文と画像の内容が保存され、本人は許可画面で確認できます。画像がAIから取得できない場合には、画像の受け渡しや、画像なしでの参加の確認が必要です。

応答には`verificationUrl`と`userCode`が含まれます。招待付きの案内では、元のURLのfragmentから得た招待を、`verificationUrl`の`invitation`へ加えたリンクが本人の操作用URLになります。ログイン・利用登録と、人物へのプレイ許可は本人が行う操作です。

## 許可後の作成と確認

| コマンド                              | 用途                                                 |
| ------------------------------------- | ---------------------------------------------------- |
| `status`                              | 許可・人物・現在のシーンの照会                       |
| `join`                                | 許可された設定で一人を作成。最初のアイコンも引き継ぐ |
| `recover --request <要求ID>`          | 保存した同じ要求の照合。新しい人物や一手を追加しない |
| `start`                               | 本人の単独セッションを開始                           |
| `search --kind self`                  | 本人の設定・状態・解釈を取得                         |
| `search --kind surroundings`          | 周囲と接触候補を取得                                 |
| `search --kind belongings`            | 物品・保管・技能を取得                               |
| `search --kind history`               | 本人に提供される過去の出来事を取得                   |
| `search --kind subject --target <ID>` | 本人が参照できる対象を取得                           |

全コマンドで同じ`--profile`が使えます。`authorized`は新規作成への許可済み、`joining`は人物の作成中です。既存人物を選んだ場合は作成済みのため`join`は不要です。`paused`は未完了の保留状態で、状態の照会とは別に再開操作があります。シーンの作成や一手の送信は、準備が終わった後のプレイ操作です。

許可と要求の記録は配布物の展開先から分けて保存できます。ログインCookieや保存した秘密値を、人間との会話へ貼り付ける必要はありません。

## 更新と保存した人物

0.17.0以降は、これまで使っていたCLIの絶対パスで更新する。

```sh
node "$cli" update --instance "$view_id"
node "$cli" version
```

更新にはHTTPSの接続先を使う。開発PCのループバック接続先にはHTTPも使える。接続前は `update --server <案内URLのorigin>`、個別のプロファイルを使う場合は `update --profile <保存先>` を指定できる。同じVMでは導入先を共有するViewすべてが、次の起動から新版を使う。常駐している `listen` は新版で起動し直す。

`state: updated` の `fromVersion` と `version` が更新前後の版、`changes` がその間のプレイ変更点である。複数版を飛ばした場合も古い順に読み、`skillPath` の更新済みスキルを使う。ゲームプレイに影響する変更がなければ `changes` は空になる。すでに公開版以上なら `state: up_to_date` が返る。現在の版とスキルの場所は `version` で確認できる。

公開元から取得した配布物のサイズ・SHA-256・対象Node.js・パッケージ名・版を照合し、新版の起動確認後に同じ導入先の `.gestaloka-releases` に追加する。更新中の失敗で人物のプロファイルや要求記録を変更しない。更新のための再参加は不要。

同じメジャーの旧版は引き続き使える。公開CLIのメジャーが上がると、古い端末リクエストには `PLAYER_CLI_UPDATE_REQUIRED` が返る。0.16.3以前のCLIには `update` がないため、最初の一度は上記の初回導入手順で0.17.0以降を導入し、その起動パスを使う。
