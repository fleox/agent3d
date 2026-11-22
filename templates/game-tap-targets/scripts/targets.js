// Tap targets — 30-second rounds: targets pop out of 9 holes, tap / click
// them before they hide. Fast consecutive hits build a combo multiplier,
// golden targets are worth 5×, missing (tapping nothing) breaks the combo.
// Keyboard: keys 1–9 (numpad layout: 7 8 9 top row) hit the matching hole.
// No input → attract mode: an autopilot taps targets so the embed is alive.

export default function (api) {
  const cfg = Object.assign({ round: 30, upTime: 1.3, minUpTime: 0.6, spawnEvery: 0.7, minSpawnEvery: 0.35, comboWindow: 1.2, goldChance: 0.12 }, api.data.targets || {});
  const holes = [];
  for (let i = 0; i < 9; i++) {
    const o = api.get("target" + i);
    if (o) holes.push({ o, i, up: false, k: 0, until: 0, gold: false, hitAt: -1, baseY: o.position.y });
  }
  const keyMap = { Digit7: 0, Digit8: 1, Digit9: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit1: 6, Digit2: 7, Digit3: 8, Numpad7: 0, Numpad8: 1, Numpad9: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5, Numpad1: 6, Numpad2: 7, Numpad3: 8 };

  let phase = "attract"; // attract | play | over
  let timeLeft = cfg.round;
  let score = 0, combo = 0, lastHit = -10, hits = 0, misses = 0;
  let nextSpawn = 0.5, overAt = 0, aiNext = 0;
  let best = Number(api.storage.get("best") || 0);

  function publish() {
    api.state.phase = phase;
    api.state.score = score;
    api.state.combo = combo > 1 ? "x" + combo : "";
    api.state.time = Math.max(0, Math.ceil(timeLeft));
    api.state.timeBar = Math.max(0, timeLeft / cfg.round);
    api.state.best = best;
    api.state.hits = hits;
    api.state.demo = phase === "attract";
  }

  function reset(next) {
    phase = next;
    timeLeft = cfg.round;
    score = 0; combo = 0; hits = 0; misses = 0; lastHit = -10;
    nextSpawn = 0.6;
    for (const h of holes) { h.up = false; h.k = 0; h.hitAt = -1; }
    publish();
  }

  // Difficulty ramps through the round (0 → 1).
  const ramp = () => 1 - Math.max(0, timeLeft) / cfg.round;

  function spawn() {
    const free = holes.filter((h) => !h.up && h.k <= 0.01);
    if (!free.length) return;
    const h = free[Math.floor(api.random() * free.length)];
    h.up = true;
    h.gold = api.random() < cfg.goldChance;
    h.until = api.time() + cfg.upTime - (cfg.upTime - cfg.minUpTime) * ramp();
    h.hitAt = -1;
    h.upAt = api.time();
    h.o.setColor(h.gold ? "#ffd166" : "#ffffff");
  }

  function hit(h) {
    if (!h.up || h.k < 0.4) return false;
    h.up = false;
    h.hitAt = api.time();
    const now = api.time();
    combo = now - lastHit <= cfg.comboWindow ? Math.min(combo + 1, 8) : 1;
    lastHit = now;
    hits++;
    score += (h.gold ? 5 : 1) * combo * 10;
    if (phase === "play") api.audio.play(h.gold ? "powerup" : "coin");
    if (combo >= 4 && combo % 2 === 0 && phase === "play") api.ui.toast("Combo x" + combo + "!", 0.8);
    return true;
  }

  function miss() {
    combo = 0;
    misses++;
    if (phase === "play") api.audio.play("click");
  }

  function holeFromId(id) {
    if (!id) return null;
    const m = /^target(\d)/.exec(id);
    return m ? holes.find((h) => h.i === Number(m[1])) || null : null;
  }

  return {
    start() {
      reset("attract");
    },
    onEvent(name) {
      if (name === "retry") reset("play");
    },
    update(dt) {
      const now = api.time();
      const inp = api.input;
      let tapped = false, tapHole = null;
      if (inp.pointer.justPressed) {
        tapped = true;
        const pw = inp.pointerWorld();
        tapHole = holeFromId(pw && pw.objectId);
      }
      for (const code in keyMap) if (inp.pressed(code)) { tapped = true; tapHole = holes[keyMap[code]] || null; }
      if (inp.pressed("Space") || inp.pressed("Enter")) tapped = true;

      if (phase === "attract" && tapped) {
        reset("play");
        api.audio.play("click");
        tapped = false;
      }
      if (phase === "over") {
        if (tapped && now - overAt > 1) reset("play");
        else if (now - overAt > 7) reset("attract");
      }

      // Targets animation (pop up / down, hit squash).
      for (const h of holes) {
        if (h.up && now > h.until) {
          h.up = false;
          if (phase === "play") combo = 0;
        }
        const target = h.up ? 1 : 0;
        h.k += (target - h.k) * Math.min(1, dt * (h.up ? 14 : 10));
        const s = Math.max(0.001, h.k);
        const squash = h.hitAt >= 0 && now - h.hitAt < 0.25 ? 1 + Math.sin(((now - h.hitAt) / 0.25) * Math.PI) * 0.35 : 1;
        h.o.scale.set(s * squash, s / squash, s * squash);
        h.o.position.y = h.baseY - (1 - h.k) * 0.9;
        h.o.visible = h.k > 0.02;
      }

      if (phase === "over") { publish(); return; }

      if (phase === "play") {
        if (tapped) { if (!(tapHole && hit(tapHole))) miss(); }
        timeLeft -= dt;
        if (timeLeft <= 0) {
          phase = "over";
          overAt = now;
          for (const h of holes) h.up = false;
          if (score > best) { best = score; api.storage.set("best", best); api.ui.toast("New best score!", 2); }
          api.audio.play("win");
          publish();
          return;
        }
      } else {
        // attract: the autopilot taps a raised target now and then
        if (now >= aiNext) {
          const up = holes.filter((h) => h.up && now - h.upAt > 0.5);
          if (up.length) { hit(up[Math.floor(api.random() * up.length)]); aiNext = now + 0.45 + api.random() * 0.5; }
        }
        timeLeft = cfg.round;
      }

      nextSpawn -= dt;
      if (nextSpawn <= 0) {
        spawn();
        if (api.random() < 0.25 + ramp() * 0.35) spawn();
        nextSpawn = cfg.spawnEvery - (cfg.spawnEvery - cfg.minSpawnEvery) * ramp();
      }
      publish();
    },
  };
}
