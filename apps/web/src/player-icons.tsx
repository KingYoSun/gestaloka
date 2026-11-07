import { useCallback, useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  PLAYER_ICON_MAX_BYTES,
  type PlayerCharacter,
} from "@gestaloka/contracts";
import type { z } from "zod";
import { api, pendingKey } from "./api.js";
import { Problem } from "./presentation.js";
import { Button } from "./components/ui/button.js";
import { Label } from "./components/ui/label.js";

type Character = z.infer<typeof PlayerCharacter>;
export function CharacterBadge({
  name,
  icon,
}: Pick<Character, "name" | "icon">) {
  const [failed, setFailed] = useState<string>();
  return (
    <span className="player-character">
      <span className="player-avatar">
        {icon && failed !== icon ? (
          <img
            src={icon}
            alt={`${name}のアイコン`}
            onError={() => setFailed(icon)}
          />
        ) : (
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="11" r="5" />
            <path d="M6 29v-3a10 10 0 0 1 20 0v3" />
          </svg>
        )}
      </span>
      <span>{name}</span>
    </span>
  );
}
export function Characters({
  characters,
}: {
  characters?: Character[] | undefined;
}) {
  return characters?.length ? (
    <div className="player-characters">
      {characters.map((c) => (
        <CharacterBadge key={c.actorId} {...c} />
      ))}
    </div>
  ) : null;
}

// Image drafts exceed localStorage's quota. Keep only requested, unfinished uploads in IndexedDB.
export function iconDraft(
  key: string,
  value?: string | null,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("gestaloka-player-icons", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("drafts");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(
        "drafts",
        value === undefined ? "readonly" : "readwrite",
      );
      const store = tx.objectStore("drafts");
      const request =
        value === undefined
          ? store.get(key)
          : value === null
            ? store.delete(key)
            : store.put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve(typeof request.result === "string" ? request.result : null);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}
export const iconDraftKey = (world: string, player: string) =>
  pendingKey(`${world}:${player}`, "icon");

export function IconPicker({
  onChange,
  onReading,
  disabled = false,
}: {
  onChange: (image: string | null) => void;
  onReading: (reading: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState<Error>();
  return (
    <div className="icon-picker">
      <Label htmlFor={id}>人物のアイコン（任意）</Label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          setError(undefined);
          if (!file) {
            onChange(null);
            return;
          }
          try {
            onReading(true);
            if (file.size > PLAYER_ICON_MAX_BYTES)
              throw new Error("5MiB以下の画像を指定してください。");
            const image = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve(String(reader.result).split(",")[1]!);
              reader.onerror = () =>
                reject(new Error("画像を読み込めませんでした。"));
              reader.readAsDataURL(file);
            });
            onChange(image);
          } catch (error) {
            onChange(null);
            setError(error as Error);
          } finally {
            onReading(false);
          }
        }}
      />
      <p id={`${id}-help`} className="record-meta">
        JPEG・PNG・WebPの静止画。5MiB以下、長辺4096px以下。縦横比を保って長辺256px以下に縮小し、画像の付加情報を削除します。
      </p>
      {error && <Problem error={error} />}
    </div>
  );
}

export function IconEditor({
  world,
  player,
  icon,
}: {
  world: string;
  player: string;
  icon?: string | null | undefined;
}) {
  const client = useQueryClient();
  const key = iconDraftKey(world, player);
  const [image, setImage] = useState<string | null>();
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [error, setError] = useState<unknown>();
  const save = useCallback(
    async (value: string | null) => {
      setBusy(true);
      setError(undefined);
      setSaved(false);
      try {
        await iconDraft(key, value);
        await api.PUT("/api/worlds/{id}/players/{playerId}/icon", {
          params: { path: { id: world, playerId: player } },
          body: { image: value },
        });
        await iconDraft(key, null);
        setImage(undefined);
        setSaved(true);
        await client.invalidateQueries({
          predicate: (q) => JSON.stringify(q.queryKey).includes(world),
        });
      } catch (error) {
        setError(error);
      } finally {
        setBusy(false);
      }
    },
    [key, world, player, client],
  );
  useEffect(() => {
    let active = true;
    void iconDraft(key)
      .then((draft) => {
        if (active && draft) {
          setImage(draft);
          void save(draft);
        }
      })
      .catch((error) => {
        if (active) setError(error);
      });
    return () => {
      active = false;
    };
  }, [key, save]);
  return (
    <div className="icon-editor" aria-busy={busy}>
      <IconPicker
        disabled={busy}
        onReading={setReading}
        onChange={(value) => {
          setImage(value ?? undefined);
          setSaved(false);
        }}
      />
      <div className="action-footer">
        <Button
          disabled={busy || reading || !image}
          onClick={() => image && void save(image)}
        >
          {busy
            ? "画像を保存しています"
            : error && image
              ? "画像の登録を再試行する"
              : "画像を保存する"}
        </Button>
        {(icon || image) && (
          <Button
            variant="outline"
            disabled={busy || reading}
            onClick={() => {
              setImage(undefined);
              void save(null);
            }}
          >
            画像を解除する
          </Button>
        )}
      </div>
      {saved && <p role="status">アイコンを保存しました。</p>}
      {error !== undefined && (
        <>
          <Problem error={error} />
          <p>
            参加と以前のアイコンは保持されています。画像を選び直すか、再試行できます。
          </p>
        </>
      )}
    </div>
  );
}
