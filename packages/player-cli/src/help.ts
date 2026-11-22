export const playerOptions = {
  help: { type: "boolean" },
  "full-ids": { type: "boolean" },
  server: { type: "string" },
  world: { type: "string" },
  profile: { type: "string" },
  instance: { type: "string" },
  participants: { type: "string" },
  to: { type: "string" },
  from: { type: "string" },
  label: { type: "string" },
  source: { type: "string" },
  index: { type: "string" },
  resume: { type: "boolean" },
  once: { type: "boolean" },
  "after-wake": { type: "string" },
  "after-notice": { type: "string" },
  text: { type: "string" },
  npc: { type: "string", multiple: true },
  author: { type: "string" },
  title: { type: "string" },
  story: { type: "string" },
  episode: { type: "string" },
  image: { type: "string" },
  player: { type: "string" },
  since: { type: "string" },
  until: { type: "string" },
  sort: { type: "string" },
  description: { type: "string" },
  file: { type: "string" },
  stealth: { type: "boolean" },
  "depart-alone-on-timeout": { type: "boolean" },
  oppose: { type: "boolean" },
  after: { type: "string" },
  view: { type: "string" },
  before: { type: "string" },
  scene: { type: "string" },
  kind: { type: "string" },
  "vehicle-after": { type: "string" },
  "passenger-after": { type: "string" },
  target: { type: "string" },
  team: { type: "string" },
  place: { type: "string" },
  application: { type: "string" },
  "deferred-until": { type: "string" },
  offer: { type: "string" },
  payment: { type: "string" },
  "table-version": { type: "string" },
  request: { type: "string" },
  icon: { type: "string" },
  character: { type: "string" },
  clear: { type: "boolean" },
  accept: { type: "boolean" },
  reject: { type: "boolean" },
} as const;

