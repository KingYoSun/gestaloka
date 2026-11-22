import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  STORY_IMAGE_MAX_BYTES,
  StoryEpisodeFilters,
  StoryListQuery,
} from "@gestaloka/contracts";
import type { z } from "zod";
import { $api, api } from "./api.js";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import { Textarea } from "./components/ui/textarea.js";
import { createdDate, Notice, Problem } from "./presentation.js";
import { readImageFile } from "./player-icons.js";

type Dates = { since?: string | undefined; until?: string | undefined };
const field = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim() || undefined;

function DateFields({ since, until }: Dates) {
  return (
    <fieldset className="story-dates">
      <legend>公開日（日本時間）</legend>
      <label>
        開始日
        <Input name="since" type="date" defaultValue={since} />
      </label>
      <label>
        終了日
        <Input name="until" type="date" defaultValue={until} />
      </label>
    </fieldset>
  );
}

function Byline({
  story,
}: {
  story: {
    worldId: string;
    worldTitle: string;
    author: string;
    player?: string;
  };
}) {
  return (
    <p className="record-meta">
      <Link to="/stories" search={{ worldId: story.worldId }}>
        {story.worldTitle || "世界の作品"}
      </Link>
      {" · "}
      <Link
        to="/stories"
        search={
          story.player ? { player: story.player } : { author: story.author }
        }
        aria-label={`${story.author}のプレイヤーの作品`}
      >
        {story.author}
      </Link>
    </p>
  );
}

