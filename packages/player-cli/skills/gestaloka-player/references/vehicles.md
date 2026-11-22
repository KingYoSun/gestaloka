# 乗り物の設定・乗降・操縦

広場にある荷車や、すでに出会ったユニークNPCを乗り物として扱える。設定にはその物やNPCのIDを使う。現地に出ている乗り物には、同じ場所で乗れる。乗っている間は、その乗り物が移動するたびに一緒に移る。

以下の操作は本人の通常手番に行う。コード例の `<乗り物ID>` や `<場所ID>` は、本人の検索で取得した値に置き換える。同じCLIインスタンスなら `@` で始まる短縮IDも使える。

## 既存の物やNPCを乗り物として設定する

たとえば広場にある荷車に、人が乗って移動できる状態を加える。まず周囲を検索して荷車のIDを見つけ、その品の記録を読む。手持ちの品なら `search --kind self` の持ち物からIDを調べられる。

```sh
gestaloka search --kind surroundings
gestaloka search --kind subject --target <荷車のID>
```

次の内容をUTF-8の `vehicle-setup.json` に保存し、`gestaloka play --file vehicle-setup.json` で申請する。説明と関係にはそれぞれ新しいUUIDを作り、`source` には荷車のIDを入れる。検索で得た依存版があれば `dependencies` に入れる。

```json
{
  "command": "update",
  "text": "荷車の座席を整え、人が乗って移動できるようにする",
  "changes": {
    "nodes": [
      {
        "id": "新しい説明のUUID",
        "kind": "script",
        "text": "人が座って移動できる荷車。"
      }
    ],
    "revisions": [],
    "edges": [
      {
        "id": "新しい関係のUUID",
        "kind": "status",
        "role": "content",
        "source": "荷車のID",
        "target": "新しい説明のUUID",
        "text": "vehicle",
        "period": { "from": 0 }
      }
    ],
    "endEdges": []
  },
  "dependencies": []
}
```

関係の `text` は `vehicle` と書き、どんな乗り物かは説明用の `script` に書く。ユニークNPCなら、同じセッションでそのNPCのIDを `source` に指定する。

新しい状態を申請すると、GMが成功範囲を決め、サーバーがダイスを振る。ほかの人物の判断が必要な場合は、ダイスの成功後に受領が回る。`outcome.success` と `state` を確認し、`receiving` の場合は [受領の結果](sessions.md) を待つ。設定が確定すると、現地で検索したときに `material.vehicles.items` に対象が出る。

## 乗る・行き先を調べる・降りる

同じ場所で周囲を検索し、`material.vehicles.items` の `vehicleId` を使って乗る。手に持っている乗り物や、現地で取り出せる保管先にある乗り物は、乗る操作でその場所に出せる。

```sh
gestaloka search --kind surroundings
gestaloka vehicle board --target <乗り物ID>
gestaloka search --kind self
```

`self` の `material.ride.vehicleId` が乗っている乗り物、`outerPlaceId` が乗り物の現在地。乗車中の `search --kind surroundings` では、その現在地からの経路を `material.routes` で調べられる。

次のコマンドを実行すると、その時点で乗り物がいる場所に降りる。

```sh
gestaloka vehicle leave --target <乗り物ID>
```

## 操縦権を申請して運行する

乗り物のある場所で、自分の通常手番に操縦権を申請する。すでに乗っている人も、その乗り物に申請できる。

```sh
gestaloka vehicle request-control --target <乗り物ID>
```

ほかの所持者や操縦者がいない物なら、その場で取得できる。相手がユニークNPCなら、同じセッションで申請し、NPC本人の受領判断を待つ。結果は `status` で読める。取得した人は `operatorId` で確認でき、同じ乗り物へ再申請するとすでに持っている操縦権を確認できる。専用の操縦権は一つの乗り物につき一人まで。

操縦権を得たら、乗った状態で行き先のIDを指定する。通行に能力が必要な区間では、乗り物にその能力があれば通れる。同乗者も到着先へ移る。

```sh
gestaloka search --kind surroundings
gestaloka vehicle travel --target <乗り物ID> --place <行き先のID>
```

### 相手に対抗して操縦権を取る

ほかの人物が乗り物を所持・操縦している場合、通常の申請では `VEHICLE_OPPOSITION_REQUIRED` が返る。対抗を選んだときは `--oppose` を付けて申請する。乗り物のNPC本人が通常の申請を却下した後に、そのNPCに対抗する場合も同じ指定を使う。

```sh
gestaloka vehicle request-control --target <乗り物ID> --oppose
```

NPC本人は承認済みで、別の所持者や操縦者にだけ対抗する場合は、承認を受けた申請のIDを `--application` に添える。

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

同行の申請と帰る場所の指定は [NPCの出現・昇格・同行](npcs.md) を参照する。乗り物のNPC自身も、自分の手番に運行を選べる。
