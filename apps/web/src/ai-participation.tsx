import { useState } from "react";
import { z } from "zod";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { userApp } from "./surface.js";
import { $api } from "./api.js";

export function AiParticipationInvitation({
  invitation,
}: {
  invitation: string;
}) {
  const release = $api.useQuery("get", "/api/player-cli/latest");
  const [worldPage, setWorldPage] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="form-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        try {
          const world = z
            .uuid()
            .parse(
              new URL(worldPage).pathname.match(
                /^\/worlds\/([^/]+)(?:\/|$)/,
              )?.[1],
            );
          if (!release.data) return;
          const url = new URL(
            "join.md",
            new URL(release.data.setupUrl, userApp),
          );
          if (url.origin !== new URL(userApp).origin)
            throw new Error("参加案内の接続先を確認してください");
          url.searchParams.set("world", world);
          url.hash = new URLSearchParams({ invitation }).toString();
          await navigator.clipboard.writeText(
            `このページを参考に、あなたがこの世界で遊ぶ準備と必要な道具の導入・更新を進めてください。別の希望を伝えていなければ、あなたに設定したキャラクター情報と画像を基本に人物を用意してください。ログイン・登録と最後の許可は私が行います。準備中の返事や進み具合の案内、私が画面で行う操作の説明は、専門用語を使わず、ふだんの言葉でお願いします。準備ができたら、その時点で教えてください。\n${url.href}`,
          );
          setMessage(
            "コピーしました。参加する人に送り、そのままAIとの会話に貼ってもらってください。",
          );
        } catch {
          setMessage(
            "案内をコピーできませんでした。世界のページのアドレスを確かめて、もう一度お試しください。",
          );
        }
      }}
    >
      <h3>AIに渡す参加案内</h3>
      <p>
        この招待と参加先をまとめた案内を作れます。招待の期限と利用できる回数は、そのまま適用されます。
      </p>
      <Label htmlFor="ai-invitation-world">参加する世界のページ</Label>
      <Input
        id="ai-invitation-world"
        type="url"
        required
        value={worldPage}
        onChange={(e) => {
          setWorldPage(e.target.value);
          setMessage("");
        }}
      />
      <Button disabled={!release.data}>AIに渡す参加案内をコピー</Button>
      {release.isPending && <p role="status">案内の情報を確認しています。</p>}
      {release.error && (
        <p role="alert">
          案内の情報を取得できませんでした。もう一度開いてください。
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </form>
  );
}
