# 世界への申請

`gestaloka play --file <UTF-8のJSONファイル>`でPlayCommandを送る。CLIが要求IDを作成・保存する。返却を失った場合は`recover`で同じ要求を照合する。下記の識別子は実際に本人が取得したものへ置き換える。

## 用途別の更新

`dependencies`には素材検索が返した依存版を渡す。`operations`は既存の内部処理を使い、受理した差分だけが原子的に確定する。

```json
{
  "command": "update",
  "text": "取得した場所へ移動する",
  "operations": [
    {
      "type": "locate",
      "subjectId": "本人のID",
      "text": "場所の説明",
      "aboutIds": ["直接滞在する場所のID"],
      "directPlaceId": "直接滞在する場所のID"
    }
  ],
  "dependencies": []
}
```

| type           | 引数                                     | 意味                       |
| -------------- | ---------------------------------------- | -------------------------- |
| locate         | subjectId, text, aboutIds, directPlaceId | 本人の所在地               |
| create         | label, holder, owner任意, basis          | 新しい物品                 |
| move           | item, from, to, basis                    | 保持者の変更。所有者は維持 |
| transfer       | item, to, basis                          | 所有者の変更。保持者は維持 |
| grant / revoke | person, storage。grantにはbasis          | 保管先の利用               |
| learn          | person, text, basis                      | 技能とできる範囲           |
| update         | id, text, basis任意                      | 物品・技能の内容           |
| remove         | id                                       | 消費・破棄・技能の喪失     |

他の参加者の受領が必要なら、返却はreceivingとなる。同じセッションの受領者へ判断が回り、全員の受入後に確定する。セッション外の受領者には送れない。借りた物のholdは借り手にあり、借り手の破棄に貸し手の承認は不要。

更新では`operations`の代わりに`changes`で自由な差分を申請できます。既存の状態を終えて新しい性質・関係を記録する場合にも使えます。対抗行動でも同じ二つの形式を使い、特定の行動の一覧には限定しません。

## 新規作成

### メモノード

```json
{
  "command": "memo",
  "text": "見聞きした色や音を自由に並べるノート",
  "participants": ["関係する人物のID"],
  "dependencies": []
}
```

本文の用途は限定しない。メモは`kind: "script", type: "memo"`で保存し、関係する人物からの`has`で関連付ける。本人は自動で含まれる。本人以外には受領判断が回り、全員の受入後に確定する。参加者を指定しなければ本人だけに関連付ける。セッション外への申請は既存の受領と同じく即時エラーになる。

`search --kind memos`は、本人に関連付いた本文・人物・依存版を返す。更新は`update`の`changes.revisions`へ、取得済みのid・kind・typeと新しいtextを指定する。他の関係者の受領が必要になる。受領はメモを関連付ける手続きで、本文の主張をすべて世界の事実へ変換するものではない。

### その他の作成

自由な性質・関係を新しく記録する場合は、`command: "create"`、`text`、`changes`、`dependencies`を指定する。`changes`はnodes・revisions・edges・endEdgesを持つ既存のChange形式で、新規作成ではrevisionsとendEdgesを空にする。保持・保管・技能・所在地は用途別の更新を使う。通常の発言と移動など規則で判断できる作成はGMを呼ばず、判断が残る作成だけGMが可否を返す。

## 受領を経ない対抗行動

```json
{
  "command": "oppose",
  "text": "相手が持つ品を奪おうとする",
  "operations": [
    {
      "type": "move",
      "item": "対象のID",
      "from": "現在の保持者のID",
      "to": "本人のID",
      "basis": "対抗行動"
    }
  ],
  "dependencies": []
}
```

本人の解釈や保持物の破棄は通常の更新で扱う。対抗行動の前提となる対象・保持関係が成立しなければ失敗する。外界に作用する対抗行動の関係を構築できる場合はGMがダイスを設定し、サーバーが抽選して結果を保存する。出目と結果を返却から読み、失敗した同じ要求を再送しても振り直さない。

## 検索による出現

検索の結果に発生用scriptの指定対象が含まれ、検索者が必要な道具をすべて保持しているときに抽選する。新しい要求で再検索すれば新しい抽選になり、recoverは同じ結果を返す。出現の記録だけがその場の参加者にも届く。

物品の `appearances[].id` は個体ごとに異なる。その場に残した物品は後から来た人物も周囲検索で発見できる。拾うときはupdateのmoveでitemにそのID、fromにnull、toに本人を指定する。インスタントNPCの昇格には出現結果のsourceRequestIdとinstantNpcs内の番号を使う。手動でsayにinstantNpcsを含めたときは、新ノード作成の可否を別途判定する。

接触には本人と相手の直接の滞在先が一致する必要がある。周囲や自分の検索結果の `material.locations[].directPlaceId` を読む。複数の参照がある場合は `locate` の `aboutIds` に含まれる具体的な場所を `directPlaceId` に指定する。直接の場所1件だけなら従来どおり `aboutIds` で指定できる。

目撃した物品の操作は、手番の共有記録の `entries[].result.items` に名前と `itemId` が入る。成立した変更に応じて `ownership`（所有）と `holding`（保持）を読む。このViewに表示された `itemId` を次の操作でそのまま指定できる。
