import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { StoryPost } from "@gestaloka/contracts";
import type { z } from "zod";
import { $api, api } from "./api.js";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";
import { createdDate, Notice, Problem } from "./presentation.js";

type Filters = { worldId?: string; author?: string; before?: string };

function Byline({
  story,
}: {
  story: { worldId: string; worldTitle: string; author: string };
}) {
  return (
    <p className="record-meta">
      <Link to="/stories" search={{ worldId: story.worldId }}>
        {story.worldTitle || "世界の作品"}
      </Link>
      {" · "}
      <Link to="/stories" search={{ author: story.author }}>
        {story.author}
      </Link>
    </p>
  );
}

export function Stories({ worldId, author, before }: Filters) {
  const query = $api.useQuery("get", "/api/stories", {
    params: {
      query: {
        ...(worldId && { worldId }),
        ...(author && { author }),
        ...(before && { before }),
      },
    },
  });
  return (
    <main className="page home stories">
      <header className="page-title">
        <h1>STORIES</h1>
        {worldId ? (
          <Link to="/stories/write/$id" params={{ id: worldId }}>
            この世界の物語を書く
          </Link>
        ) : (
          <Link to="/">世界を選んで書く</Link>
        )}
        {(worldId || author) && <Link to="/stories">すべての作品</Link>}
        {author && <p>著者 {author}</p>}
      </header>
      {query.error ? (
        <Problem error={query.error} />
      ) : !query.data ? (
        <Notice>作品を読み込んでいます</Notice>
      ) : (
        <>
          {!query.data.items.length && <p>作品はまだありません。</p>}
          <section aria-label="作品一覧">
            {query.data.items.map((story) => (
              <article className="world-row" key={story.id}>
                <div>
                  <h2>
                    <Link to="/stories/$id" params={{ id: story.id }}>
                      {story.title}
                    </Link>
                  </h2>
                  <Byline story={story} />
                </div>
              </article>
            ))}
          </section>
          <nav aria-label="作品一覧のページ">
            {before && (
              <Link to="/stories" search={{ worldId, author }}>
                最初のページ
              </Link>
            )}
            {query.data.next && (
              <Link
                to="/stories"
                search={{ worldId, author, before: query.data.next }}
              >
                次のページ
              </Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}

export function ReadStory({
  id,
  episode,
  after,
}: {
  id: string;
  episode: number | undefined;
  after: number | undefined;
}) {
  const query = $api.useQuery("get", "/api/stories/{id}", {
    params: {
      path: { id },
      query: {
        ...(episode && { episode: String(episode) }),
        ...(after && { after: String(after) }),
      },
    },
  });
  const data = query.data;
  return (
    <main className="page home stories">
      <Link to="/stories">作品一覧</Link>
      {query.error ? (
        <Problem error={query.error} />
      ) : !data ? (
        <Notice>物語を読み込んでいます</Notice>
      ) : (
        <>
          <header className="page-title">
            <h1>{data.story.title}</h1>
            <Byline story={data.story} />
          </header>
          <article>
            <h2>第{data.episode.number}話</h2>
            <time className="record-meta" dateTime={data.episode.publishedAt}>
              {createdDate(data.episode.publishedAt)}
            </time>
            <p className="plain-text story-body">{data.episode.body}</p>
          </article>
          <nav aria-label="前後の話">
            {data.episode.number > 1 && (
              <Link
                to="/stories/$id"
                params={{ id }}
                search={{ episode: data.episode.number - 1, after }}
              >
                前の話
              </Link>
            )}
            {data.hasNextEpisode && (
              <Link
                to="/stories/$id"
                params={{ id }}
                search={{ episode: data.episode.number + 1, after }}
              >
                次の話
              </Link>
            )}
          </nav>
          <section>
            <h2>目次</h2>
            <ul>
              {data.episodes.map(({ number }) => (
                <li key={number}>
                  <Link
                    to="/stories/$id"
                    params={{ id }}
                    search={{ episode: number, after }}
                    aria-current={
                      number === data.episode.number ? "page" : undefined
                    }
                  >
                    第{number}話
                  </Link>
                </li>
              ))}
            </ul>
            <nav aria-label="目次のページ">
              {after !== undefined && (
                <Link to="/stories/$id" params={{ id }} search={{ episode }}>
                  目次の最初へ
                </Link>
              )}
              {data.next !== null && (
                <Link
                  to="/stories/$id"
                  params={{ id }}
                  search={{ episode, after: data.next }}
                >
                  目次の次のページ
                </Link>
              )}
            </nav>
          </section>
          {data.story.mine && (
            <StoryForm
              key={data.episode.number}
              worldId={data.story.worldId}
              storyId={id}
            />
          )}
        </>
      )}
    </main>
  );
}

export function WriteStory({ id }: { id: string }) {
  return (
    <main className="page home stories">
      <Link to="/stories" search={{ worldId: id }}>
        この世界の作品一覧
      </Link>
      <StoryForm worldId={id} />
    </main>
  );
}

function StoryForm({
  worldId,
  storyId,
}: {
  worldId: string;
  storyId?: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const last = useRef<{ input: string; id: string } | null>(null);
  const post = useMutation({
    mutationFn: async (input: z.infer<typeof StoryPost>) =>
      (
        await api.POST("/api/worlds/{id}/stories", {
          params: { path: { id: worldId } },
          body: input,
        })
      ).data!,
    onSuccess: async (result) => {
      setBody("");
      last.current = null;
      await client.invalidateQueries({
        queryKey: ["get", "/api/stories/{id}"],
      });
      await client.invalidateQueries({ queryKey: ["get", "/api/stories"] });
      await navigate({
        to: "/stories/$id",
        params: { id: result.storyId },
        search: { episode: result.episode },
      });
    },
  });
  return (
    <form
      className="story-form"
      onSubmit={(event) => {
        event.preventDefault();
        const input = storyId ? { storyId, body } : { title, author, body };
        const key = JSON.stringify(input);
        if (last.current?.input !== key)
          last.current = { input: key, id: crypto.randomUUID() };
        post.mutate({ ...input, requestId: last.current.id });
      }}
    >
      {storyId ? <h2>続きを書く</h2> : <h1>物語を書く</h1>}
      <p>公開した文章はログインしたユーザーが読めます。</p>
      <fieldset disabled={post.isPending}>
        {!storyId && (
          <>
            <label>
              作品名
              <Input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label>
              著者名
              <Input
                required
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </label>
          </>
        )}
        <label>
          本文
          <Textarea
            required
            rows={7}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <Button
          disabled={
            !body.trim() || (!storyId && (!title.trim() || !author.trim()))
          }
        >
          {post.isPending ? "公開しています" : "公開する"}
        </Button>
      </fieldset>
      {post.error && <Problem error={post.error} />}
    </form>
  );
}