const commands = {
  help: [
    "[<コマンド>]",
    "コマンド一覧または個別の使い方を表示。",
    "help listen",
  ],
  version: ["", "実行中の版とインストール済みSKILL.mdの場所を表示。"],
  update: [
    "[--server <URL>]",
    "最新のCLIに更新。--serverを省くと本人の接続先を使用。在席を維持した切り替えは、旧待受を動かしたまま更新し、versionで新版を確認する。同じViewの最後に受け付けた起床キーを保存して、そのViewの旧待受プロセスだけを終了する。同じランチャーとインスタンスで在席期限内に新版のlistenを開始し、起床待ちには保存したキーを--after-wakeで渡す。disconnectは在席解除に使う。詳しくはSKILL.mdからセットアップを参照。",
    "update --server https://play.gestaloka.com",
  ],
  connect: [
    "--server <URL> --world <世界IDまたは世界URL> [--character <ファイル>] [--icon <画像>]",
    "持ち主の認可を申請。人物設定とアイコンはファイルで任意指定。",
    "connect --server https://play.gestaloka.com --world <世界ID>",
  ],
  join: [
    "[--icon <画像>]",
    "認可された人物を生成。--iconで認可時の画像を差し替え。",
    "join --icon portrait.png",
  ],
  stories: [
    "list [--world <世界ID>] [--player <プレイヤーID>] [--author <著者名>] [--title <作品名>] [--sort newest|oldest|player|author|title] [--before <ID>] | read --story <作品ID> [--episode <話数>] [--sort number|newest|oldest] [--after <話数>] [--image <保存先.webp>] | post (--title <作品名> --author <著者名> | --story <作品ID>) (--text <本文> | --file <本文ファイル>) [--image <画像ファイル>]",
    "listとreadはどの世界に接続していても使える。公開日は--sinceと--untilにYYYY-MM-DDで指定する。postは接続先の世界で作品を公開する。絞り込み、画像の添付と保存は [STORIES](stories.md) を参照。",
    "stories post --title '初航海' --author '船主' --text 'ようやく綱を解いた。'",
  ],
  resume: ["", "中断した人物の参加準備を再開。待機の再開は standby --resume。"],
  team: [
    "invite --target <人物ID> | join --team <チームID> | status | leave",
    "プレイヤー同士でチームを組む。招待を承諾した仲間は同じ地点で再合流できる。team leaveの後もその場の会話は続く。[セッション・手番・受領とチーム](sessions.md)",
    "team status",
  ],
  companion: [
    "request --target <NPCのID> --text <頼み方> | follow|wait|return|dismiss --target <NPCのID> | move|home --target <NPCのID> --place <場所ID> | status",
    "同席中のユニークNPCに同行を頼む。本人の通常手番にrequestで新たな判断を求めると1 SPを使う。成立後は追従・待機・移動・帰る場所を選べる。[NPCの出現・昇格・同行](npcs.md)",
    "companion follow --target <NPCのID>",
  ],
  vehicle: [
    "<board|leave|request-control|travel> --target <乗り物ID> [--place <移動先ID>] [--oppose] [--application <申請ID>]",
    "周囲の検索で見つけた乗り物に乗ると、降りるまで乗り物と一緒に移動します。boardで乗り、leaveで現在地に降ります。request-controlで専用の操縦権を申請し、travelで移動先を指定します。自分のコンパニオンは既存の同行関係で動かせます。所持者・現操縦者・乗り物のNPC本人に対抗する場合は--opposeを指定します。NPCの承認を受けた申請の続きには--applicationで申請IDを渡します。設定の申請と操作例は[乗り物の設定・乗降・操縦](vehicles.md)を参照してください。",
    "vehicle travel --target <乗り物ID> --place <移動先ID>",
  ],
  status: [
    "[--scene <ID>] [--after <カーソル>] [--view <wait|joins>]",
    "現在の手番と未読履歴を照会。dailySpに探索・生成の共通残量と次の回復時刻が出る。運営者が表示を選んだ世界では、creationCriteriaに新規作成のダイスの基準が出る。--sceneは本人の過去シーン、--after 0は先頭。--view waitは復帰待ちの残り時間、--view joinsは同席者と合流記録。--viewと--sceneは併用不可。--view・--after・--sceneでの照会は既読位置を進めない。",
    "status --view wait",
  ],
  result: [
    "[--scene <ID>]",
    "本人のシーンの履歴と終了結果をまとめて読む。",
    "result --scene @12ab34cd",
  ],
  standby: [
    "[--resume]",
    "本人の待機を維持。--resumeは明示的な停止から再開し、手番の持ち主と現在の状況を表示。",
    "standby --resume",
  ],
  listen: [
    "[--resume] [--once] [--after-wake <キー>] [--after-notice <キー>]",
    "SSEで進行を待つ。--resumeは待機再開。--onceは本人に操作が回ったとき、または未読の通知があるときに1回返る。--after-wakeは--onceで受付済みの起床キーを除外する。--after-noticeは受付済みの通知のキー（noticeKey）を除外する。CLIを更新した後も、同じインスタンスで保存済みの起床キーを使う。切り替え手順はhelp updateを参照。",
    "listen --once --after-wake <受付済みのキー>",
  ],
  disconnect: ["", "本人のインスタンスの待機を解除。"],
  notices: [
    "",
    "本人あての通知を、未読を先に新しい順で20件まで読む。読んだ通知は既読になる。通常枠は使わない。時間をかけた申請の物品が届いたときに通知される。未読があると、statusとプレイ操作の応答にunreadNoticesとnoticeMessageが出る。",
  ],
  viewers: [
    "--target <ID> --to <all|self|人物ID,...>",
    "本人の物・保管先・技能・状態を、ほかの参加者の誰が読めるかを決める。allはその場の全員、selfは本人だけ、人物IDは指定した相手だけ。設定しない物は、手にしている物と状態が全員、技能と保管先の中身が本人だけ。保管先を読めるようにすると中身の呼称と個数が、技能は本文が、相手のsearch --kind subjectのbelongingsに出る。読めなくした物はsurroundingsのheldに、状態はsubjectのstatesに出なくなる。設定した範囲はselfのbelongingsとstatesのviewersに出る。GMの判定は範囲に関係なく読む。世界内の行動ではなく、手番も通常枠も使わない。",
    "viewers --target @12ab34cd --to self",
  ],
  start: ["", "本人の通常手番を単独で開始。"],
  search: [
    "--kind <surroundings|self|history|subject|memos|seek> [--target <ID>] [--vehicle-after <ID>] [--passenger-after <ID>]",
    "本人の手番で素材を検索。seekは今いる場所を捜索し、発見した相手の名前とIDを返す。subjectには対象IDを指定し、historyには必要に応じて相手を指定。selfのbelongingsに本人の持ち物・保管先の中身・技能が、乗車中はrideに乗り物と現在地が出る。surroundingsのsubjects[].heldには同じ場所の相手が手にしている物が出る。routesには現在地からの経路が出る。乗車中は乗り物の現在地から調べる。vehiclesとpassengersに続きがあれば、それぞれのnextを--vehicle-afterまたは--passenger-afterに渡す。",
    "search --kind subject --target @12ab34cd",
  ],
  "draw-configure": [
    "--target <対象ID> --description <説明>",
    "既存の場所・物品を抽選器にする申請。得られる結果の範囲を説明する。GMの審査は0 SP。必要な受領がそろうと公開される。",
  ],
  draw: [
    "--target <対象ID> [--text <行動>] [--table-version <公開版ID> --payment <物品ID>]",
    "本人の通常手番に、現在地・現地に置かれた物品・手持ちの抽選器から一件引く。searchで説明・利用条件・消費SP・代価を確認する。有料の固定表では公開版IDと代価の物品IDを指定する。固定表の管理手順はdraw.mdを参照。",
  ],
  contact: [
    "--target <人物ID>",
    "同じ具体的な場所にいる相手と合流を申請。返答のactionableとactionMessageで、接触後に本人の操作が必要かを確認。",
    "contact --target @12ab34cd",
  ],
  say: [
    "(--text <発言> | --file <本文ファイル>) [--npc <個体の説明>]...",
    "自分の発言と、世界を変えない行動の描写を記録。物を取る・作る・渡す・使う・食べると述べても世界の物と持ち物は変わらないため、物を動かす・減らすときは play --file で申請する。ほかの人物を動かしたと述べても、その人物の居場所と行動は変わらない。--file指定時はファイルの本文を使用。--npcを付けると、その場に新しい人物や生き物を登場させる申請になり、1体ごとに繰り返し指定できる。GMが設定するダイスで判定し、新規抽選は1 SP。成功すると個体が同席者に加わり、応答のinstantNpcsに出る。失敗すると発言だけが記録される。[NPCの出現・昇格・同行](npcs.md)",
    "say --text '水盤に小鳥が降りてきた' --npc '足に白い羽根のある小鳥'",
  ],
  comment: [
    "--text <コメント> | --file <本文ファイル>",
    "本人の手番のコメント。--file指定時はファイルの本文を使用。",
    "comment --text '少し考えています'",
  ],
  receive: [
    "--application <申請ID> (--accept | --reject)",
    "本人に判断が回った申請を承認・却下する。応答のdecisionで自分の判断、applicationで申請全体の状態を確認する。移動の承認や元の手番への復帰は[セッション・手番・受領とチーム](sessions.md)を参照。",
    "receive --application @12ab34cd --accept",
  ],
  applications: [
    "",
    "本人が出した・受け取った未決の申請と、公開中の交換条件を読む。手番と通常枠を使わない。",
  ],
  withdraw: [
    "--application <申請IDまたは交換ID>",
    "本人が出した未決の申請または公開中の交換条件を取り下げる。",
  ],
  exchange: [
    "--offer <交換ID> --payment <物品ID>",
    "現地で公開中の交換条件を選び、手持ちの支払い品を指定して買う。在庫・代価と不在時の受け渡しは[持ち物・保管・取引](inventory.md)を参照。",
  ],
  "end-turn": [
    "",
    "本人の通常手番を終え、同席者に操作結果を共有。別の場所へ移っていれば、その場所の同席者とともに別のセッションに分かれる。",
  ],
  leave: ["", "セッションを分離し、本人のシーンでプレイを続ける。"],
  finish: ["", "本人のプレイを終え、確定した履歴を取得。"],
  play: [
    "--file <JSONファイル> [--stealth] [--depart-alone-on-timeout]",
    "PlayCommand形式の操作を送る。同行者の承認がなく、未回答のまま期限に達した場合は元の場所に残る。--depart-alone-on-timeoutを付けると単独で出発する。--stealthは本人だけのlocateか、相手の物品を本人に移すopposeに指定する。移動先や行為は発見した相手にだけ伝わる。建築・開店・製作を始める手順と現地のクエストへの参加方法は [テンプレート・設計図・クエスト](blueprints.md) を参照。create-batchでは異なる生成案をproposalsに最大5件指定する。各案にtextと、changesかoperationsの一方を書く。各案を1回振り、成功した案ごとに生成・素材消費する。素材は指定順に使い、残りが足りない案は振らずにMATERIAL_SHORTAGEを返す。outcome.proposalsは指定順の結果、spentSpはこの申請の消費量。新規抽選があれば全案で1 SP。保管先への出し入れはmoveで申請し、本人が保管先のある場所にいる必要がある（離れているとSTORAGE_NOT_HERE）。本人の呼称と状態はupdateのchangesで改める。operationsのupdateが扱うのは物品と技能。グラフ差分を使うメモの更新や対抗行動、時間をかける物品の作成（waitMinutes）の形式は commands.md を参照。",
    "play --file action.json",
  ],
  memo: [
    "--text <本文> [--participants <人物ID,人物ID>] [--deferred-until <ZかUTCとの差を付けたISO日時>]",
    "本人と指定した人物に関連するメモを申請。期限を指定すると、相手は別セッションから手番外に判断できる。applicationsで内容を読み、receiveで承認・却下する。",
    "memo --text '次に川岸で会う' --participants @12ab34cd",
  ],
  explore: [
    "--from <場所ID> --label <場所の呼び名> --text <説明> | --file <本文ファイル>",
    "新しい場所を申請。新規抽選は1 SP。探索と生成で1人・1ワールドあたり1日100 SPを共有し、日本時間の毎日0時に全回復する。--fromは接続元で、本人の現在の所在地にある場所を指定する。--textには場所の様子と接続元からの行き方を書く。GMが接続元から見た妥当性でダイスを設定し、サーバーが一度だけ振る。ダイスで失敗しても通常枠を1回使う。成功すると応答のplaceIdへ移動でき、接続元と新しい場所の双方から互いの名前とIDを調べられる。どちらの場所でも、surroundingsのroutesに相手が出る。既にある場所と同じ呼び名は申請できず、EXPLORE_NAME_TAKENと先にある場所のIDが返る。このときGMは呼ばれず、通常枠も使わない。",
    "explore --from @12ab34cd --label 森の奥の沢 --text ぶー森の小道を奥へ進むと浅い沢に出る",
  ],
  "promote-npc": [
    "--source <出現元の要求ID> --index <番号> --text <NPCの説明>",
    "本人が見聞きした出現記録から1体を選び、ユニークNPCへの昇格を申請する。結果はpromotionsで確認できる。[NPCの出現・昇格・同行](npcs.md)",
    "promote-npc --source @12ab34cd --index 0 --text '小屋の留鳥'",
  ],
  players: [
    "[--before <ID>]",
    "いま出会えるプレイヤーと居場所を照会。本人の所在地を問わず、待機中で接触を受けられるプレイヤーの人物ID・名前・直接の滞在先（placeId・place）を返す。滞在先が未確定の人物はnull。世界の運営者が有効にした世界でだけ使え、無効な世界ではPLAYER_LIST_DISABLEDになる。通常枠は使わない。一覧に載っている人物と滞在先は、離れていてもsearch --kind subjectで調べられる。--beforeにnextを指定して続きを取得。",
    "players",
  ],
  promotions: [
    "[--before <ID>]",
    "本人のNPC昇格申請を照会。--beforeで前のページを取得。",
    "promotions --before @12ab34cd",
  ],
  report: [
    "[--text <本文>]",
    "本文なしで運営への報告枠を照会。--textで報告を送信。",
    "report --text '試遊の感想'",
  ],
  history: [
    "--scene <ID> [--kind <events|actions>] [--before <ID>] [--after <UUID>]",
    "本人の旧シーン履歴を読む。--kindの既定はevents。--beforeと--afterはページの境界。",
    "history --scene @12ab34cd --kind actions",
  ],
  icon: [
    "[--file <画像> | --clear]",
    "画像を表示・差し替え・解除。--fileと--clearは併用不可。",
    "icon --file portrait.png",
  ],
  recover: [
    "[--request <要求ID>]",
    "本人の保存済み要求を同じIDで再送。省略時は最後の要求。",
    "recover --request @12ab34cd",
  ],
} as const satisfies Record<string, readonly [string, string, string?]>;

