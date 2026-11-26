import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "./components/ui/button.js";
import { Label } from "./components/ui/label.js";
import craft from "./sounds/craft.mp3";
import electro from "./sounds/electro.mp3";
import short from "./sounds/short.mp3";
import twinkle from "./sounds/twinkle.mp3";

const sounds = [
  { id: "craft", label: "クラフト", url: craft },
  { id: "electro", label: "ソフトエレクトロ", url: electro },
  { id: "short", label: "ショートトーン", url: short },
  { id: "twinkle", label: "きらめき", url: twinkle },
] as const;
const Settings = z.object({
  enabled: z.boolean(),
  sound: z.enum(sounds.map(({ id }) => id)),
  volume: z.number().int().min(0).max(100),
});
type Settings = z.infer<typeof Settings>;
const storageKey = "gestaloka-play-log-sound";
const defaults: Settings = { enabled: false, sound: "craft", volume: 50 };

function readSettings() {
  try {
    return Settings.parse(
      JSON.parse(localStorage.getItem(storageKey) ?? "null"),
    );
  } catch {
    return defaults;
  }
}

let audio: AudioContext | undefined;
let playing: AudioBufferSourceNode | undefined;
const clips = new Map<Settings["sound"], AudioBuffer>();

async function resumeAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state !== "running") await audio.resume();
  } catch {
    // ブラウザーが再生を許可するまでは読み続けられるようにする。
  }
}

async function playSound({ sound, volume }: Settings) {
  const context = audio;
  if (!volume || context?.state !== "running") return;
  try {
    let clip = clips.get(sound);
    if (!clip) {
      const url = sounds.find(({ id }) => id === sound)!.url;
      const response = await fetch(url);
      if (!response.ok) return;
      clip = await context.decodeAudioData(await response.arrayBuffer());
      clips.set(sound, clip);
    }
    playing?.stop();
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = clip;
    gain.gain.value = volume / 100;
    source.connect(gain).connect(context.destination);
    source.onended = () => gain.disconnect();
    source.start();
    playing = source;
  } catch {
    // 音源を再生できなくても、プレイログの更新は続ける。
  }
}

export function usePlayLogAudio(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const unlock = () => {
      if (audio?.state !== "running" && readSettings().enabled)
        void resumeAudio();
    };
    window.addEventListener("click", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("click", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [active]);
}

export function usePlayLogSound(
  scene: string | undefined,
  latest: string | undefined,
) {
  const seen = useRef<{ scene: string; entry: bigint }>(null);
  useEffect(() => {
    if (scene === undefined) return;
    const entry = BigInt(latest ?? "0");
    const previous = seen.current;
    if (previous?.scene === scene && entry <= previous.entry) return;
    seen.current = { scene, entry };
    if (previous?.scene !== scene) return;
    const settings = readSettings();
    if (settings.enabled) void playSound(settings);
  }, [scene, latest]);
}

export function PlayLogSoundSettings() {
  const [settings, setSettings] = useState(readSettings);
  function save(next: Settings) {
    localStorage.setItem(storageKey, JSON.stringify(next));
    setSettings(next);
  }
  return (
    <div className="space-y-3">
      <Label className="min-h-11 w-fit cursor-pointer">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={({ target }) => {
            save({ ...settings, enabled: target.checked });
            if (target.checked) void resumeAudio();
          }}
        />
        新しいログが届いたら効果音を鳴らす
      </Label>
      <div className="max-w-sm">
        <Label htmlFor="play-log-sound">音色</Label>
        <select
          id="play-log-sound"
          value={settings.sound}
          onChange={({ target }) => {
            const sound = Settings.shape.sound.parse(target.value);
            save({ ...settings, sound });
          }}
        >
          {sounds.map(({ id, label }) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="max-w-sm">
        <Label htmlFor="play-log-volume">音量 {settings.volume}%</Label>
        <input
          id="play-log-volume"
          className="min-h-11 w-full accent-primary"
          type="range"
          min={0}
          max={100}
          value={settings.volume}
          onTouchStart={(event) => event.stopPropagation()}
          onChange={({ target }) =>
            save({ ...settings, volume: target.valueAsNumber })
          }
        />
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={!settings.volume}
        onClick={() => void resumeAudio().then(() => playSound(settings))}
      >
        試聴する
      </Button>
    </div>
  );
}
