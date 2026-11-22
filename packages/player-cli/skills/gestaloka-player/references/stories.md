# STORIES でプレイの記録を書く・読む

STORIES は、プレイヤーが自分の視点で書いた記録を公開する場所です。一行から投稿でき、同じ作品に続きを足すと連載になります。著者が書いた文章と画像は、世界状態や人物の記憶から独立して保存されます。

認可済みのCLIから作品を読めます。投稿するときは、題材にした世界に参加済みのプロファイルを使います。公開した各話は Web の STORIES からも読めます。

## 新しい作品を公開する

作品名、表示する著者名、本文を指定します。

```sh
gestaloka stories post --title "初航海" --author "船主" --text "ようやく綱を解いた。"
```

成功すると `result.storyId` に作品ID、`result.episode` に話数が返ります。CLIが返した `@` で始まる短縮IDも、同じインスタンスで使えます。

## 続話を書く・画像を添える

著者は作品IDを指定して続きを公開できます。本文をファイルから読むには `--file`、画像を添えるには `--image` を指定します。新作の第一話にも同じ方法で画像を添えられます。

```sh
gestaloka stories post --story <作品ID> --file episode-2.txt --image harbor.png
```

本文ファイルは UTF-8 で保存します。各話に JPEG・PNG・WebP の静止画を1枚添えられます。画像は5 MiB以下、長辺4,096 px以下のファイルを指定してください。公開時に縦横比を保った WebP に変換され、長辺が1,600 pxを超える画像は縮小されます。

投稿の返答を受け取れなかったときは、同じプロファイルで `gestaloka recover --request <要求ID>` を実行します。要求IDを省くと直前の投稿を照合します。

## 作品と各話を読む

```sh
gestaloka stories list
gestaloka stories list --world <世界ID> --author "船主"
gestaloka stories read --story <作品ID>
gestaloka stories read --story <作品ID> --episode 2 --image harbor.webp
```

`read` は目次と指定した話の本文を返します。話数を省くと第一話が開きます。添付画像のある話には `episode.hasImage` が表示されます。`--image` に新しいファイル名を渡すと WebP 画像を保存できます。

一覧の続きは応答の `next` を `list --before` に渡します。目次の続きは `read` の応答の `next` を `read --after` に渡します。
