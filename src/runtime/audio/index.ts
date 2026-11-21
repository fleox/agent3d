// Sound preset registry: one SoundImpl per SOUND_PRESETS catalog id, pure
// WebAudio synthesis (no audio file). Music presets loop until stop().

import type { SoundImpl } from "../registry";
import { autoStop, midi, noise, sequence, stopVoice, tone, voice } from "./synth";

const sfx = (dur: number, fn: (v: ReturnType<typeof voice>) => void): SoundImpl => ({
  play(ctx, destination, volume) {
    const v = voice(ctx, destination, volume);
    fn(v);
    return autoStop(v, dur);
  },
});

const coin = sfx(0.4, (v) => {
  tone(v, { type: "square", freq: midi(83), dur: 0.08, gain: 0.18, release: 0.02 });
  tone(v, { type: "square", freq: midi(88), start: 0.075, dur: 0.32, gain: 0.18, release: 0.3 });
  tone(v, { type: "triangle", freq: midi(100), start: 0.075, dur: 0.25, gain: 0.06, release: 0.24 });
});

const jump = sfx(0.3, (v) => {
  tone(v, { type: "square", freq: 220, to: 660, dur: 0.2, gain: 0.16, release: 0.12, filter: { type: "lowpass", freq: 2400 } });
  tone(v, { type: "triangle", freq: 330, to: 990, dur: 0.18, gain: 0.12, release: 0.1 });
});

const hit = sfx(0.3, (v) => {
  noise(v, { dur: 0.16, gain: 0.45, filter: { type: "lowpass", freq: 2200, to: 300, q: 0.7 } });
  tone(v, { type: "sine", freq: 180, to: 55, dur: 0.18, gain: 0.5, release: 0.15 });
  tone(v, { type: "square", freq: 120, to: 60, dur: 0.08, gain: 0.12, release: 0.06 });
});

const explosion = sfx(1.6, (v) => {
  noise(v, { dur: 1.4, gain: 0.7, attack: 0.01, filter: { type: "lowpass", freq: 2600, to: 90, q: 0.8 } });
  noise(v, { dur: 0.25, gain: 0.35, filter: { type: "highpass", freq: 1200, q: 0.5 } });
  tone(v, { type: "sine", freq: 90, to: 28, dur: 1.1, gain: 0.7, release: 1.0 });
  tone(v, { type: "triangle", freq: 60, to: 30, start: 0.05, dur: 0.8, gain: 0.3, release: 0.7 });
});

const click = sfx(0.1, (v) => {
  tone(v, { type: "sine", freq: 1700, to: 900, dur: 0.035, gain: 0.25, release: 0.03 });
  noise(v, { dur: 0.02, gain: 0.12, filter: { type: "highpass", freq: 4000 } });
});

const powerup = sfx(0.8, (v) => {
  const notes = [60, 64, 67, 72, 76, 79, 84];
  notes.forEach((n, i) => {
    tone(v, { type: "square", freq: midi(n), start: i * 0.06, dur: 0.1, gain: 0.13, release: 0.06, filter: { type: "lowpass", freq: 3500 } });
    tone(v, { type: "triangle", freq: midi(n + 12), start: i * 0.06 + 0.02, dur: 0.12, gain: 0.07, release: 0.1 });
  });
  tone(v, { type: "square", freq: midi(84), start: notes.length * 0.06, dur: 0.3, gain: 0.1, release: 0.28, vibrato: { rate: 9, depth: 35 }, filter: { type: "lowpass", freq: 3000 } });
});

const laser = sfx(0.35, (v) => {
  tone(v, { type: "sawtooth", freq: 1800, to: 160, dur: 0.24, gain: 0.16, release: 0.2, filter: { type: "bandpass", freq: 2400, to: 400, q: 2 } });
  tone(v, { type: "square", freq: 1200, to: 120, dur: 0.18, gain: 0.07, release: 0.15 });
});

const win = sfx(1.6, (v) => {
  const seq = [72, 76, 79, 84];
  seq.forEach((n, i) => {
    tone(v, { type: "square", freq: midi(n), start: i * 0.12, dur: 0.14, gain: 0.12, release: 0.08, filter: { type: "lowpass", freq: 3200 } });
    tone(v, { type: "triangle", freq: midi(n - 12), start: i * 0.12, dur: 0.14, gain: 0.15, release: 0.1 });
  });
  const s = seq.length * 0.12 + 0.04;
  for (const n of [79, 84, 88]) tone(v, { type: "square", freq: midi(n), start: s, dur: 0.9, gain: 0.08, attack: 0.01, release: 0.7, vibrato: { rate: 6, depth: 12 }, filter: { type: "lowpass", freq: 2800 } });
  tone(v, { type: "triangle", freq: midi(60), start: s, dur: 0.9, gain: 0.2, release: 0.6 });
});

