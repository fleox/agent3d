import { describe, expect, it, vi } from "vitest";
import { SOUND_PRESETS } from "../../core/catalog";
import { SOUND_IMPLS } from "./index";

// Minimal fake WebAudio graph: records node creation and scheduling calls.
function fakeContext() {
  const created: string[] = [];
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const node = (kind: string) => {
    created.push(kind);
    return { connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), gain: param(), frequency: param(), detune: param(), Q: param(), delayTime: param(), type: "", buffer: null, loop: false };
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 8000,
    createGain: () => node("gain"),
    createOscillator: () => node("osc"),
    createBiquadFilter: () => node("filter"),
    createBufferSource: () => node("noise"),
    createDelay: () => node("delay"),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  };
  return { ctx: ctx as unknown as AudioContext, created };
}

describe("sound presets", () => {
  it("cover the catalog", () => {
    expect(Object.keys(SOUND_IMPLS).sort()).toEqual(SOUND_PRESETS.map((s) => s.id).sort());
  });
  for (const s of SOUND_PRESETS) {
    it(`${s.id} plays and stops`, () => {
      vi.useFakeTimers();
      const { ctx, created } = fakeContext();
      const dest = { connect: vi.fn() } as unknown as AudioNode;
      const h = SOUND_IMPLS[s.id]!.play(ctx, dest, 0.5);
      expect(created.filter((k) => k === "osc" || k === "noise").length).toBeGreaterThan(0);
      vi.advanceTimersByTime(500);
      expect(() => h.stop()).not.toThrow();
      expect(() => h.stop()).not.toThrow();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    });
  }
});
