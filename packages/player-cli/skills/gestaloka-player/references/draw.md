# 抽選器で遊ぶ

既存の場所や物品に抽選器を設定できます。GM生成では、引くたびにGMが説明に沿って物品や技能を一件決めます。固定表では作り手が候補と重みを登録し、GMが承認した公開版からサーバーが一件選びます。どちらも `draw` で引けます。

設定の審査は0 SPです。利用時の消費は、GM生成と、新しい物品・技能を含む固定表が1 SPです。表示と既存在庫の移転だけの表は0 SPです。代価とSPはそれぞれ `search` の `draw.price` と `draw.spCost` で確認できます。

## 抽選器を見つけて引く

本人の通常手番に、現在地、その場に置かれた物品、手持ちの物品を指定できます。`search --kind surroundings` で候補を探し、`search --kind subject --target <対象ID>` で説明と条件を読みます。

```sh
gestaloka draw --target <対象ID> --text '箱を振ってから札を一枚取る'
```

`--text` は同席者に伝える描写です。省略しても引けます。物品や技能を得たら、`search --kind self` で確認できます。通信が途切れたら `recover` で同じ要求の結果を取得できます。公開版が切り替わっても、その要求の景品・SP・代価は当初の一回分です。

## ジャンクヤードでGM生成を使う

```sh
gestaloka draw-configure --target <ジャンクヤードID> --description '廃材の山から、修理や工作に使える小さな部品が一つ見つかる'
```

GMが説明と対象を審査します。必要な受領がそろうと公開されます。`state: "rejected"` の場合は `reason` を読み、説明を修正して申請します。承認後は、訪れた人が部品の種類を知らない状態で引けます。

## 無料のおみくじを作る

以下のJSONを一件ずつファイルに保存し、`gestaloka play --file <ファイル>` で送ります。IDと `revision` は実際の応答の値に置き換えてください。CLIが要求IDを付けます。

1. `{"command":"draw-table-edit","targetId":"<祠ID>"}` で下書きを開きます。
2. `{"command":"draw-table-settings","targetId":"<祠ID>","revision":1,"description":"札を一枚引いて運勢を読む","price":null}` で説明を設定します。
3. `{"command":"draw-table-put","targetId":"<祠ID>","revision":2,"result":{"kind":"message","text":"吉"}}` で候補を追加します。続けて「小吉」を重み2、「大吉」を重み1で追加します。変更のたびに応答の新しい `revision` を使います。
4. `{"command":"draw-table-show","targetId":"<祠ID>","view":"draft"}` で候補を確認します。この例では「吉」が25%、「小吉」が50%、「大吉」が25%です。候補は32件まで登録できます。
5. `{"command":"draw-table-publish","targetId":"<祠ID>","revision":5}` で審査を申請します。`state: "receiving"` の場合は、必要な受領がそろった時点で公開されます。`view: "published"` で現在の公開版を確認できます。

候補を編集するときは `draw-table-put` に `entryId` を付けます。重みを省くと、追加時は1、編集時は現在の値になります。候補を取り除くときは `draw-table-remove` に `entryId` と `revision` を渡します。公開済みの表を編集するときは `draw-table-edit` に `"fromPublished": true` を付けると、公開版の内容で下書きを開き直せます。審査中や却下後も、利用者は直前の公開版から引けます。

## 銅貨を受け取る福引を作る

福引のある場所に自分が管理する保管先を用意し、そこに景品を預けます。候補の `result` に `{"kind":"stock","storageId":"<保管先ID>","itemId":"<景品ID>","count":1}` を指定します。「はずれ」を入れるときは `message` を追加します。表示と既存在庫の移転だけの表なので、抽選は0 SPです。

`draw-table-settings` の `price` に `{"storageId":"<受取先ID>","paymentSeriesId":"<銅貨の系列ID>","paymentLabel":"銅貨","count":1}` を設定して公開を申請します。訪れた人は `search` で代価と公開版IDを読み、自分の持ち物から支払う銅貨を指定します。

```sh
gestaloka draw --target <福引ID> --table-version <公開版ID> --payment <銅貨の物品ID>
```

当たりなら銅貨の支払いと景品の移転が同時に確定します。「はずれ」でも掲示された代価を支払います。見た後に公開版が変わった場合は、条件を確認して新しい公開版IDを指定します。

景品候補の一つでも在庫が足りない間は、表全体の抽選が停止します。登録済みの景品IDの在庫を保管先に補充すると再開します。別IDの在庫に差し替える場合は、その候補を編集して公開し直します。

## 祠の固定表から物品や技能を授ける

候補の `result` に `{"kind":"item","label":"磨かれた青いガラス玉"}` や `{"kind":"skill","text":"木片を叩き、表面に近い空洞を音で聞き分けられる"}` を指定します。この表は毎回1 SPを使います。「何も授からない」という `message` の候補を混ぜた場合も、表に表示された1 SPを消費します。
