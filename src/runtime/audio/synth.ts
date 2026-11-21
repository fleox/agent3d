// Tiny WebAudio synth toolkit used by the sound presets: enveloped
// oscillators, filtered noise, a look-ahead step sequencer. Zero audio files.

export interface Voice {
  ctx: AudioContext;
  out: GainNode; // per-play master gain → destination
  sources: AudioScheduledSourceNode[];
  timers: ReturnType<typeof setTimeout>[];
  stopped: boolean;
}

export function voice(ctx: AudioContext, destination: AudioNode, volume: number): Voice {
  const out = ctx.createGain();
  out.gain.value = Math.max(0, volume);
  out.connect(destination);
  return { ctx, out, sources: [], timers: [], stopped: false };
}

export function stopVoice(v: Voice, fade = 0.06): void {
  if (v.stopped) return;
  v.stopped = true;
  for (const t of v.timers) clearTimeout(t);
  const now = v.ctx.currentTime;
  try {
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.linearRampToValueAtTime(0, now + fade);
  } catch {
    /* context closed */
  }
  for (const s of v.sources) {
    try {
      s.stop(now + fade + 0.02);
    } catch {
      /* already stopped */
    }
  }
  const t = setTimeout(() => {
    try {
      v.out.disconnect();
    } catch {
      /* ignore */
    }
  }, (fade + 0.1) * 1000);
  void t;
}

// Auto-release the voice once its last scheduled sound is over.
export function autoStop(v: Voice, seconds: number): { stop(): void } {
  v.timers.push(setTimeout(() => stopVoice(v, 0.01), (seconds + 0.2) * 1000));
  return { stop: () => stopVoice(v) };
}

export interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number; // exponential glide target
  start?: number; // seconds from now
  dur: number;
  gain?: number;
  attack?: number;
  release?: number; // exponential tail length inside dur
  detune?: number;
  vibrato?: { rate: number; depth: number }; // depth in cents
  filter?: { type: BiquadFilterType; freq: number; to?: number; q?: number };
  dest?: AudioNode;
}

export function tone(v: Voice, o: ToneOpts): void {
  const { ctx } = v;
  const t0 = ctx.currentTime + (o.start ?? 0);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "square";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t0 + o.dur);
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  const peak = o.gain ?? 0.3;
  const a = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + a);
  const rel = Math.min(o.release ?? o.dur, o.dur);
  g.gain.setValueAtTime(peak, t0 + Math.max(a, o.dur - rel));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  let node: AudioNode = osc;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter.type;
    f.frequency.setValueAtTime(o.filter.freq, t0);
    if (o.filter.to) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.filter.to), t0 + o.dur);
    f.Q.value = o.filter.q ?? 1;
    osc.connect(f);
    node = f;
  }
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vibrato.rate;
    const lg = ctx.createGain();
    lg.gain.value = o.vibrato.depth;
    lfo.connect(lg);
    lg.connect(osc.detune);
    lfo.start(t0);
    lfo.stop(t0 + o.dur + 0.05);
    v.sources.push(lfo);
  }
  node.connect(g);
  g.connect(o.dest ?? v.out);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.05);
  v.sources.push(osc);
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    // deterministic white noise (xorshift)
    let s = 0x2545f491;
    for (let i = 0; i < d.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

export interface NoiseOpts {
  start?: number;
  dur: number;
  gain?: number;
  attack?: number;
  filter?: { type: BiquadFilterType; freq: number; to?: number; q?: number; mid?: number };
  dest?: AudioNode;
}

export function noise(v: Voice, o: NoiseOpts): void {
  const { ctx } = v;
  const t0 = ctx.currentTime + (o.start ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const g = ctx.createGain();
  const peak = o.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + (o.attack ?? 0.003));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  let node: AudioNode = src;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter.type;
    f.Q.value = o.filter.q ?? 1;
    f.frequency.setValueAtTime(o.filter.freq, t0);
    if (o.filter.mid) {
      f.frequency.exponentialRampToValueAtTime(o.filter.mid, t0 + o.dur * 0.45);
      if (o.filter.to) f.frequency.exponentialRampToValueAtTime(o.filter.to, t0 + o.dur);
    } else if (o.filter.to) f.frequency.exponentialRampToValueAtTime(o.filter.to, t0 + o.dur);
    src.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(o.dest ?? v.out);
  src.start(t0, (t0 * 0.37) % 1.5);
  src.stop(t0 + o.dur + 0.05);
  v.sources.push(src);
}

// Look-ahead sequencer: calls `step(i, when)` for every step of `stepDur`
// seconds, scheduled ~0.15 s ahead with setTimeout; loops until the voice stops.
export function sequence(v: Voice, stepDur: number, step: (i: number, when: number) => void): void {
  const { ctx } = v;
  let next = ctx.currentTime + 0.06;
  let i = 0;
  const tick = (): void => {
    if (v.stopped) return;
    while (next < ctx.currentTime + 0.15) {
      step(i, next - ctx.currentTime);
      i++;
      next += stepDur;
    }
    // drop references to finished sources to keep memory flat in long loops
    if (v.sources.length > 400) v.sources.splice(0, v.sources.length - 200);
    v.timers.length = 0;
    v.timers.push(setTimeout(tick, 40));
  };
  tick();
}

export const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
