# **ゲスタロカ：ログシステム仕様**

最終更新: 2025-07-04

## **1\. 概要**

「ログ」はゲスタロカの中核システムです。プレイヤーの行動や経験が「ログの欠片（フラグメント）」として記録され、それらを編纂することで独立したNPCエンティティを創造できます。創造されたログは世界を旅し、他のプレイヤーの物語に影響を与える存在となります。

## **2\. ログの本質**

### **2.1. ログとは何か**
ログは単なるデータの集合体ではなく、プレイヤーの経験と意図から生まれる「独立した存在」です。編纂されたログは：
- 独自の人格と行動原理を持つ
- 創造主から独立して世界を旅する
- 他のプレイヤーの物語に有機的に関わる
- 経験を通じて成長し変化する

### **2.2. ログの独立性**
重要な点として、ログは「契約」や「取引」の対象ではありません。創造主はログに目的を与えて送り出しますが、その後のログの行動は完全に独立しています。これにより：
- より自然で予測不能な物語が生まれる
- プレイヤー間の間接的な交流が実現する
- 各ログが唯一無二の存在となる

## **3\. 主要なゲームメカニクス**

### **3.1. ログの欠片（Log Fragments）**

* **概要:** プレイヤーの冒険における重要な瞬間や達成が「ログの欠片（記憶フラグメント）」として結晶化される。これらは**ゲーム体験の記念碑**として永続的に保持され、使用しても消費されない。
* **新しい位置づけ:**
  * 単なる素材ではなく、プレイヤーの物語の記念碑
  * 一度獲得したら永久に保持（使用しても消えない）
  * 各フラグメントが独自の物語的コンテキストを持つ
* **生成タイミング:**  
  * **動的クエストの完了時**: GM AIが物語の完結を判定し、クエストをサマライズして生成
  * **アチーブメント達成時**: 初回到達、スキル習熟、累積的達成など
  * **特別な瞬間**: 予期せぬ出来事、他プレイヤーのログとの深い関わり
  * **世界の真実の発見**: アーキテクトレアリティの獲得条件
* **欠片の属性:** 各「欠片」には、以下のような属性が付与される。  
  * **キーワード:** 場所タイプとレアリティに応じた日本語キーワード（125種類以上）
    * 例: \[街の喧騒\], \[王の陰謀\], \[暗闇の恐怖\], \[世界樹の葉\], \[アカシックレコード\]など
  * **感情価:** ポジティブ / ネガティブ / ニュートラル / ミックス（危険度に応じて動的決定）
  * **レアリティ:** コモン、アンコモン、レア、エピック、レジェンダリー、ユニーク、アーキテクト
    * 達成難易度、物語の独自性、創造的な解決方法によって決定
    * アーキテクトは世界の根源的真実の発見時に獲得
  * **バックストーリー:** フラグメントの由来を説明する物語的テキスト（200-500文字）
  * **永続性:** 一度獲得したフラグメントは使用しても消費されない

### **3.2. ログの編纂（Log Weaving）**

* **概要:** プレイヤーは、拠点となる場所（例：自室の書斎、記憶の祭壇）で、集めた「ログの欠片」を組み合わせて一つの\*\*「完成ログ（NPC）」\*\*を創り上げる。  
* **編纂プロセス:**  
  1. \*\*核となる欠片（コア・フラグメント）\*\*を一つ選ぶ。これが、生成されるログの基本的な性格や行動原理を決定する。  
  2. 複数の\*\*補助的な欠片（サブ・フラグメント）\*\*を追加する。これにより、ログに深みや特定のスキル、知識を付与できる。  
  3. 組み合わせる「欠片」のキーワードや感情価の組み合わせによって、**コンボボーナス**や**特殊な称号**が発生する。  
     * 例：\[勇敢\] \+ \[自己犠牲\] \-\> 称号\[英雄\]  
     * 例：\[探索\] \+ \[錬金術\] \-\> スキル\[フィールドワーク\]
  4. **記憶継承システム:** フラグメントは使用しても消費されず、SP消費により以下が可能：
     * スキル継承（20-50 SP）
     * 称号獲得（30-100 SP）
     * ログ強化（派遣費用+追加SP）
     * アーキテクト記憶による特別な効果  
* **戦略性:** どのようなログを創りたいか（戦闘特化、情報収集、商人など）によって、どの「欠片」を集め、どう組み合わせるかという戦略が生まれる。

#### **3.2.1. 高度な編纂メカニクス（2025-01-04実装）**

* **コンボボーナスシステム:**
  * **記憶タイプの組み合わせ:**
    * 勇気 + 犠牲 → 特殊称号「英雄的犠牲者」
    * 知恵 + 真実 → パワー20%強化
    * 友情 + 勝利 → SP消費20%削減
    * 光 + 闇 → 汚染50%浄化
    * レジェンダリー×2 → 特殊称号「伝説の編纂者」
  * **キーワードの組み合わせ:**
    * \[光\] + \[闇\] → 「均衡の力」（汚染浄化ボーナス）
    * \[古代\] + \[知識\] → 「古の叡智」（知識系スキル強化）
    * \[勇気\] + \[守護\] → 「守護者の誓い」（防御力強化）
  * **ボーナスの種類:**
    * SP消費削減（10-30%）
    * パワーブースト（10-50%）
    * スキル強化
    * 特殊称号獲得
    * 汚染浄化
    * レアリティ昇格
    * 記憶共鳴（特定の記憶との相性強化）