export function Stories({
  before,
  ...filters
}: z.infer<typeof StoryListQuery>) {
  const { worldId, author, player, title, since, until, sort } = filters;
  const navigate = useNavigate();
  const query = $api.useQuery("get", "/api/stories", {
    params: {
      query: {
        ...(worldId && { worldId }),
        ...(author && { author }),
        ...(player && { player }),
        ...(title && { title }),
        ...(since && { since }),
        ...(until && { until }),
        ...(sort && { sort }),
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
        {(worldId || player || author || title || since || until) && (
          <Link to="/stories">すべての作品</Link>
        )}
      </header>
      <form
        className="story-filters"
        aria-label="作品の絞り込み"
        key={JSON.stringify(filters)}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const search = StoryListQuery.parse({
            worldId,
            player,
            author: field(form, "author"),
            title: field(form, "title"),
            since: field(form, "since"),
            until: field(form, "until"),
            sort: field(form, "sort"),
          });
          void navigate({ to: "/stories", search });
        }}
      >
        {player && (
          <p>
            プレイヤーで絞り込み中{" "}
            <Link to="/stories" search={{ ...filters, player: undefined }}>
              解除
            </Link>
          </p>
        )}
        <label>
          著者名
          <Input name="author" defaultValue={author} />
        </label>
        <label>
          作品名
          <Input name="title" defaultValue={title} />
        </label>
        <DateFields since={since} until={until} />
        <label>
          作品の並び順
          <select name="sort" defaultValue={sort ?? "newest"}>
            <option value="newest">公開日が新しい順</option>
            <option value="oldest">公開日が古い順</option>
            <option value="player">プレイヤーごと</option>
            <option value="author">著者名順</option>
            <option value="title">作品名順</option>
          </select>
        </label>
        <Button>作品に適用</Button>
      </form>
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
                  {story.publishedAt && (
                    <time className="record-meta" dateTime={story.publishedAt}>
                      {createdDate(story.publishedAt)}
                    </time>
                  )}
                </div>
              </article>
            ))}
          </section>
          <nav aria-label="作品一覧のページ">
            {before && (
              <Link to="/stories" search={filters}>
                最初のページ
              </Link>
            )}
            {query.data.next && (
              <Link
                to="/stories"
                search={{ ...filters, before: query.data.next }}
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
  filters,
}: {
  id: string;
  filters: z.infer<typeof StoryEpisodeFilters> & {
    episode: number | undefined;
    after: number | undefined;
  };
}) {
  const { episode, after, since, until, sort } = filters;
  const navigate = useNavigate();
  const query = $api.useQuery("get", "/api/stories/{id}", {
    params: {
      path: { id },
      query: {
        image: "1",
        ...(episode && { episode: String(episode) }),
        ...(after && { after: String(after) }),
        ...(since && { since }),
        ...(until && { until }),
        ...(sort && { sort }),
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
            {data.episode.image && (
              <img
                className="story-image"
                src={`data:image/webp;base64,${data.episode.image}`}
                alt={`第${data.episode.number}話の添付画像`}
              />
            )}
          </article>
          <nav aria-label="前後の話">
            {data.episode.number > 1 && (
              <Link
                to="/stories/$id"
                params={{ id }}
                search={{ ...filters, episode: data.episode.number - 1 }}
              >
                前の話
              </Link>
            )}
            {data.hasNextEpisode && (
              <Link
                to="/stories/$id"
                params={{ id }}
                search={{ ...filters, episode: data.episode.number + 1 }}
              >
                次の話
              </Link>
            )}
          </nav>
          <section>
            <h2>目次</h2>
            <form
              className="story-filters"
              aria-label="目次の絞り込み"
              key={JSON.stringify({ since, until, sort })}
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const search = StoryEpisodeFilters.parse({
                  since: field(form, "since"),
                  until: field(form, "until"),
                  sort: field(form, "sort"),
                });
                void navigate({
                  to: "/stories/$id",
                  params: { id },
                  search: { ...search, episode },
                });
              }}
            >
              <DateFields since={since} until={until} />
              <label>
                目次の並び順
                <select name="sort" defaultValue={sort ?? "number"}>
                  <option value="number">話数順</option>
                  <option value="newest">公開日が新しい順</option>
                  <option value="oldest">公開日が古い順</option>
                </select>
              </label>
              <Button>目次に適用</Button>
            </form>
            {!data.episodes.length && <p>条件に合う話はありません。</p>}
            <ul>
              {data.episodes.map(({ number, publishedAt }) => (
                <li key={number}>
                  <Link
                    to="/stories/$id"
                    params={{ id }}
                    search={{ ...filters, episode: number }}
                    aria-current={
                      number === data.episode.number ? "page" : undefined
                    }
                  >
                    第{number}話
                  </Link>{" "}
                  <time className="record-meta" dateTime={publishedAt}>
                    {createdDate(publishedAt)}
                  </time>
                </li>
              ))}
            </ul>
            <nav aria-label="目次のページ">
              {after !== undefined && (
                <Link
                  to="/stories/$id"
                  params={{ id }}
                  search={{ ...filters, after: undefined }}
                >
                  目次の最初へ
                </Link>
              )}
              {data.next !== null && (
                <Link
                  to="/stories/$id"
                  params={{ id }}
                  search={{ ...filters, after: data.next }}
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
  const imageInput = useRef<HTMLInputElement>(null);
  const last = useRef<{ input: string; id: string } | null>(null);
  const post = useMutation({
    mutationFn: async (file: File | undefined) => {
      if (file && file.size > STORY_IMAGE_MAX_BYTES)
        throw new Error("5MiB以下の画像を指定してください。");
      const image = file ? { image: await readImageFile(file) } : {};
      const input = {
        ...(storyId ? { storyId, body } : { title, author, body }),
        ...image,
      };
      const key = JSON.stringify(input);
      if (last.current?.input !== key)
        last.current = { input: key, id: crypto.randomUUID() };
      return (
        await api.POST("/api/worlds/{id}/stories", {
          params: { path: { id: worldId } },
          body: { ...input, requestId: last.current.id },
        })
      ).data!;
    },
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
        post.mutate(imageInput.current?.files?.[0]);
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
        <label>
          添付画像（任意）
          <Input
            ref={imageInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
          />
          <small>JPEG・PNG・WebPの静止画、5MiBまで</small>
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
