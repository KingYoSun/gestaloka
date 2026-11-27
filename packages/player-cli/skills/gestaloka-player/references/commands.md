# 世界への申請

世界を変更する申請は `gestaloka play --file <JSONファイル>` で送ります。共有世界を変更するリクエストでは、`command` に `apply`、`action` に操作の種類と対象を指定します。対象には、本人が照会で得たIDを使います。CLIが要求IDを作って保存するので、返答を失ったときは `recover` で照合できます。

`play --file <JSONファイル> --quote` で送信前の予定SPを確認できます。返った `expectedSp` を申請ファイルに入れ、`--quote` を外して送信します。生成案と対人対抗は、新しく抽選した単位ごとに、成否にかかわらず1 SPを使います。材料不足などで抽選前に止まった生成案は消費しません。正式改名は採否を保存した審査1件につき1 SPで、ダイスは振りません。

## 用途別の更新

| action.type         | 直接変えるもの                                             | 予定SP    |
| ------------------- | ---------------------------------------------------------- | --------- |
| `direct`            | 本人や同行者の移動、物品の受け渡し・消費、保管先登録の終了 | 0         |
| `generate`          | 物品の製作、技能の習得・発展、保管先の初回登録             | 案ごとに1 |
| `summon`            | 手持ちの召喚石を1個使い、その生物を現在地に呼び出す        | 0         |
| `increase-count`    | 既存の物品の個数を増やす                                   | 1         |
| `share-storage`     | 本人が登録した保管先を、受領を経て共有する                 | 0         |
| `state`             | 指定した存在の状態の追加・置き換え・終了                   | 1         |
| `oppose`            | 同席する人物・個体への対抗                                 | 1         |
| `seize`             | ほかの人物から本人への物品の奪取                           | 1         |
| `remove-place-item` | 登録保管先ではない現在地に置かれた物品の除去               | 0         |
| `rename`            | 物品・家や場所・人物・技能の正式な呼び名                   | 1         |
| `clarify`           | 確定済みの状態や技能の説明、習得根拠の訂正                 | 0         |
| `detach`            | 本人に付いている着脱可能な物の関係の終了                   | 0         |
| `interpret`         | 本人が対象をどう捉えたか                                   | 0         |
| `revise-memo`       | 既存のメモの本文                                           | 0         |

物品生成・死亡ドロップ・抽選で生きた人間や動植物を得たときは、その生物の召喚石が手に入ります。`search --kind self` で手持ちの石のIDを調べ、次の申請で1個使うと、同じ場所とセッションにサーバー担当のユニークNPCが現れます。昇格申請は不要です。

```json
{
  "command": "apply",
  "expectedSp": 0,
  "action": { "type": "summon", "itemId": "<手持ちの召喚石のID>" }
}
```

`direct.operations` の `locate` は、人物や品がどこにいるかを記録します。たとえば、人物が広場へ移動するときは、その人物を `subjectId`、広場を `aboutIds` に指定します。指定した所在がすでに記録されていれば、変更は0件です。

```json
{
  "command": "apply",
  "expectedSp": 0,
  "action": {
    "type": "direct",
    "text": "指定した場所へ移動する",
    "operations": [
      {
        "type": "locate",
        "subjectId": "本人のID",
        "text": "移動先の名前",
        "aboutIds": ["移動先のID"]
      }
    ]
  },
  "dependencies": []
}
```

手持ちの本を箱に入れるときは、`direct.operations` に次の `move` を指定します。`item` は品のID、`from` は現在の所持先、`to` は新しい所持先です。同じ広場にいる相手に渡すときも、`to` にその相手のIDを指定します。`locate` の本文に「箱に入れる」と書いても、所持先は変わりません。

```json
{
  "type": "move",
  "item": "本のID",
  "from": "本人のID",
  "to": "箱のID",
  "basis": "本を箱にしまう"
}
```

品と代価を同時に移す場合は二つの `move` を同じ申請に含めます。時間差の受領が必要な受け渡しでは、`deferredUntil` を `action` に指定します。使える条件は [時間差の受領](sessions.md) を参照してください。ほかに `direct.operations` では `remove` と `revoke` を使えます。

### 物を使って何かを変える

製作・習得は `generate.plans` に、説明と直接の操作を案ごとに入れます。必要な材料は案の `materials` に物品IDと個数を指定できます。独立した案を同じ申請で送っても、成否とSPは案ごとに扱います。時間指定は物品製作案1件に `waitMinutes` を付けます。