const lose = sfx(1.6, (v) => {
  [67, 66, 65].forEach((n, i) => tone(v, { type: "sawtooth", freq: midi(n), start: i * 0.25, dur: 0.24, gain: 0.12, release: 0.1, filter: { type: "lowpass", freq: 1400 } }));
  tone(v, { type: "sawtooth", freq: midi(64), to: midi(52), start: 0.75, dur: 0.8, gain: 0.13, release: 0.5, vibrato: { rate: 7, depth: 40 }, filter: { type: "lowpass", freq: 1400, to: 400 } });
  tone(v, { type: "triangle", freq: midi(40), start: 0.75, dur: 0.8, gain: 0.18, release: 0.6 });
});

const whoosh = sfx(0.8, (v) => {
  noise(v, { dur: 0.65, gain: 0.45, attack: 0.25, filter: { type: "bandpass", freq: 300, mid: 2600, to: 500, q: 1.4 } });
  noise(v, { dur: 0.5, gain: 0.15, attack: 0.2, filter: { type: "lowpass", freq: 600, to: 200 } });
});

// Soft evolving pad: detuned saws through a slow lowpass, chords every 4 s.
const ambientPad: SoundImpl = {
  play(ctx, destination, volume) {
    const v = voice(ctx, destination, volume);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 450;
    lfo.connect(lfoG);
    lfoG.connect(lp.frequency);
    lfo.start();
    v.sources.push(lfo);
    // feedback delay "space"
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.42;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    delay.connect(fb);
    fb.connect(delay);
    lp.connect(v.out);
    lp.connect(delay);
    delay.connect(v.out);
    const chords = [
      [48, 55, 59, 64], // Cmaj7
      [45, 52, 55, 60], // Am7
      [41, 48, 52, 57], // Fmaj7
      [43, 50, 55, 59], // G
    ];
    const bar = 4;
    sequence(v, bar, (i, when) => {
      const ch = chords[i % chords.length]!;
      for (const n of ch)
        for (const d of [-7, 7]) tone(v, { type: "sawtooth", freq: midi(n), start: when, dur: bar + 1.6, gain: 0.035, attack: 1.4, release: 1.8, detune: d, dest: lp });
      tone(v, { type: "sine", freq: midi(ch[0]! - 12), start: when, dur: bar + 1.2, gain: 0.12, attack: 1, release: 1.5 });
      // sparkle
      tone(v, { type: "triangle", freq: midi(ch[3]! + 24), start: when + 1.3, dur: 1.5, gain: 0.025, attack: 0.05, release: 1.4, dest: delay });
    });
    return { stop: () => stopVoice(v, 0.8) };
  },
};

// Cheerful chiptune loop: 140 bpm, 16ths, lead + bass + noise hats (C – Am – F – G).
const chiptune: SoundImpl = {
  play(ctx, destination, volume) {
    const v = voice(ctx, destination, volume);
    const lead = [
      72, 0, 76, 79, 84, 0, 79, 76, 77, 0, 76, 74, 72, 0, 74, 76,
      69, 0, 72, 76, 81, 0, 79, 76, 77, 76, 74, 72, 74, 0, 0, 0,
      77, 0, 81, 84, 89, 0, 84, 81, 79, 0, 77, 76, 77, 0, 79, 81,
      79, 0, 83, 86, 91, 0, 86, 83, 84, 0, 83, 81, 79, 0, 74, 0,
    ];
    const roots = [48, 45, 41, 43];
    const step = 60 / 140 / 4;
    sequence(v, step, (i, when) => {
      const s = i % 64;
      const n = lead[s]!;
      if (n) tone(v, { type: "square", freq: midi(n), start: when, dur: step * 1.6, gain: 0.075, release: step * 1.2, filter: { type: "lowpass", freq: 3800 } });
      const root = roots[Math.floor(s / 16)]!;
      if (s % 2 === 0) {
        const bn = root + ((s / 2) % 4 === 3 ? 7 : (s / 2) % 2 ? 12 : 0);
        tone(v, { type: "triangle", freq: midi(bn - 12), start: when, dur: step * 1.8, gain: 0.22, release: step * 1.2 });
      }
      // arpeggio sparkle on off-beats
      if (s % 4 === 2) tone(v, { type: "square", freq: midi(root + 24 + ((s / 4) % 2 ? 4 : 7)), start: when, dur: step * 0.8, gain: 0.03, release: step * 0.6 });
      // drums
      if (s % 4 === 0) tone(v, { type: "sine", freq: 150, to: 45, start: when, dur: 0.12, gain: 0.35, release: 0.1 });
      if (s % 8 === 4) noise(v, { start: when, dur: 0.12, gain: 0.16, filter: { type: "bandpass", freq: 1800, q: 0.8 } });
      if (s % 2 === 1) noise(v, { start: when, dur: 0.035, gain: 0.06, filter: { type: "highpass", freq: 7000 } });
    });
    return { stop: () => stopVoice(v, 0.1) };
  },
};

export const SOUND_IMPLS: Record<string, SoundImpl> = {
  coin,
  jump,
  hit,
  explosion,
  click,
  powerup,
  laser,
  win,
  lose,
  whoosh,
  "ambient-pad": ambientPad,
  "chiptune-loop": chiptune,
};
