import { describe, expect, it } from "vitest";
import { evaluate, formatText, isVisible, lookup, tokenize } from "./expr";

const state = { phase: "over", score: 12, lives: 0, player: { name: "Ada" }, ok: true };

describe("HUD expressions", () => {
  it("compares state values", () => {
    expect(evaluate("state.phase == 'over'", state)).toBe(true);
    expect(evaluate("phase != \"over\"", state)).toBe(false);
    expect(evaluate("score >= 10 && lives <= 0", state)).toBe(true);
    expect(evaluate("!(score > 100) || false", state)).toBe(true);
    expect(evaluate("score === 12", state)).toBe(true);
    expect(evaluate("lives > -1", state)).toBe(true);
    expect(evaluate("player.name == 'Ada'", state)).toBe(true);
  });
  it("never reaches prototypes or globals", () => {
    expect(lookup(state, "constructor")).toBeUndefined();
    expect(lookup(state, "player.__proto__")).toBeUndefined();
    expect(evaluate("toString", state)).toBeUndefined();
    expect(() => tokenize("alert(1); x = 2")).toThrow();
    expect(isVisible("window.alert(1)", state)).toBe(false);
  });
  it("visible accepts booleans, keys and expressions", () => {
    expect(isVisible(undefined, state)).toBe(true);
    expect(isVisible(false, state)).toBe(false);
    expect(isVisible("ok", state)).toBe(true);
    expect(isVisible("missing", state)).toBe(false);
    expect(isVisible("phase == 'play'", state)).toBe(false);
    expect(isVisible("phase ==", state)).toBe(false);
  });
  it("formats placeholders", () => {
    expect(formatText("Score: {score} / {state.lives} ♥ {player.name}", state)).toBe("Score: 12 / 0 ♥ Ada");
    expect(formatText("{missing}!", state)).toBe("!");
    expect(formatText("{score > 10}", state)).toBe("true");
    expect(formatText("{x}", { x: 1.23456 })).toBe("1.23");
  });
});
