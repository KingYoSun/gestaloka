import { $api } from "./api.js";
import { Notice, Problem } from "./presentation.js";

type Item = { label: string; quantity: number; mine: boolean };
function Items({ items }: { items: Item[] }) {
  if (!items.length) return <p className="muted">ありません</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={`${item.label}:${item.mine}`}>
          {item.label}
          {item.quantity > 1 && ` × ${item.quantity}`}
          {!item.mine && <span className="muted">（自分の所有ではない）</span>}
        </li>
      ))}
    </ul>
  );
}

// 開くたびに最新の確定状態を読む。閲覧しても世界は進まない。
export function Belongings({ id, viewer }: { id: string; viewer: string }) {
  const query = $api.useQuery(
    "get",
    "/api/worlds/{id}/belongings",
    { params: { path: { id }, query: { actorId: viewer } } },
    { staleTime: 0, refetchOnMount: "always" },
  );
  if (query.error) return <Problem error={query.error} />;
  if (!query.data) return <Notice>持ち物を読み込んでいます</Notice>;
  return (
    <section className="scene-panel" aria-label="持ち物と技能">
      <h2>持ち物</h2>
      <Items items={query.data.items} />
      <h2>保管先</h2>
      {query.data.storages.length ? (
        query.data.storages.map((storage) => (
          <div key={storage.id}>
            <h3>{storage.label}</h3>
            <Items items={storage.items} />
          </div>
        ))
      ) : (
        <p className="muted">利用できる保管先はありません</p>
      )}
      <h2>技能</h2>
      {query.data.skills.length ? (
        <ul>
          {query.data.skills.map((skill) => (
            <li key={skill.id}>{skill.text}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">ありません</p>
      )}
    </section>
  );
}
