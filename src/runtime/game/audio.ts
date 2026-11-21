// Audio bridge: named sounds from scene.audio → synth presets (SOUND_IMPLS,
// src/runtime/audio/) or decoded audio files. The AudioContext is only created
// on the first user gesture (browser autoplay rule); sounds before that are dropped.

import type { AudioDef } from "../../core/types";
import type { SoundImpl } from "../registry";

export interface AudioBridge {
  play(name: string): void;
  music(on: boolean): void;
  muted(): boolean;
  setMuted(m: boolean): void;
  // Call from a user gesture handler.
  unlock(): void;
  dispose(): void;
}

export function createAudio(def: AudioDef | undefined, resolve: (path: string) => string, onError: (msg: string, path?: string) => void): AudioBridge {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let isMuted = !!def?.muted;
  let impls: Record<string, SoundImpl> | null = null;
  const buffers = new Map<string, Promise<AudioBuffer | null>>();
  let musicHandle: { stop(): void } | null = null;
  let musicWanted = !!def?.music;

  const loadImpls = () => import("../audio/index").then((m) => (impls = m.SOUND_IMPLS)).catch(() => (impls = {}));

  const buffer = (src: string) => {
    let p = buffers.get(src);
    if (!p && ctx) {
      const c = ctx;
      p = fetch(resolve(src))
        .then((r) => r.arrayBuffer())
        .then((b) => c.decodeAudioData(b))
        .catch((err: Error) => {
          onError(err.message, src);
          return null;
        });
      buffers.set(src, p);
    }
    return p ?? Promise.resolve(null);
  };

  const playSpec = (spec: { preset?: string; src?: string; volume?: number; loop?: boolean }, loop = false): { stop(): void } | null => {
    if (!ctx || !master) return null;
    const vol = spec.volume ?? 1;
    if (spec.preset) {
      const impl = impls?.[spec.preset];
      if (!impl) return null;
      return impl.play(ctx, master, vol);
    }
    if (spec.src) {
      const c = ctx, m = master;
      let node: AudioBufferSourceNode | null = null;
      let stopped = false;
      void buffer(spec.src).then((buf) => {
        if (!buf || stopped) return;
        node = c.createBufferSource();
        node.buffer = buf;
        node.loop = loop;
        const g = c.createGain();
        g.gain.value = vol;
        node.connect(g).connect(m);
        node.start();
      });
      return {
        stop() {
          stopped = true;
          try {
            node?.stop();
          } catch {
            /* already stopped */
          }
        },
      };
    }
    return null;
  };

  const startMusic = () => {
    if (musicHandle || !def?.music || isMuted || !ctx) return;
    musicHandle = playSpec(def.music, def.music.loop !== false);
  };

  void loadImpls();

  return {
    play(name) {
      if (isMuted || !ctx) return;
      const spec = def?.sounds?.[name] as { preset?: string; src?: string; volume?: number } | undefined;
      if (spec) playSpec(spec);
      else if (impls?.[name]) impls[name].play(ctx, master!, 1); // a bare preset id
    },
    music(on) {
      musicWanted = on;
      if (!on) {
        musicHandle?.stop();
        musicHandle = null;
      } else startMusic();
    },
    muted: () => isMuted,
    setMuted(m) {
      isMuted = m;
      if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
      if (m) {
        musicHandle?.stop();
        musicHandle = null;
      } else if (musicWanted || def?.music) {
        musicWanted = true;
        startMusic();
      }
    },
    unlock() {
      if (ctx) {
        if (ctx.state === "suspended") void ctx.resume();
        return;
      }
      const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = isMuted ? 0 : 1;
        master.connect(ctx.destination);
        if (musicWanted) startMusic();
      } catch (err) {
        onError((err as Error).message);
      }
    },
    dispose() {
      musicHandle?.stop();
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
