# テンプレート・設計図・クエスト

たとえば「道沿いに店を建てて菓子を売る」とき、建築から開店までの手順を定めるのが**テンプレート**、今回の建設地・店主・商品・代価を記入するのが**設計図**。その設計図をもとに、誰がどこで何を提供し、どこまで完成したかを記録するのが**クエスト**。同じテンプレートで別の店を建てれば、それぞれの店に別のクエストができる。

## 新しく始めるか、現地で手伝うか

以下の `command` は、一つずつUTF-8のJSONファイルに書き、`gestaloka play --file action.json` で送る。例のIDは自分のCLIで確認した値に置き換える。

- **新しく始める人**は `{"command":"blueprint-templates"}` で公開版を探す。`templates` の名称・版・進行形式（`mode`）・完成後の効果（`effect`）を読み、選んだ版の `id` を設計図の `plan.templateId` に使う。
- **手伝う人**は現地で `{"command":"blueprint-list"}` を送る。`quests` には現地で進行中のクエストや完成したものが並ぶ。手伝いたいクエストの `quest.id` を `blueprint-show` の `questId` に渡し、「材料を提供する」へ進む。別のセッションから来た人も参加できる。

どちらの一覧も、続きがあるときは返った `next` を同じ操作の `after` に渡す。公開テンプレートは発祥の世界を越えて使える。公開前の版を試すときは、発祥の世界で原案者か指定の試遊者が、受け取った下書きIDを `templateId` に使う。新しい遊び方の提案は `gestaloka report --text <提案>` で運営に送れる。

## 設計図を記入する

発案者は現地で `blueprint-propose` を送る。`plan` には選んだ版の `templateId`、現地の `placeId`、今回の店主または製作物の管理者を指定する `keeperId`、何をするかを説明する `description` を書く。テンプレートの原案者と、今回の発案者や店主は別の人物でもよい。

| 進行形式                      | 現地と記入項目                                                                      | 完成すると                                                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 建築 `build`                  | `placeId` は道の接続元。`building.label` に建屋の名前を書く。                       | 現地から行き来できる建屋ができる。第三者は中に入れ、店主は保管先として使える。                                                        |
| 開店 `open`                   | `placeId` は店主が保管先として登録した既存店。`shop.stock` に商品と交換条件を書く。 | 初期在庫がその店に移る。客は店主が不在でも公開交換で買える。                                                                          |
| 建築して開店 `build-and-open` | 建設地で `building` と `shop` の両方を書く。                                        | 建築が済めば入店と保管ができる。在庫が揃うと同じ建屋で営業が始まる。                                                                  |
| 製作 `craft`                  | 製作場所で `product.label` に今回作る品の名前を書く。                               | 製作物は管理者の手持ちになる。設置を指定したテンプレートでは、現地に空の保管先ができる。製作物のIDは `quest.productId` で確認できる。 |

建築・製作に使う材料と道具は、テンプレートの `materials` で確認する。材料指定のない建築テンプレートでは、発案者が `building.materials` に品ごとの `label`、必要数 `count`、用途 `usage` を書く。消費材は `consume`、使用後も残る道具は `tool` を指定する。

たとえば、材料指定のある `build-and-open` で店を開く設計図は次の形になる。`stockCount` は店に用意する総数、`count` と `paymentCount` は1回の交換で渡す数と受け取る数。この例では焼き菓子を6個用意し、銅貨2枚につき1個を売る。

```json
{
  "command": "blueprint-propose",
  "plan": {
    "templateId": "公開一覧で選んだ版のID",
    "placeId": "建設地のID",
    "keeperId": "店主の人物ID",
    "description": "広場に小さな店を建て、焼き菓子を売る",
    "building": { "label": "広場の菓子店" },
    "shop": {
      "stock": [
        {
          "itemId": "実在する焼き菓子のID",
          "stockCount": 6,
          "count": 1,
          "paymentSeriesId": "銅貨の系列ID",
          "paymentLabel": "銅貨",
          "paymentCount": 2,
          "text": "焼き菓子1個を銅貨2枚と交換"
        }
      ]
    }
  }
}
```

## 同意を得て着工する

1. 発案者は申請結果の `quest.id` を控える。設計図を記入した時点の `quest.phase` は `draft`。以後の同意・着工・照会・提供には、このIDを `questId` として使う。
2. 別の人物を店主・管理者に指定した場合、その人物に通知が届く。引き受ける人は `{"command":"blueprint-show","questId":"今回のクエストID"}` で内容を読み、同じIDで `blueprint-consent` を送る。発案者自身が引き受ける場合は、記入時に同意済みになる。
3. 発案者は現地で自分の通常手番に `blueprint-show` を確認し、`actions["blueprint-start"].allowed` が `true` なら、同じIDで `blueprint-start` を送る。GMが新たに審査すると1 SPを使う。採用されれば最初の段階（`build`、`open`、`craft`）に進む。差し戻しは `rejected` となり、`quest.reason` で理由を読める。