* **SP消費計算:**
  * **基本コスト（レアリティ別）:**
    * コモン: 10 SP
    * アンコモン: 20 SP
    * レア: 50 SP
    * エピック: 100 SP
    * レジェンダリー: 200 SP
    * ユニーク/アーキテクト: 300 SP（+50%追加）
  * **追加コスト:**
    * 4つ以上のフラグメント使用: +20 SP/個
    * 汚染度50%以上: +50 SP
    * 特殊称号獲得時: +100 SP
  * **コスト削減:**
    * コンボボーナスによる削減
    * キャラクター特性による削減
    * イベント期間中の特別割引

### **3.3. ログの汚染と浄化（Log Corruption & Purification）**

* **概要:** 混沌AIの影響や、ネガティブな感情価を持つ「欠片」を多用することで、編纂中のログが\*\*「汚染」\*\*されることがある。  
* **汚染されたログ:**  
  * 予期せぬ行動を取ったり、暴走しやすくなったりする。  
  * 強力だが制御不能なスキルを持つことがある。  
  * 見た目や言動が不気味になる。  
* **浄化:**  
  * ポジティブな感情価を持つ「欠片」を使って汚染度を下げることができる。  
  * 特定のクエストをクリアしたり、希少なアイテムを使用したりすることで「浄化」できる。  
* **ゲーム性:** プレイヤーは「汚染」のリスクを冒して強力なログを創るか、安定したログを目指すかの選択を迫られる。

#### **3.3.1. 浄化メカニクスの詳細（2025-07-04実装）**

* **浄化アイテムシステム:**
  * **聖水（Holy Water）:**
    * 効果: 汚染度10%減少
    * コスト: 10 SP
    * 入手: 一般的な浄化アイテム
  * **光のクリスタル（Crystal of Light）:**
    * 効果: 汚染度20%減少
    * コスト: 30 SP
    * 入手: ポジティブフラグメント3つから生成可能
  * **浄化の書（Tome of Purification）:**
    * 効果: 汚染度30%減少
    * コスト: 50 SP
    * 特殊効果: 浄化時に新しい特性を付与
  * **天使の涙（Angel's Tear）:**
    * 効果: 汚染度50%減少
    * コスト: 100 SP
    * 特殊効果: 完全浄化時にパワー+30%
  * **世界樹の葉（World Tree Leaf）:**
    * 効果: 汚染度70%減少
    * コスト: 200 SP
    * 特殊効果: アーキテクト記憶との相性強化

* **浄化による特性変化:**
  * **部分浄化（汚染度50%以下）:**
    * 新しい特性: 「清らか」「純粋」「光の加護」
    * 暴走リスクの減少
    * 制御性の向上
  * **完全浄化（汚染度0%）:**
    * 特殊称号: 「聖なる守護者」「光の使徒」
    * パワー50%強化
    * 全ての負の特性を除去
  * **汚染反転（ネガティブ→ポジティブ）:**
    * 特殊称号: 「闇から光へ」
    * 元の汚染特性を反転させた強力な効果
    * 例: 「破壊衝動」→「創造の意志」

* **浄化アイテムの生成:**
  * **フラグメントからの生成:**
    * ポジティブフラグメント3つ以上で生成可能
    * 90%以上ポジティブ → 光のクリスタル
    * 70%以上ポジティブ → 聖水
  * **クエスト報酬:**
    * 浄化関連クエストの完了
    * 聖地での特別イベント
  * **SP購入:**
    * ショップで直接購入可能
    * イベント期間中は割引あり

### **3.4. ログ派遣（Log Dispatch）**

* **概要:** プレイヤーが創り出した「完成ログ」を、世界へと送り出すシステム。  
* **派遣設定:**  
  * **行動目的:** 探索、交流、収集、護衛、自由行動などから選択し、詳細を記述  
  * **初期地点:** プレイヤーが訪れたことのある場所から選択  
  * **派遣期間:** 1日から30日まで設定可能（SP消費量に影響）  
  * **行動指針:** 「困っている人を見かけたら助ける」「特定のキーワードを持つ人物を探す」など、大まかな行動指針を設定できる。  
* **SP消費:** 
  * **基本コスト:** ログの派遣には**50 SP**が必要（固定）
  * **追加コスト:** 派遣期間や特殊な目的設定により追加SPが必要になる場合がある
  * **コスト還元:** 派遣目的を達成した場合、消費SPの一部（最大20%）が還元される
* **帰還と報告:** 派遣期間終了後、ログは創造主の元へ帰還し、旅の成果と物語を報告する。

