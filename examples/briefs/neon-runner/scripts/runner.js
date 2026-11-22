// Endless runner — 3 lanes, barriers to dodge or jump, coins to grab.
// Controls: ←/→ (A/D) change lane, ↑ / Space (W) jump; touch: tap the left /
// right half to change lane, swipe up to jump (swipes left/right work too).
// With no input the game plays itself (attract mode) so the embed is alive.
// Only `api` is used (Agent3D ScriptApi) — no DOM, no globals.

export default function (api) {
  const cfg = Object.assign(
    { startSpeed: 11, maxSpeed: 30, accel: 0.35, spawnZ: -70, despawnZ: 8, jumpTime: 0.62, jumpHeight: 1.6, coinValue: 10 },
    api.data.runner || {},
  );
  const road = api.get("road");
  const runner = api.get("runner");
  const barriers = api.findByTag("barrier");
  const coins = api.findByTag("coin");
  const laneWidth = 2;
  const laneX = (i) => (i - 1) * laneWidth;

  let phase = "attract"; // attract | play | over
  let lane = 1;
  let x = 0;
  let jumpT = -1;
  let speed = cfg.startSpeed;
  let distance = 0;
  let coinCount = 0;
  let overAt = 0;
  let pendingTap = null; // { side, at }
  let nextSpawn = 0;
  let aiCooldown = 0;
  let best = Number(api.storage.get("best") || 0);

  const items = [];
  barriers.forEach((o) => items.push({ o, kind: "barrier", active: false, lane: 1, z: 0 }));
  coins.forEach((o) => items.push({ o, kind: "coin", active: false, lane: 1, z: 0 }));

  function hideAll() {
    for (const it of items) {
      it.active = false;
      it.o.visible = false;
      it.o.position.set(0, -10, 0);
    }
  }

  function take(kind) {
    return items.find((it) => it.kind === kind && !it.active) || null;
  }

  // One "row" of content at z: a barrier in 1–2 lanes, coins in a free lane.
  function spawnRow(z) {
    const blocked = [];
    const nBlock = api.random() < 0.35 ? 2 : 1;
    while (blocked.length < nBlock) {
      const l = Math.floor(api.random() * 3);
      if (!blocked.includes(l)) blocked.push(l);
    }
    for (const l of blocked) {
      const it = take("barrier");
      if (!it) break;
      it.active = true;
      it.lane = l;
      it.z = z;
      it.o.visible = true;
      it.o.position.set(laneX(l), 0, z);
    }
    const free = [0, 1, 2].filter((l) => !blocked.includes(l));
    const cl = free[Math.floor(api.random() * free.length)];
    for (let k = 0; k < 3; k++) {
      const it = take("coin");
      if (!it) break;
      it.active = true;
      it.lane = cl;
      it.z = z - 3 - k * 2.2;
      it.o.visible = true;
      it.o.position.set(laneX(cl), 0.8, it.z);
    }
  }

  function reset(next) {
    phase = next;
    lane = 1;
    x = 0;
    jumpT = -1;
    speed = cfg.startSpeed;
    distance = 0;
    coinCount = 0;
    nextSpawn = 14;
    pendingTap = null;
    hideAll();
    for (let z = -26; z > cfg.spawnZ; z -= 16) spawnRow(z);
    publish();
  }

  function publish() {
    api.state.phase = phase;
    api.state.score = Math.floor(distance) + coinCount * cfg.coinValue;
    api.state.coins = coinCount;
    api.state.best = best;
    api.state.speed = Math.round(speed);
    api.state.demo = phase === "attract";
    api.state.lane = lane;
  }

  function jump() {
    if (jumpT < 0) {
      jumpT = 0;
      if (phase === "play") api.audio.play("jump");
    }
  }

  function move(dir) {
    const nl = Math.max(0, Math.min(2, lane + dir));
    if (nl !== lane) {
      lane = nl;
      if (phase === "play") api.audio.play("whoosh");
    }
  }

  function startPlay() {
    reset("play");
    api.audio.play("click");
  }

  function gameOver() {
    phase = "over";
    overAt = api.time();
    api.camera.shake(0.25, 0.4);
    api.audio.play("lose");
    const score = Math.floor(distance) + coinCount * cfg.coinValue;
    if (score > best) {
      best = score;
      api.storage.set("best", best);
      api.ui.toast("New best score!", 2);
    }
    publish();
  }

  // Simple autopilot for the attract mode: leave a lane with a barrier ahead.
  function autopilot(dt) {
    aiCooldown -= dt;
    if (aiCooldown > 0) return;
    const danger = (l) => items.some((it) => it.active && it.kind === "barrier" && it.lane === l && it.z < 1 && it.z > -14);
    if (danger(lane)) {
      const options = [lane - 1, lane + 1].filter((l) => l >= 0 && l <= 2 && !danger(l));
      if (options.length) move(options[0] - lane);
      else jump();
      aiCooldown = 0.25;
      return;
    }
    const coinAhead = items.find((it) => it.active && it.kind === "coin" && it.z < -2 && it.z > -16);
    if (coinAhead && coinAhead.lane !== lane && !danger(coinAhead.lane) && Math.abs(coinAhead.lane - lane) === 1) {
      move(coinAhead.lane - lane);
      aiCooldown = 0.4;
    }
  }

  function readInput() {
    const inp = api.input;
    const actions = { left: false, right: false, jump: false, any: false };
    if (inp.pressed("ArrowLeft") || inp.pressed("KeyA")) actions.left = true;
    if (inp.pressed("ArrowRight") || inp.pressed("KeyD")) actions.right = true;
    if (inp.pressed("ArrowUp") || inp.pressed("KeyW") || inp.pressed("Space")) actions.jump = true;
    if (inp.pressed("Enter")) actions.any = true;
    const sw = inp.swipe();
    if (sw) {
      pendingTap = null;
      if (sw === "left") actions.left = true;
      if (sw === "right") actions.right = true;
      if (sw === "up") actions.jump = true;
    }
    if (inp.pointer.justPressed) pendingTap = { side: inp.pointer.x < 0 ? -1 : 1, at: api.time() };
    if (pendingTap && api.time() - pendingTap.at > 0.14) {
      if (pendingTap.side < 0) actions.left = true;
      else actions.right = true;
      pendingTap = null;
    }
    actions.any = actions.any || actions.left || actions.right || actions.jump;
    return actions;
  }

  return {
    start() {
      hideAll();
      reset("attract");
    },

    onEvent(name) {
      if (name === "retry" || name === "play") startPlay();
    },

    update(dt) {
      const a = readInput();
      if (phase === "attract" && a.any) {
        startPlay();
        return;
      }
      if (phase === "over") {
        if (a.any && api.time() - overAt > 0.6) startPlay();
        else if (api.time() - overAt > 6) reset("attract");
        return;
      }

      if (phase === "play") {
        if (a.left) move(-1);
        if (a.right) move(1);
        if (a.jump) jump();
      } else autopilot(dt);

      speed = Math.min(cfg.maxSpeed, speed + cfg.accel * dt * (phase === "play" ? 1 : 0.3));
      if (road) road.userData.speed = speed;
      distance += speed * dt * 0.5;

      // Runner: lane easing + jump arc + lean.
      const tx = laneX(lane);
      x += (tx - x) * Math.min(1, dt * 14);
      let y = 0;
      if (jumpT >= 0) {
        jumpT += dt;
        const k = jumpT / cfg.jumpTime;
        if (k >= 1) jumpT = -1;
        else y = Math.sin(k * Math.PI) * cfg.jumpHeight;
      }
      if (runner) {
        runner.position.set(x, y, 0);
        runner.rotation.set(0, 180, (tx - x) * -10);
      }
      api.camera.position.x += (x * 0.45 - api.camera.position.x) * Math.min(1, dt * 4);

      // World scroll.
      nextSpawn -= speed * dt;
      if (nextSpawn <= 0) {
        spawnRow(cfg.spawnZ);
        nextSpawn = 14 + api.random() * 6;
      }
      for (const it of items) {
        if (!it.active) continue;
        it.z += speed * dt;
        if (it.kind === "coin") it.o.rotation.set(90, 0, api.time() * 240);
        it.o.position.z = it.z;
        if (it.z > cfg.despawnZ) {
          it.active = false;
          it.o.visible = false;
          continue;
        }
        if (it.lane !== lane || Math.abs(it.z) > 0.7) continue;
        if (it.kind === "coin") {
          it.active = false;
          it.o.visible = false;
          coinCount++;
          if (phase === "play") api.audio.play("coin");
        } else if (y < 0.75) {
          if (phase === "play") {
            gameOver();
            return;
          }
          // attract mode never loses: the barrier just vanishes
          it.active = false;
          it.o.visible = false;
        }
      }
      publish();
    },
  };
}