## 材料を提供する

`blueprint-show` の `location.current` は自分の現在地、`location.contributionPlaces` は提供を受け付ける場所。`requirements` の各行で要件番号（`index`）、必要数（`count`）、提供済みの数（`provided`）を確認する。`actions` には本人が今できる操作と、できない場合の理由が出る。

提供できるのは本人の手持ち品か、現地で本人が使える登録済みの保管先にある品。建材や道具は要件と同じ呼称の品を選び、次のように `provision` を添えて照会する。開店用の在庫は設計図で品のIDを指定しているので、`questId` だけで照会できる。

```json
{
  "command": "blueprint-show",
  "questId": "今回のクエストID",
  "provision": { "requirement": 0, "itemId": "候補の品のID" }
}
```

`actions["blueprint-provide"].requirements` の `maxCount` が、取り置き済みの数と残りの必要数を考慮して、今その品から出せる数。`completionBlock` があれば、最後の1個を出す前に整える条件を読む。提供するときは、現在の `quest.phase`、要件番号、品のIDを指定する。たとえば建築中に要件0の建材を2個出せるなら、次のように送る。

```json
{
  "command": "blueprint-provide",
  "questId": "今回のクエストID",
  "phase": "build",
  "requirement": 0,
  "itemId": "照会した建材のID",
  "count": 2
}
```

品は段階が完了するまで取り置かれ、その分は移動や交換に使えない。全要件が揃うと自動でその段階が完了する。消費材は使い切り、道具の取り置きは解放され、開店用の在庫は店へ移る。`build-and-open` なら同じクエストが `build` から `open` に進む。最終段階まで終わると `done` になる。照会・提供・段階の完了は0 SP。

提供を取り下げるときは `blueprint-show` の `contributions` から自分の取り置きの `id` を選び、`blueprint-withdraw` に `questId` と `contributionId` を渡す。材料を集めている間は発案者または店主・管理者が `blueprint-cancel` でクエストを中止できる。中止すると `cancelled` になり、未確定の取り置きが解放される。建築後、開店前に中止した場合は、建屋・道・保管先登録が残り、使った建材は戻らない。

開店した店は完成通知の場所IDから訪ねられる。現地で `gestaloka search --kind surroundings` の `exchangeOffers` を読み、`gestaloka exchange --offer <交換ID> --payment <支払い品のID>` で買う。

## 製作した保管先で品を受け渡す

設置型の製作物は、空の保管先ができた時点で完成する。品を入れて受領枠を掲示するのは完成後の操作。公開枠・本人宛ての枠のどちらを使えるか、移設できるかは、選んだテンプレートの `installation` で確認できる。

以下の操作は `play --file` で送る。`storageId` は製作した保管先のID。管理者は現地で通常の `update` の `move` を使って手持ちの品を保管先に入れ、移動後の実物IDを確認する。

| 操作               | 入力と結果                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage-list`     | 現在地の設置済み保管先を表示する。                                                                                                                       |
| `storage-post`     | 管理者が `storageId`、`itemId` と `allocations` を指定する。例えば `[{"count":2},{"count":1,"recipientId":"受取人のID"}]` で公開2個・指定1個を取り置く。 |
| `storage-offers`   | 現地で `storageId` を指定する。公開枠と自分宛ての枠、預けた本人には自分が掲示した枠が返る。`items[].id` が受領枠のID。                                   |
| `storage-claim`    | 現地で `storageId`、`allocationId`、`count` を指定して受け取る。管理者が退出した後も使える。                                                             |
| `storage-withdraw` | 預けた本人が現地で `storageId` と `allocationId` を指定すると、枠の残りを解放する。品は保管先に残る。                                                    |
| `storage-relocate` | 移設を許す定義では、管理者が現地で `storageId` と移設先の `placeId` を指定する。中身と枠を同じIDで移設先から使える。                                     |
| `storage-history`  | `storageId` を指定して、自分が預けた品、または自分が受け取った品について、受領者・数量・確定時刻を確認する。                                             |

一覧に続きがある場合は返った `next` を `after` に渡す。掲示、受領、取り下げ、移設、照会の消費SPは0。無償の受領と店での有償の公開交換は、それぞれの掲示条件に従う。
