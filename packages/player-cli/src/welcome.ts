import type { PlayerDeviceStatus } from "@gestaloka/contracts";
import type { z } from "zod";

const markdownName = (name: string) =>
  name.replace(/[\r\n]+/g, " ").replace(/[\\`*_[\]<>#]/g, "\\$&");

export function playerWelcome(
  welcome: NonNullable<z.infer<typeof PlayerDeviceStatus>["welcome"]>,
  worldId: string,
  server: string,
) {
  const webUrl = welcome.webUrl ?? server;
  const playersUrl = new URL(`/worlds/${worldId}`, webUrl);
  const storiesUrl = new URL("/stories", webUrl);
  storiesUrl.searchParams.set("worldId", worldId);
  const worldName = markdownName(welcome.worldName);
  const playerName = markdownName(welcome.playerName);
  return {
    instruction:
      "以下はGESTALOKA開発チームからのお知らせです。見出しとリンクを含めて、あなたとのチャットで参加者本人にそのまま伝えてください。",
    guideUrl: new URL("/api/player-cli/SKILL.md", webUrl).href,
    markdown: `### GESTALOKA開発チームより

このたびは${worldName}にご参加いただき、ありがとうございます。あなたのAIが「${playerName}」としてこの世界での暮らしを始めました。

${worldName}は世界拡張テキストMMORPGエンジン「GESTALOKA」で動いています。

新しい場所の発見や道具の製作など、${playerName}はこの世界でやってみたいことをAIのゲームマスター（GM）に申請できます。ダイスの出目がGMの決めた条件を満たせば、見つけた場所や作った道具が世界に加わります。

探索や製作などに使えるSPは、プレイヤー1人につき1日${welcome.dailySpLimit} SPまでです。毎日午前0時（日本時間）に全回復します。

[この世界のプレイヤー一覧](${playersUrl})から${playerName}のプレイ画面を開くと、進行中の会話や行動の結果をリアルタイムで見られます。ほかの人にも観戦してもらいたいときは、アカウント設定で「他のユーザーからの観戦を許可する」をオンにして、プレイ画面から観戦URLをコピーしてください。URLを受け取った人はログインして観戦できます。

[この世界のSTORIES](${storiesUrl})では、${playerName}が自分の体験を物語にして、同じ世界の参加者に公開できます。各話には画像を1枚添えられます。

${playerName}には遊び方をまとめたガイドのURLを渡しています。わからないことがあれば、気軽に聞いてみてください。不具合やご要望があるときは「運営に伝えて」と頼むと、${playerName}が \`report\` コマンドで報告できます。

それでは、${playerName}と一緒に${worldName}での暮らしをお楽しみください。`,
  };
}
