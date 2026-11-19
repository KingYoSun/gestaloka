export const playerOptions = {
  help: { type: "boolean" },
  "full-ids": { type: "boolean" },
  server: { type: "string" },
  world: { type: "string" },
  profile: { type: "string" },
  instance: { type: "string" },
  participants: { type: "string" },
  from: { type: "string" },
  label: { type: "string" },
  source: { type: "string" },
  index: { type: "string" },
  owner: { type: "string" },
  resume: { type: "boolean" },
  once: { type: "boolean" },
  "after-wake": { type: "string" },
  text: { type: "string" },
  file: { type: "string" },
  after: { type: "string" },
  view: { type: "string" },
  before: { type: "string" },
  scene: { type: "string" },
  kind: { type: "string" },
  target: { type: "string" },
  application: { type: "string" },
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
  resume: ["", "中断した人物の参加準備を再開。待機の再開は standby --resume。"],
  status: [
    "[--scene <ID>] [--after <カーソル>] [--view <wait|joins>]",
    "現在の手番と未読履歴を照会。--sceneは本人の過去シーン、--after 0は先頭。--view waitは復帰待ちの残り時間、--view joinsは同席者と合流記録。--viewと--sceneは併用不可。--view・--after・--sceneでの照会は既読位置を進めない。",
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
    "[--resume] [--once] [--after-wake <キー>]",
    "SSEで進行を待つ。--resumeは待機再開。--onceは本人に操作が回ったときに1回返る。--after-wakeは--onceで受付済みの起床キーを除外する。CLIを更新した後も、同じインスタンスで保存済みの起床キーを使う。切り替え手順はhelp updateを参照。",
    "listen --once --after-wake <受付済みのキー>",
  ],
  disconnect: ["", "本人のインスタンスの待機を解除。"],
  start: ["", "本人の通常手番を単独で開始。"],
  search: [
    "--kind <surroundings|belongings|self|history|subject|memos> [--target <ID>]",
    "本人の手番で素材を検索。subjectには対象IDを指定し、historyには必要に応じて相手を指定。",
    "search --kind subject --target @12ab34cd",
  ],
  contact: [
    "--target <人物ID>",
    "同じ具体的な場所にいる相手と合流を申請。返答のactionableとactionMessageで、接触後に本人の操作が必要かを確認。",
    "contact --target @12ab34cd",
  ],
  say: [
    "--text <発言> | --file <本文ファイル>",
    "自分の発言・行動を記録。--file指定時はファイルの本文を使用。",
    "say --text '川岸を眺めます'",
  ],
  comment: [
    "--text <コメント> | --file <本文ファイル>",
    "本人の手番のコメント。--file指定時はファイルの本文を使用。",
    "comment --text '少し考えています'",
  ],
  receive: [
    "--application <申請ID> (--accept | --reject)",
    "本人の受領判断。起床応答やstatusの申請IDで承認・却下を指定。承認後は次の受領者が判断し、全員が承認すると確定する。却下・期限切れ・申請関係者の退出でも申請が終わる。申請者が残り、通常枠があれば申請者の元の手番に戻る。申請者の枠が尽きた場合や、申請者自身が退出した場合は、その席から残った参加者の手番順へ進む。離席中の人は通常の規則で飛ばし、インスタントNPCは通常の順序で手番を取る。申請と関係のない人の退出では現在の受領者が続ける。応答のdecisionに自分の判断の受付、applicationに申請全体の状態が出る。却下した人は申請者へのreceiptResultに出る。",
    "receive --application @12ab34cd --accept",
  ],
  "end-turn": ["", "本人の通常手番を終え、同席者に操作結果を共有。"],
  leave: ["", "セッションを分離し、本人のシーンでプレイを続ける。"],
  finish: ["", "本人のプレイを終え、確定した履歴を取得。"],
  play: [
    "--file <JSONファイル>",
    "PlayCommand形式の操作を送る。グラフ差分を使うメモの更新や対抗行動の形式は commands.md を参照。",
    "play --file action.json",
  ],
  memo: [
    "--text <本文> [--participants <人物ID,人物ID>]",
    "本人と指定した同席者に関連するメモを申請。手番が回った関係者が受領を判断。",
    "memo --text '次に川岸で会う' --participants @12ab34cd",
  ],
  explore: [
    "--from <場所ID> --label <場所の呼び名> --text <説明> | --file <本文ファイル>",
    "新しい場所を申請。--fromは接続元で、本人の現在の所在地にある場所を指定する。--textには場所の様子と接続元からの行き方を書く。GMが接続元から見た妥当性でダイスを設定し、サーバーが一度だけ振る。成功すると応答のplaceIdへ移動でき、接続元と新しい場所の双方から互いの名前とIDを調べられる。失敗しても通常枠を1回使う。",
    "explore --from @12ab34cd --label 森の奥の沢 --text ぶー森の小道を奥へ進むと浅い沢に出る",
  ],
  "promote-npc": [
    "--source <発言要求ID> --index <番号> --text <NPCの説明> [--owner <人物ID>]",
    "出現記録の指定位置のNPCを昇格申請。必要に応じて所有者を指定。",
    "promote-npc --source @12ab34cd --index 0 --text '小屋の留鳥'",
  ],
  players: [
    "[--before <ID>]",
    "いま出会えるプレイヤーと居場所を照会。本人の所在地を問わず、待機中で接触を受けられるプレイヤーの人物ID・名前・直接の滞在先（placeId・place）を返す。滞在先が未確定の人物はnull。世界の運営者が有効にした世界でだけ使え、無効な世界ではPLAYER_LIST_DISABLEDになる。通常枠は使わない。--beforeにnextを指定して続きを取得。",
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
    "",
  ].join("\n\n");
}
