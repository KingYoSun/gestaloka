import { useState } from "react";
import { z } from "zod";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { Label } from "./components/ui/label.js";
import { userApp } from "./surface.js";

export function AiParticipationInvitation({
  invitation,
}: {
  invitation: string;
}) {
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
          const url = new URL("/api/player-cli/join", userApp);
          url.searchParams.set("world", world);
          url.hash = new URLSearchParams({ invitation }).toString();
          await navigator.clipboard.writeText(
            `このページを読んで、あなたがこの世界で遊ぶ準備を進めてください。私が画面で行う操作も案内してください。\n${url.href}`,
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
      <Button>AIに渡す参加案内をコピー</Button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
