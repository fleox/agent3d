// Coin collector — run and jump around a floating arena, grab every coin
// before the timer runs out. Physics: the hero is a dynamic body, platforms
// are static, coins are triggers.
// Controls: arrows / WASD move, Space jumps; touch: hold a finger on the
// side you want to go (relative to the screen centre), tap quickly to jump.
// No input for a while → attract mode (the hero collects coins by itself).

export default function (api) {
  const cfg = Object.assign({ time: 45, speed: 5, jump: 7.2, fallY: -8 }, api.data.collector || {});
  const hero = api.get("hero");
  const coins = api.findByTag("coin");
  const spawn = hero ? [hero.position.x, hero.position.y, hero.position.z] : [0, 1, 0];
  let phase = "attract"; // attract | play | won | over
  let timeLeft = cfg.time;
  let got = new Set();
  let anim = "";
  let endAt = 0;
  let heldSince = -1;
  let jumpCooldown = 0;
  let aiJumping = false;
  let lastGot = 0;
  let lastProgress = 0;
  let best = api.storage.get("bestTime");
  best = typeof best === "number" ? best : null;

  function play(clip) {
    if (anim !== clip && hero) {
      anim = clip;
      hero.playAnimation(clip, { loop: clip !== "jump", crossfade: 0.15 });
    }
  }

  function reset(next) {
    phase = next;
    timeLeft = cfg.time;
    got = new Set();
    for (const c of coins) c.visible = true;
    aiJumping = false;
    lastGot = 0;
    lastProgress = api.time();
    respawn();
    publish();
  }

  function respawn() {
    if (!hero) return;
    hero.position.set(spawn[0], spawn[1], spawn[2]);
    hero.velocity.set(0, 0, 0);
  }

  function publish() {
    api.state.phase = phase;
    api.state.coins = got.size;
    api.state.total = coins.length;
    api.state.time = Math.max(0, Math.ceil(timeLeft));
    api.state.timeBar = Math.max(0, timeLeft / cfg.time);
    api.state.best = best === null ? "—" : best.toFixed(1) + " s";
    api.state.demo = phase === "attract";
  }

  function grounded() {
    if (!hero) return false;
    if (Math.abs(hero.velocity.y) > 0.6) return false;
    return api.physics.contacts(hero).some((o) => o.tags.includes("ground"));
  }

  function nearestCoin() {
    let bestC = null, bestD = Infinity;
    for (const c of coins) {
      if (got.has(c.id)) continue;
      const d = Math.hypot(c.position.x - hero.position.x, c.position.z - hero.position.z) + Math.max(0, c.position.y - hero.position.y) * 2;
      if (d < bestD) { bestD = d; bestC = c; }
    }
    return bestC;
  }

  function input() {
    const i = api.input;
    let x = 0, z = 0, jump = false, any = false;
    if (i.isDown("ArrowLeft") || i.isDown("KeyA")) x -= 1;
    if (i.isDown("ArrowRight") || i.isDown("KeyD")) x += 1;
    if (i.isDown("ArrowUp") || i.isDown("KeyW")) z -= 1;
    if (i.isDown("ArrowDown") || i.isDown("KeyS")) z += 1;
    if (i.pressed("Space")) jump = true;
    // touch / mouse: hold = move toward the finger, quick tap = jump
    const p = i.pointer;
    if (p.justPressed) heldSince = api.time();
    if (p.down && heldSince >= 0 && api.time() - heldSince > 0.18) {
      x += Math.max(-1, Math.min(1, p.x * 2));
      z += Math.max(-1, Math.min(1, -p.y * 2));
    }
    if (!p.down && heldSince >= 0) {
      if (api.time() - heldSince <= 0.18) jump = true;
      heldSince = -1;
    }
    if (i.swipe() === "up") jump = true;
    any = x !== 0 || z !== 0 || jump || i.pressed("Enter");
    return { x, z, jump, any };
  }

  function finish(won) {
    phase = won ? "won" : "over";
    endAt = api.time();
    if (won) {
      const t = cfg.time - timeLeft;
      if (best === null || t < best) {
        best = t;
        api.storage.set("bestTime", best);
        api.ui.toast("New record!", 2);
      }
      api.audio.play("win");
    } else api.audio.play("lose");
    if (hero) hero.velocity.set(0, hero.velocity.y, 0);
    play("idle");
    publish();
  }

  return {
    start() {
      reset("attract");
      play("idle");
    },
    onEvent(name) {
      if (name === "retry") {
        reset("play");
        api.audio.play("click");
      }
    },
    update(dt) {
      if (!hero) return;
      const inp = input();
      if (phase === "attract" && inp.any) {
        reset("play");
        api.audio.play("click");
      }
      if (phase === "won" || phase === "over") {
        if (inp.any && api.time() - endAt > 0.8) reset("play");
        else if (api.time() - endAt > 7) reset("attract");
        return;
      }

      let mx = inp.x, mz = inp.z, wantJump = inp.jump;
      if (phase === "attract") {
        const c = nearestCoin();
        if (c) {
          let tx = c.position.x, tz = c.position.z;
          const high = c.position.y - hero.position.y > 1;
          if (high) {
            // stage on the arena side of the platform, then jump onto it
            const r = Math.hypot(tx, tz) || 1;
            const sx = tx - (tx / r) * 2.4, sz = tz - (tz / r) * 2.4;
            if (Math.hypot(sx - hero.position.x, sz - hero.position.z) > 0.6 && !aiJumping) { tx = sx; tz = sz; }
            else { wantJump = true; aiJumping = true; }
          } else aiJumping = false;
          const dx = tx - hero.position.x, dz = tz - hero.position.z;
          const d = Math.hypot(dx, dz) || 1;
          mx = d > 0.15 ? dx / d : 0;
          mz = d > 0.15 ? dz / d : 0;
        }
        if (got.size !== lastGot) { lastGot = got.size; lastProgress = api.time(); }
        if (api.time() - lastProgress > 8) reset("attract");
      }
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }
      hero.velocity.x = mx * cfg.speed;
      hero.velocity.z = mz * cfg.speed;
      jumpCooldown -= dt;
      const onGround = grounded();
      if (aiJumping && onGround && jumpCooldown < 0) aiJumping = false;
      if (wantJump && onGround && jumpCooldown <= 0) {
        hero.velocity.y = cfg.jump;
        jumpCooldown = 0.3;
        if (phase === "play") api.audio.play("jump");
      }
      if (len > 0.1) hero.rotation.set(0, (Math.atan2(mx, mz) * 180) / Math.PI, 0);
      play(!onGround ? "jump" : len > 0.1 ? "walk" : "idle");

      for (const c of coins) {
        if (got.has(c.id)) continue;
        c.rotation.set(0, api.time() * 140, 0);
        if (api.physics.overlaps(hero, c)) {
          got.add(c.id);
          c.visible = false;
          if (phase === "play") api.audio.play("coin");
        }
      }
      if (hero.position.y < cfg.fallY) {
        respawn();
        if (phase === "play") api.ui.toast("Oops! Back to start", 1.2);
      }
      if (phase === "play") {
        timeLeft -= dt;
        if (got.size === coins.length) finish(true);
        else if (timeLeft <= 0) finish(false);
      } else if (got.size === coins.length) {
        reset("attract");
      }
      publish();
    },
  };
}
