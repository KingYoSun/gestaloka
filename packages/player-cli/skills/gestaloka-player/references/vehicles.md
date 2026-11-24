# 乗り物の設定・乗降・操縦

広場にある荷車や、すでに出会ったユニークNPC、プレイヤーの人物を乗り物として扱える。設定にはその物や人物のIDを使う。現地に出ている乗り物には、同じ場所で乗れる。乗っている間は、その乗り物が移動するたびに一緒に移る。

以下の操作は本人の通常手番に行う。コード例の `<乗り物ID>` や `<場所ID>` は、本人の検索で取得した値に置き換える。同じCLIインスタンスなら `@` で始まる短縮IDも使える。

## 既存の物・NPC・プレイヤーの人物を乗り物として設定する

たとえば広場にある荷車に、人が乗って移動できる状態を加える。まず周囲を検索して荷車のIDを見つけ、その品の記録を読む。手持ちの品なら `search --kind self` の持ち物からIDを調べられる。

```sh
gestaloka search --kind surroundings
gestaloka search --kind subject --target <荷車のID>
```

次を `vehicle-setup.json` に保存し、`gestaloka play --file vehicle-setup.json` で申請します。対象は荷車や人物のIDです。

```json
{
  "command": "apply",
  "expectedSp": 1,
  "action": {
    "type": "state",
    "targetId": "荷車のID",
    "feature": "vehicle",
    "text": "荷車の座席を整える",
    "description": "人が座って移動できる荷車"
  },
  "dependencies": []
}
```

新しい乗り物の設定はダイスで判定します。対象がほかの人物の場合、成功後に本人の受領が必要になることがあります。確定した乗り物は現地で `search --kind surroundings` の `material.vehicles.items` に出ます。

## 乗る・行き先を調べる・降りる

同じ場所で周囲を検索し、`material.vehicles.items` の `vehicleId` を使って乗る。手に持っている乗り物や、現地で取り出せる保管先にある乗り物は、乗る操作でその場所に出せる。

```sh
gestaloka search --kind surroundings
gestaloka vehicle board --target <乗り物ID>
gestaloka search --kind self
```

`self` の `material.ride.vehicleId` が乗っている乗り物、`outerPlaceId` が乗り物の現在地。乗車中の `search --kind surroundings` では、その現在地からの経路を `material.routes` で調べられる。

荷車のような物の乗り物に乗っている間は、同じ乗り物に乗っている人物とだけ接触できる。乗り物がNPCやプレイヤーの人物なら車内は分かれず、乗り物のいる場所の人物とも接触できる。

次のコマンドを実行すると、その時点で乗り物がいる場所に降りる。

```sh
gestaloka vehicle leave --target <乗り物ID>
```

## 操縦権を申請して運行する

乗り物のある場所で、自分の通常手番に操縦権を申請する。すでに乗っている人も、その乗り物に申請できる。

```sh
gestaloka vehicle request-control --target <乗り物ID>
```

ほかの所持者や操縦者がいない物なら、その場で取得できる。乗り物がユニークNPCやプレイヤーの人物なら、同じセッションで申請し、本人の受領判断を待つ。結果は `status` で読める。取得した人は `operatorId` で確認でき、同じ乗り物へ再申請するとすでに持っている操縦権を確認できる。専用の操縦権は一つの乗り物につき一人まで。

操縦権を得たら、乗った状態で行き先のIDを指定する。通行に能力が必要な区間では、乗り物にその能力があれば通れる。同乗者も到着先へ移る。

```sh
gestaloka search --kind surroundings
gestaloka vehicle travel --target <乗り物ID> --place <行き先のID>
```

判定で乗り物に損傷などの状態が付いているときは、運行・自走・同行の移動の前に、GMがその状態で動けるかを判断する。動けなければ `VEHICLE_DISABLED` が返り、理由がメッセージに入る。通常枠もSPも使わない。同行で付いてくる乗り物は、動けなければその場に残る。損傷の状態が終わる（期限が来る、修理して終える）と、判断なしで動けるようになる。損傷の無い乗り物の移動では、GMは判断しない。

### 相手に対抗して操縦権を取る

ほかの人物が乗り物を所持・操縦している場合、通常の申請では `VEHICLE_OPPOSITION_REQUIRED` が返る。対抗を選んだときは `--oppose` を付けて申請する。乗り物本人が通常の申請を却下した後に、その本人に対抗する場合も同じ指定を使う。

```sh
gestaloka vehicle request-control --target <乗り物ID> --oppose
```

乗り物本人は承認済みで、別の所持者や操縦者にだけ対抗する場合は、承認を受けた申請のIDを `--application` に添える。

```sh
gestaloka vehicle request-control --target <乗り物ID> --oppose --application <承認を受けた申請ID>
```

必要な相手すべてへの対抗に成功すると操縦権が確定する。交代が成立すれば `previousOperatorId` に前の操縦者が出る。所持への対抗にも成功した場合、乗り物は元の所持品から外れてその場所に残る。

## 乗り物でもあるコンパニオンと移動する

その乗り物のNPCが自分のコンパニオンなら、同行関係を使って移動させられる。本人の通常手番に `move` で行き先を指定できる。帰る場所を設定済みなら `return` で向かわせられる。乗っている人はその移動についていく。

```sh
gestaloka companion move --target <乗り物ID> --place <行き先のID>
gestaloka companion return --target <乗り物ID>
```

同行の申請と帰る場所の指定は [NPCの出現・昇格・同行](npcs.md) を参照する。

## プレイヤーの人物を乗り物にする

プレイヤーが操作する人物も乗り物にできる。背に人を乗せる大きな生き物や、人を運べる機械の体などに使う。設定の手順は物やNPCと同じで、`source` にその人物のIDを指定する。自分を乗り物にするなら自分のIDを、ほかのプレイヤーの人物なら同じセッションで相手のIDを指定し、相手の受領を待つ。

乗り物になった人物の扱いは次のとおり。

- 本人は、自分の手番に本人の `locate`（[操作の書き方](commands.md)）でこれまでどおり移動できる。操縦権は要らず、乗っている人は一緒に移る。
- ほかの人物は `vehicle board` で乗り、`vehicle leave` で降りる。
- ほかの人物が操縦権を申請すると、同じセッションにいる本人の受領に回る。承認された人物は、乗った状態で `vehicle travel` を使って本人ごと移動できる。本人に対抗するときは `--oppose` を付ける。
- 本人も乗客も、乗り物のいる場所にいる扱いになる。乗客どうしや本人とはもちろん、同じ場所にいる車外の人物とも会話できる。乗り物が移動すると、乗客は一緒に移り、出発地に残った人物とは別れる。

乗り物をやめるときは、設定で作った `vehicle` の関係のIDを `endEdges` に入れて `update` を申請する。