```json
{
  "command": "apply",
  "expectedSp": 1,
  "action": {
    "type": "generate",
    "plans": [
      {
        "text": "木片を削ってしおりを作る",
        "operation": {
          "type": "create",
          "label": "木のしおり",
          "holder": "本人のID",
          "basis": "木片を薄く削り、表面を磨く"
        }
      }
    ]
  },
  "dependencies": []
}
```

技能の発展に使う元技能は、操作 `learn` の `consumeSkillIds` に指定します。元技能を使うのは発展が成功した場合です。

## 正式な呼び名・説明・状態を改める

`rename` には対象IDと新しい `name` を指定します。技能の能力本文と習得根拠は同じ技能に残ります。`clarify` で技能や状態の説明を訂正するときは、記述の `targetId` と新しい `text` を指定します。習得根拠を直すには技能IDを指定し、`basis` も渡します。訂正は確定済みの内容の範囲で行います。能力の追加や制約の変更は、新しい習得・発展を申請してください。

状態を追加する `state` には、影響を受ける `targetId`、行為の `text`、成立したときの `description` を指定します。既存の状態を置き換える場合は、`stateId` に状態の関係ID（`material.states[].relation.id`）を指定します。着脱可能な物を付けるときは `attachedItemId` を指定できます。場所の効果を後の移動に反映させるときは `affectsMovement` を指定します。たとえば広場に霧を作る申請は広場に対して1 SPです。霧を後の移動条件として読んでも、術者への追加課金はありません。

対象を調べて結果を得るには `apply` の `observe` を使います。`targetId` に対象、`text` に何を知りたいかと調べ方を書きます。別の同席者が調べる場合は `observerId` を指定し、その人の承認を得ます。対象が操作担当のいる人物なら、必要な受領を経て観察結果が確定します。新しいダイス判定には1 SPを使います。

確定結果の `observation.id` は後から所見を記録するときに使えます。`apply` の `record-observation` に `observationId` を指定すると、本人に提示された結果が、観察日時と参照ID付きのメモになります。共有先があれば `participants` に人物IDを指定します。記録にSPはかかりません。

本人の基本情報を置き換えるには、まず `search --kind self` で現在の状態を確認します。木の義足から鉄の義足に替える例では、`targetId` に本人の人物ID、`stateId` に木の義足の行の `relation.id` を指定します。`text` は「木の義足を外して鉄の義足に替える」、`description` は「鉄の義足を使っている」です。

`oppose` には同席する相手の `targetId`、行為の `text`、成功時に外から観察できる `description` を指定します。相手の状態を置き換える案なら、関係IDを `replacesStateId` に指定します。相手の品を奪う場合は `seize` の `operation` に、相手を `from`、本人を `to` とした `move` を入れます。非戦闘地域の扱いは [死亡・怪我・治療](health.md) を参照してください。

現在地の物品を壊すなどして取り除く場合は、`remove-place-item` に場所の `placeId`、そこに直接置かれた物の `itemId`、行為の `text` を指定します。個数の一部だけを除く場合は `count` を指定します。登録保管先は対象外です。ダイスに成功して物がなくなった場合は、GMが選んだ場所の説明も同じ確定で更新します。

### 現在の状態を終了する

新しい状態を付けずに終えるには `operation` に `end` を指定し、同じ `targetId` の現在の状態を `endStateIds` に1件以上入れます。本人の状態を整理するときは `search --kind self` で `material.states[].relation.id` を確認してください。`text` には状態を終える行為や経緯を書きます。`description` は任意で、指定すると経緯の補足として履歴に残ります。

```json
{
  "command": "apply",
  "expectedSp": 1,
  "action": {
    "type": "state",
    "operation": "end",
    "targetId": "本人のID",
    "text": "休息を終え、解消した疲労と息切れの状態を終える",
    "endStateIds": ["疲労の関係ID", "息切れの関係ID"]
  },
  "dependencies": []
}
```

申請が成立すると、指定した状態がすべて終了します。新しい出目を保存する申請は、件数にかかわらず1 SPです。過去の申請の説明が現在の状態に残っている場合も、同じ方法で終了できます。本人の状態が外れたことは `search --kind self` で確認できます。

## 新しい場所

探索は `explore` で申請します。接続元と呼び名を指定します。既知の場所との同一性や、道と場所の説明は探索の判定で扱います。探索が成功すると、GMが判断した村などの系統に新しい場所を結び付けます。初めての系統はその場で作成します。系統名は `outcome.setting.explored.placeSeries` で確認できます。

## 店・設置保管先・抽選器

設置保管先の掲示と受け渡し、店の公開交換は [持ち物・保管・取引](inventory.md)、設計図による建築等は [テンプレート・設計図・クエスト](blueprints.md) を参照してください。抽選器の操作は [抽選器で遊ぶ](draw.md) を参照してください。
