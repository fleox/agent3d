// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createHud } from "./hud";

describe("HUD", () => {
  it("renders anchored elements, placeholders, visibility, bars and buttons", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const actions: string[] = [];
    const hud = createHud(
      container,
      {
        elements: [
          { id: "score", type: "text", text: "Score: {score}", anchor: "top-left", style: "pill" },
          { id: "over", type: "text", text: "Game over", anchor: "center", style: "title", visible: "phase == 'over'" },
          { id: "hp", type: "bar", value: "hp", anchor: "top-right" },
          { id: "retry", type: "button", text: "Retry", action: "restart", anchor: "bottom" },
        ],
      },
      (a) => actions.push(a),
    );
    hud.update({ score: 3, phase: "play", hp: 0.25 }, 0);
    const q = (id: string) => container.querySelector(`[data-id="${id}"]`) as HTMLElement;
    expect(q("score").textContent).toBe("Score: 3");
    expect(q("over").style.display).toBe("none");
    expect((q("hp").firstChild as HTMLElement).style.width).toBe("25.0%");
    hud.update({ score: 9, phase: "over", hp: 2 }, 0.1);
    expect(q("score").textContent).toBe("Score: 9");
    expect(q("over").style.display).toBe("");
    expect((q("hp").firstChild as HTMLElement).style.width).toBe("100.0%");
    q("retry").textContent = "Retry";
    (q("retry") as HTMLButtonElement).click();
    expect(actions).toEqual(["restart"]);
    hud.set("score", { text: "Custom" });
    hud.update({ score: 1 }, 0.2);
    expect(q("score").textContent).toBe("Custom");
    hud.toast("Hello", 1);
    hud.update({}, 0.3);
    expect(container.querySelector(".a3d-toast")?.textContent).toBe("Hello");
    let toggled = 0;
    hud.setMuteButton(true, () => toggled++);
    (container.querySelector(".a3d-mute") as HTMLButtonElement).click();
    expect(toggled).toBe(1);
    hud.dispose();
    expect(container.querySelector(".a3d-hud")).toBeNull();
  });

  it("lays anchors out on a 3 × 3 grid (no overlaps) and stacks the mute button in the bottom-right zone", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const hud = createHud(
      container,
      {
        elements: [
          { id: "a", type: "text", text: "Left", anchor: "bottom-left" },
          { id: "b", type: "button", text: "Play", action: "play", anchor: "bottom" },
          { id: "c", type: "text", text: "Best 3", anchor: "bottom-right" },
          { id: "d", type: "text", text: "Game over", anchor: "center", style: "title" },
        ],
      },
      () => undefined,
    );
    const zone = (anchor: string) => container.querySelector(`.a3d-zone[data-anchor="${anchor}"]`) as HTMLElement;
    expect([zone("bottom-left").style.gridRow, zone("bottom-left").style.gridColumn]).toEqual(["3", "1"]);
    expect([zone("bottom").style.gridRow, zone("bottom").style.gridColumn]).toEqual(["3", "2"]);
    expect([zone("bottom-right").style.gridRow, zone("bottom-right").style.gridColumn]).toEqual(["3", "3"]);
    // Alone in its row, the centre anchor spans it.
    expect(zone("center").style.gridColumn).toMatch(/^1 ?\/ ?-1$/);
    const css = container.querySelector(".a3d-hud style")!.textContent!;
    expect(css).toContain("container-type:size");
    expect(css).toMatch(/\.a3d-title\{font-size:44px;font-size:clamp\(20px,min\(7cqw/);
    hud.setMuteButton(false, () => undefined);
    const mute = container.querySelector(".a3d-mute")!;
    expect(mute.parentElement).toBe(zone("bottom-right"));
    expect(mute.previousElementSibling?.getAttribute("data-id")).toBe("c");
    hud.dispose();
  });
});