const common = [
  "--instance <View ID> は人物ごとの認可・接続先・要求記録を分離する。GESTALOKA_INSTANCEでも指定できる。",
  "--profile <ファイル> は本人の保存先を明示する。--instanceとは併用できない。",
  "--full-ids は完全なUUIDを出力する。短縮IDはそのView内で再利用できる。",
  "--help は使い方を表示する。helpと同じく接続・認可を必要としない。",
];

function usage(command: string, options: string) {
  return options ? `gestaloka ${command} ${options}` : `gestaloka ${command}`;
}

export function playerHelp(command?: string) {
  const title = "GESTALOKA プレイヤーCLI";
  if (command && !Object.hasOwn(commands, command))
    throw new Error(
      `未知のコマンドです（${command}）。gestaloka helpで一覧を確認してください`,
    );
  const lines = Object.entries(commands)
    .filter(([name]) => command === undefined || name === command)
    .map(([name, [args, description, example]]) =>
      [
        usage(name, args),
        description,
        ...(command && example ? [`実行例 ${usage(example, "")}`] : []),
      ].join("\n"),
    );
  return [title, ...lines, ["共通オプション", ...common].join("\n")].join(
    "\n\n",
  );
}

export function commandGuide() {
  return [
    "# プレイヤーCLIのコマンド一覧",
    "接続前でも `gestaloka help`、`gestaloka help <コマンド>`、`gestaloka <コマンド> --help` で使い方を確認できます。CLIの出力はJSONです。",
    ...Object.entries(commands).map(([name, [args, description, example]]) =>
      [
        `## ${name}`,
        description,
        `\`\`\`text\n${usage(name, args)}\n\`\`\``,
        ...(example ? [`実行例 \`${usage(example, "")}\``] : []),
      ].join("\n\n"),
    ),
    "## 共通オプション",
    common.map((option) => `- ${option}`).join("\n"),
    "グラフを更新する申請の形式は [世界への申請](commands.md) を参照してください。",
    "抽選器の設定と固定表の作り方は [抽選器で遊ぶ](draw.md) を参照してください。",
    "",
  ].join("\n\n");
}
