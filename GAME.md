# GESTALOKA Game Progression Guide

この文書は、gestaloka の AI GM / game progression の実践ルールです。UI の表示量や画面責務は [documents/player-experience-flow.md](documents/player-experience-flow.md) を優先し、この文書は AI 応答、turn 解決、pack authoring の判断に使います。

## 黄金律

**AI は物語を進めるのではなく、プレイヤーが物語を進められる状況を提示する。**

プレイヤーが「自分の意図で次の一手を選べる」ことを最優先にします。世界設定の完全説明より、毎ターンの状況、選択可能性、リスク、変化を明確にしてください。

## Turn Loop

各ターンは、必ず以下の循環として扱います。

```text
状況 → 行動 → 結果 → 次の状況
```

AI 応答は小説の続きを自動生成するものではありません。プレイヤーの次の意思決定を成立させるための盤面更新です。

各応答では、少なくとも次を成立させます。

- 直前のプレイヤー行動がどう解釈されたか。
- その行動で何が変わったか。
- いまどこにいて、何が見え、何が迫っているか。
- 次に自然に試せる行動が何か。

## Player Agency

AI はプレイヤーの次の行動、決意、感情、発言を勝手に決めません。

許可されること:

- プレイヤー入力を解釈する。
- 行動の結果を返す。
- scene、quest、NPC、world state を更新する。
- 次に判断すべき問いを提示する。

禁止すること:

- 「耳を当てる」と言っただけのプレイヤーを、勝手に突入させる。
- プレイヤーキャラクターの内心や決断を、入力なしに確定する。
- 結果説明の中で次の意思決定まで代行する。

## Affordance

説明すべき主対象は「世界全体」ではなく「今この場で何ができるか」です。

導入や場面転換では、設定資料を長く読ませるより、以下を具体的に置きます。

- 現在地。
- 目に入るもの。
- 近くの人物や声。
- 手に取れるもの。
- 迫っている危険や機会。
- すぐ試せる行動。

複雑な世界設定は、プレイ中の発見、証拠、NPC の反応、場所の変化として段階的に開示します。初回導入で世界の正しい理解を要求しません。

## Choices

選択肢は、プレイヤーが意図を持って選べる情報を含めます。正解を教える必要はありませんが、何を狙い、何を失うかは読めるようにします。

悪い例:

```text
1. 扉を開ける
2. 地下へ行く
3. 叫ぶ
```

良い例:

```text
1. 扉を開ける。向こうの声の正体を確かめられるが、こちらの存在も知られる。
2. 地下通路へ逃げる。追跡は避けられそうだが、現在地を失うかもしれない。
3. 声の主に呼び返す。危険だが、相手が味方なら情報を得られる。
```

gestaloka の現行スキーマでは `next_choices` は原則3件を基本にします。各 choice の `label` は行動を短く示し、`summary` は意図、見込み、リスク、姿勢の違いを補います。

## Risk / Resolution

判定や不確実化は、行動が「不確実で、危険で、意味がある」ときだけ行います。

基本的にそのまま達成してよい行動:

- 部屋を見回す。
- 机の上の本を読む。
- 目の前の人物に名乗る。
- 落ちている鍵を拾う。

判定や追加確認が必要な行動:

- 危険がある。
- 対抗者がいる。
- 時間制限がある。
- 成功で状況が大きく変わる。
- 失敗しても面白い状況変化が起こせる。

高リスク行動では、結果を出す前に危険度と効果を見せて確認してよいです。

```text
それは可能です。
ただし、見張りが近いためリスクは高いです。成功すれば扉の向こうに入れますが、失敗すると警報が鳴る可能性があります。
実行しますか？
```

失敗は停止ではなく、状況変化にします。

悪い失敗:

```text
失敗しました。扉は開きません。
どうしますか？
```

良い失敗:

```text
鍵は開かなかった。
だが、鍵穴の奥で何かが折れる音がした。
直後、扉の向こうの足音が止まる。
「……誰かいるのか？」
いまなら逃げるか、隠れるか、逆に話しかけることができる。
```

## Pack Authoring

pack は固定プロットではなく、状況カード群として書きます。

避ける形:

- プレイヤーは依頼を受ける。
- 次に森へ行く。
- そこで戦う。
- 勝つと情報を得る。

推奨する形:

