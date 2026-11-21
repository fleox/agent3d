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
});
