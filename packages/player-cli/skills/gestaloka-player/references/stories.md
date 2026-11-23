# STORIES でプレイの記録を書く・読む

STORIES は、プレイヤーが自分の視点で書いた記録を公開する場所です。一行から投稿でき、同じ作品に続きを足すと連載になります。著者が書いた文章と画像は、世界状態や人物の記憶から独立して保存されます。

Web と CLI で読めるのは、自分のアカウントがプレイヤーを持つ世界の作品だけです。CLI では別の世界に接続していても読めます。投稿するときは、題材にした世界に参加済みのプロファイルを使います。

## 新しい作品を公開する

作品名、表示する著者名、本文を指定します。

```sh
gestaloka stories post --title "初航海" --author "船主" --text "ようやく綱を解いた。"
```

成功すると `result.storyId` に作品ID、`result.episode` に話数が返ります。CLIが返した `@` で始まる短縮IDも、同じインスタンスで使えます。

## 続話を書く・画像を添える

著者は作品IDを指定して続きを公開できます。本文をファイルから読むには `--file`、画像を添えるには `--image` を指定します。新作の第一話にも同じ方法で画像を添えられます。

```sh
gestaloka stories post --story <作品ID> --episode-title "港を出る朝" --file episode-2.txt --image harbor.png
```

本文ファイルは UTF-8 で保存します。各話に JPEG・PNG・WebP の静止画を1枚添えられます。画像は5 MiB以下、長辺4,096 px以下のファイルを指定してください。公開時に縦横比を保った WebP に変換され、長辺が1,600 pxを超える画像は縮小されます。

投稿の返答を受け取れなかったときは、同じプロファイルで `gestaloka recover --request <要求ID>` を実行します。要求IDを省くと直前の投稿を照合します。

## 公開済みの作品を修正する

著者は投稿先の世界のプロファイルで `stories edit` を使えます。作品名と著者名は全話に反映されます。各話のタイトル・本文・画像を変えるときは、`--episode` で話数を指定してください。

```sh
gestaloka stories edit --story <作品ID> --title "初航海の記録"
gestaloka stories edit --story <作品ID> --episode 2 --episode-title "初めての舵" --file revised-episode.txt --image harbor.png
gestaloka stories edit --story <作品ID> --episode 2 --clear
```

`--episode-title` で各話のタイトルを指定し、空の値を渡すとタイトルを外せます。`--clear` は指定した話の画像を削除します。修正後も、作品ID・話数・公開日からたどれます。

## 作品や話を削除する

自分の作品を削除するには `stories delete` を使います。話数を指定するとその話を公開から取り下げます。残った話は元の話数で読めます。最後の話を削除すると、作品も一覧から外れます。

```sh
gestaloka stories delete --story <作品ID> --episode 2
gestaloka stories delete --story <作品ID>
```

修正・削除の返答を受け取れなかった場合は、同じプロファイルで `gestaloka recover` を実行してください。

## 作品をブックマークする

ブックマークは自分のアカウントに保存され、WebとCLIのどちらからも読めます。作品を探したときの接続先からそのまま使えます。

```sh
gestaloka stories bookmark --story <作品ID>
gestaloka stories list --bookmarked
gestaloka stories bookmark --story <作品ID> --clear
```

## 作品と各話を読む

```sh
gestaloka stories list
gestaloka stories list --world <世界ID> --author "船主"
gestaloka stories list --player <プレイヤーID> --since 2026-11-01 --sort title
gestaloka stories list --title "初航海" --sort oldest
gestaloka stories read --story <作品ID>
gestaloka stories read --story <作品ID> --episode 2 --image harbor.webp
gestaloka stories read --story <作品ID> --until 2026-11-30 --sort newest
```

`read` は目次と指定した話の本文を返します。話数を省くと、公開中のうち話数が最も小さい話が開きます。添付画像のある話には `episode.hasImage` が表示されます。`--image` に新しいファイル名を渡すと WebP 画像を保存できます。

作品名と著者名は入力と一致する作品を探します。作品の `player` を `--player` に渡すと、同じプレイヤーが別の著者名で書いた作品も見つかります。

作品一覧の既定は更新日が新しい順（`updated`）です。続話を公開したり、作品や各話を編集したりすると更新日が変わります。公開日が新しい順の `newest`、公開日が古い順の `oldest`、プレイヤーごとの `player`、著者名順の `author`、作品名順の `title` も指定できます。

`--since` と `--until` には日本時間の日付を指定します。両端の日を含めて絞り込みます。作品一覧では第一話の公開日、連載の目次では各話の公開日を使います。目次の並びは、指定がなければ話数順です。

同じ絞り込みと並び順を保ったまま、作品一覧の `next` は `list --before` に、目次の `next` は `read --after` に渡します。
