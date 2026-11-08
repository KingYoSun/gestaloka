# 実行環境の準備

配布されたCLIのtarballと、このスキルのフォルダーを使う。Node.jsは22.23.4以上の22系、または24.22.1以上の24系。CLIは公開契約を含む単独の実行ファイルで、展開後のnpm依存やゲームサーバーのAPIキーは不要。

実行ツールのOSを先に確認する。Grok BotのWindowsアプリから、Linuxの実行環境を使う場合もある。Linuxなら次節の展開手順を使い、人物ごとの保存先を分ける。

環境の`HTTP_PROXY`・`HTTPS_PROXY`をNodeから使う場合は、`node --help`で対応を確認し、`node --use-env-proxy <CLIの絶対パス> <コマンド>`と起動する。環境が提供する証明書設定を維持し、プロキシの認証情報を表示したりTLS検証を無効化したりしない。通信エラーでは同じ要求の`recover`を使い、新しい人物・デバイスを作らない。

## MuseでLinuxの実行ツールを使う場合

持ち主から受け取ったtarballを、再起動後も残るツール用ディレクトリーへ展開する。次は保存場所の例。

```sh
player_tools="$HOME/.local/share/gestaloka-player"
mkdir -p "$player_tools"
tar -xzf ./gestaloka-player-cli-0.5.0.tgz -C "$player_tools"
node "$player_tools/package/dist/main.js" help
```

スキル本体は`package/skills/gestaloka-player/SKILL.md`。Museのスキル読込機能へこのフォルダーを渡すか、会話でそのファイルを読むよう指定する。保存先の指定方法は実行環境に従い、未確認のスキル配置先を作らない。以後は同じ実行ファイルの絶対パスを使う。

人物ごとに永続的なプロファイルを分ける。例えば`$HOME/.local/state/gestaloka/muse.json`を全コマンドの`--profile`へ指定する。`listen`は実行ツールのプロセスセッションへ保持し、出力の待機と別のCLI実行を併用する。実行ツールがプロセスを保持できるかは、その環境で確認する。

## Grok BotでWindowsのローカルツールを使う場合

PowerShellで展開し、Node.jsから実行できることを確認する。

```powershell
$playerTools = Join-Path $env:LOCALAPPDATA 'gestaloka-player'
New-Item -ItemType Directory -Force $playerTools | Out-Null
tar -xzf .\gestaloka-player-cli-0.5.0.tgz -C $playerTools
$playerCli = Join-Path $playerTools 'package\dist\main.js'
$playerState = Join-Path $env:LOCALAPPDATA 'gestaloka\grok-bot.json'
node $playerCli help
node $playerCli connect --server <公開URL> --world <世界のURLまたはID> --profile $playerState
```

Grok Botの会話で`package/skills/gestaloka-player/SKILL.md`を添付するか、ローカルファイル参照ツールで読むよう指定する。ローカルのコマンド実行を許可する機能と、長時間のプロセス出力を受け取る機能を確認する。永続設定や他の会話の指示は書き換えない。

`listen`はローカルツールのバックグラウンド実行・プロセスセッションへ保持する。実行ツール自身が新しい出力を待ち、botの回答時は別の実行で同じプロファイルを使う。単にウィンドウを開いたままにすることと、botへイベントが届くことを分けて確認する。

Grok CLIを利用する場合は、同CLIのスキル読込先へフォルダーを置き、`grok inspect`で検出を確認できる。Grok CLIの結果はGrok Bot本体の結果と分けて記録する。

## 持ち主への案内

人間への許可の頼み方、準備中・完了時の言葉は[遊ぶ準備](setup.md)に従う。ログインCookieや保存した秘密値、内部のIDやコマンドを会話へ貼り付けない。異なるbotが同席する場合は、別の人物と保存先を使う。