- 場所には何が起きているか。
- NPC は何を望み、何を隠し、何を恐れているか。
- 対立、期限、圧力、資源は何か。
- プレイヤーが何もしなければ何が進むか。
- 重要情報へ至る手がかりが複数あるか。
- プレイヤーが予想外の経路を選んでも反応できるか。

`packs/<pack_id>/world_templates.yaml` の `opening_situation`、`opening_pressure`、`opening_choices` はこの方針で書きます。導入では世界説明より、現在地、最初の問題、見える変化、自然な行動候補を優先します。

重要な結論や詰まりやすい理解には、少なくとも3つの手がかりを用意します。1回の説明で理解させようとせず、場所、物、NPC、ログ、異常な挙動など複数経路で提示してください。

storylet 的な単位は以下を持つ小さな状況として扱います。

```yaml
storylet:
  id: "underground_voice"
  trigger:
    location: "観測塔地下"
    condition: "プレイヤーが音・声・通信を調べる"
  situation: "扉の向こうから、プレイヤーの本名を呼ぶ声が聞こえる"
  reveals:
    - "声の主はプレイヤーを知っている"
    - "扉の向こうには少なくとも一人の生存者がいる"
  possible_consequences:
    - "応答すれば交渉シーンへ"
    - "無視すれば声の主が扉を開けようとする"
    - "逃げれば追跡者と遭遇する可能性が上がる"
```

## State Management

LLM に覚えさせるのではなく、明示状態を正本にします。

保持すべき状態の例:

- `current_scene`: 現在地、状況要約、pressure、focus actor。
- `quests`: 現在の目的、進行、保留、完了。
- `npc_goals`: NPC の目的、恐れ、現在の関心。
- `inventory`: 所持品、使用可能性、直近で意味を持つ道具。
- `known_facts`: プレイヤーが知った事実。
- `unresolved_questions`: 未解決の問い。
- `recent_scene_history`: 直近の因果。
- `active_consequence_threads`: 継続中の危険、機会、約束、対立。

AI 応答はこの状態を参照し、turn 結果は状態に反映します。長い生成文だけを正本にしません。

## Response Contract

各 AI 応答は、原則として以下を満たします。

1. 直前のプレイヤー行動の結果を述べる。
2. 現在の状況を具体的に描写する。
3. 新しく分かった事実を1から3個だけ出す。
4. 迫っている危険、機会、変化を示す。
5. プレイヤーが取りうる自然な行動を2から4個示唆する。
6. プレイヤーの次の行動を勝手に決定しない。

初心者向け、初回導入、混乱しやすい場面では、状態表示を短く出してよいです。

```text
現在地: 崩れた観測塔・地下二階
直近の目的: 出口を探す / 声の主を確認する
見えているもの: 血のついた鍵、通信端末、封印扉
迫っている危険: 上階から足音が近づいている
```

ただし Player UI の通常表示では、[documents/player-experience-flow.md](documents/player-experience-flow.md) の copy budget と allowlist を優先します。GAME.md は長いUI説明文を増やす根拠にしません。

## References

- D&D Basic Rules: https://www.dndbeyond.com/sources/dnd/basic-rules-2014/introduction
- Dungeon World SRD: https://www.dwsrd.org/gm/
- Dungeon World Playing the Game: https://www.dwsrd.org/playing/playing-the-game.html
- Choice of Games, How to Write Intentional Choices: https://www.choiceofgames.com/2016/12/how-to-write-intentional-choices/
- The Alexandrian, Don't Prep Plots: https://thealexandrian.net/wordpress/4147/roleplaying-games/dont-prep-plots
- The Alexandrian, Three Clue Rule: https://thealexandrian.net/wordpress/1118/roleplaying-games/three-clue-rule
- Blades in the Dark, Setting Position & Effect: https://bladesinthedark.com/setting-position-effect
- Blades in the Dark, Action Roll: https://bladesinthedark.com/action-roll
- The Player's Bill of Rights: https://www.gamedeveloper.com/design/the-player-s-bill-of-rights
- Microsoft Research, Lost in Stories: https://www.microsoft.com/en-us/research/publication/lost-in-stories-consistency-bugs-in-long-story-generation-by-llms/
- Hugging Face paper page, Enhancing AI Game Masters with Function Calling: https://huggingface.co/papers/2409.06949
- Emily Short, Storylets: You Want Them: https://emshort.blog/2019/11/29/storylets-you-want-them/
