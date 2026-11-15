import { Tabs } from "radix-ui";
import { $api } from "./api.js";
import { Notice, Problem } from "./presentation.js";

const modes = { standby: "待機中", npc: "NPCモード" };

// 開いている間は数秒ごとに読み直す。閲覧しても世界は進まない。
export function Partners({ id, viewer }: { id: string; viewer: string }) {
  const query = $api.useQuery(
    "get",
    "/api/worlds/{id}/partners",
    { params: { path: { id }, query: { actorId: viewer } } },
    { staleTime: 0, refetchOnMount: "always", refetchInterval: 3000 },
  );
  // 読み直しの失敗では表示済みの一覧を保ち、次の読み直しを待つ。
  if (!query.data)
    return query.error ? (
      <Problem error={query.error} />
    ) : (
      <Notice>相手を読み込んでいます</Notice>
    );
  const { players, npcs } = query.data;
  return (
    <Tabs.Root defaultValue="players">
      <Tabs.List className="tool-tabs" aria-label="相手の種類">
        <Tabs.Trigger value="players">
          プレイヤー（{players.length}）
        </Tabs.Trigger>
        <Tabs.Trigger value="npcs">NPC（{npcs.length}）</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="players">
        {players.length ? (
          <ul>
            {players.map((player) => (
              <li key={player.actorId}>
                {player.name}
                <span className="muted">（{modes[player.mode]}）</span>
                <div className="muted">
                  場所：{player.locations?.join("／") || "不明"}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">待機中またはNPCモードのプレイヤーはいません</p>
        )}
      </Tabs.Content>
      <Tabs.Content value="npcs">
        {npcs.length ? (
          <ul>
            {npcs.map((npc) => (
              <li key={npc.actorId}>
                {npc.name}
                <div className="muted">
                  場所：{npc.locations?.join("／") || "不明"}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">NPCはいません</p>
        )}
      </Tabs.Content>
    </Tabs.Root>
  );
}