### **3.5. ログ遭遇システム（Log Encounter）**

* **概要:** 他のプレイヤーが派遣したログと、冒険中に遭遇する動的システム。
* **基本遭遇確率:** 
  * **基本値:** 30%（各場所移動時）
  * **調整要素:**
    * **場所タイプ:** 街（+10%）、ダンジョン（-5%）、荒野（+5%）
    * **時間帯:** 深夜（-10%）、早朝（+5%）、夕方（+15%）
    * **レベル差:** 適正レベル（+10%）、大きな差（-20%）
    * **エリア密度:** 派遣ログが多いエリア（最大+20%）
* **複数遭遇:**
  * **同時遭遇数:** 最大3体まで
  * **確率:** 1体（70%）、2体（25%）、3体（5%）
  * **グループ行動:** 複数のログが協力して行動することもある
* **遭遇時の行動パターン:**
  * **友好的:** 会話、情報提供、一時的な同行（40%）
  * **中立的:** 単なる挨拶、すれ違い（30%）
  * **取引的:** アイテム交換、クエスト提供（20%）
  * **敵対的:** 戦闘、妨害（10%）※汚染されたログは確率上昇
* **アイテム交換システム:**
  * **交換可能アイテム:** ログの欠片、消耗品、情報
  * **交換レート:** ログの性格と関係性により変動
  * **特殊交換:** レアなログは特別なアイテムを所持していることがある
* **遭遇後の影響:**
  * **関係性構築:** 好感度により再遭遇時の行動が変化
  * **情報伝播:** ログが他のログに情報を伝える
  * **評判システム:** プレイヤーの行動がログネットワークで共有される

## **4\. SPシステム（Story Points）**

### **4.1. SPとは**
SP（ストーリーポイント）は「行動力」として表現される基本リソースですが、その本質は「世界への干渉力」です。LLM APIの使用コストを抽象化し、ゲーム内リソースとして表現することで、持続可能な運営を実現します。

### **4.2. SPの用途**
- **行動宣言:** 自由入力での行動（1-5 SP）
- **ログ派遣:** 期間と目的に応じて（10-300 SP）
- **特殊能力:** ログへの追加スキル付与
- **緊急召還:** 派遣中のログの即時帰還

### **4.3. SPの入手**
- **自然回復:** 
  - **基本回復:** 1日10 SP（無料プレイヤー）
  - **サブスクリプションボーナス:** 
    - ブロンズ会員: +5 SP/日（計15 SP）
    - シルバー会員: +10 SP/日（計20 SP）
    - ゴールド会員: +20 SP/日（計30 SP）
  - **回復タイミング:** 毎日AM 1:00（日本時間）に自動回復
- **購入:** 100 SP = ¥500から
- **報酬:** ログの成果や特別イベント

## **5\. 具体的なプレイ例**

1. プレイヤーAは、とあるダンジョンの最奥で強力なボスを倒し、レジェンダリー等級の\*\*\[勇敢な討伐\]\*\*という「ログの欠片」を手に入れる。  
2. プレイヤーAは、この欠片をコアに据え、これまでの冒険で集めた\[剣術\] \[探索\] \[仲間との絆\]といった補助的な欠片を組み合わせて、戦闘能力の高い「ログ」の編纂を始める。  
3. 編纂中、過去の失敗から得たネガティブな欠片\[友の死\]を加えるか迷う。加えることでログはより強くなるかもしれないが、「汚染」のリスクが高まるからだ。  
4. 最終的に、安定した英雄的なログを創ることを選び、\[友の死\]の代わりに\[守護の誓い\]という欠片を使い、\*\*称号\[聖騎士\]\*\*を持つ「完成ログ」を創り上げる。  
5. プレイヤーAは50 SPを消費し、そのログに「初心者を助けること」を目的として7日間の派遣を設定。初期地点を「始まりの街」に設定して送り出す。  
6. 7日後、ログが帰還。「3人の初心者を危機から救い、1人とは友人になった」という報告と共に、獲得した報酬と新たな「ログの欠片」を持ち帰る。さらに、目的達成により10 SP（20%）が還元される。

## **6. システムの特徴**

### **6.1. 非同期的な交流**
ログシステムにより、プレイヤーは直接的に同じ時間にプレイしていなくても、お互いの世界に影響を与え合うことができます。これは時差や生活リズムの異なるプレイヤー同士でも豊かな交流を可能にします。

### **6.2. 永続的な影響**
プレイヤーが創造したログは、そのプレイヤーがゲームにログインしていない間も世界で活動を続けます。これにより、ゲーム世界は常に動的で生きたものとなります。

### **6.3. 創造的なゲームプレイ**
ログの編纂と派遣は、単なる戦闘や探索を超えた創造的なゲームプレイを提供します。プレイヤーは「物語の作者」としての役割も楽しむことができます。

詳細な派遣システムについては[ログ派遣システム仕様](logDispatchSystem.md)を参照してください。