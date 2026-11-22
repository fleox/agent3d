// Sky Hop — a side-scrolling platformer on the physics character controller.
// The hero is a dynamic capsule with `character: true`: api.physics.moveCharacter
// steers it, api.physics.jump gives coyote-time jumps. Two kinematic lifts
// (`mover` tag) are moved here every step and carry the hero. Coins are
// collected by distance, the flag ends the level. Falling costs a life.
// Controls: ← → / A D run, Space / W / ↑ jump. Touch: hold the left or right
// third of the screen to run, tap the middle (or swipe up) to jump.
// Attract mode: an autopilot runs the level (jumping at data.aiJumps).

export default function (api) {
  const cfg = Object.assign({ speed: 6.5, jump: 10.2, lives: 3, fallY: -6, time: 90, aiJumps: [] }, api.data.platformer || {});
  const hero = api.get("hero");
  const flag = api.get("flag");
  const coins = api.findByTag("coin");
  const moverX = api.get("moverX");
  const moverY = api.get("moverY");
  const baseX = moverX ? moverX.position.x : 0;
  const baseY = moverY ? moverY.position.y : 0;
  const spawn = hero ? [hero.position.x, hero.position.y + 0.5, 0] : [0, 1, 0];
  const coinBase = coins.map((c) => c.position.y);

  let phase = "attract"; // attract | play | won | over
  let lives = cfg.lives;
  let timeLeft = cfg.time;
  let got = new Set();
  let checkpoint = spawn.slice();
  let facing = 1;
  let anim = "";
  let endAt = 0;
  let heldSince = -1;
  let lastMovers = { x: baseX, y: baseY };
  let result = "";
  let stuck = 0;
  let best = api.storage.get("bestTime");
  best = typeof best === "number" ? best : null;

  function play(clip, loop = true) {
    if (anim !== clip && hero) {
      anim = clip;
      hero.playAnimation(clip, { loop, crossfade: 0.12 });
    }
  }

  function publish() {
    api.state.phase = phase;
    api.state.coins = got.size;
    api.state.total = coins.length;
    api.state.time = Math.max(0, Math.ceil(timeLeft));
    api.state.hearts = "♥".repeat(Math.max(0, lives)) + "♡".repeat(Math.max(0, cfg.lives - lives));
    api.state.lives = lives;
    api.state.best = best === null ? "—" : best.toFixed(1) + " s";
    api.state.result = result;
    api.state.x = hero ? Math.round(hero.position.x * 10) / 10 : 0;
  }

  function respawn(at) {
    if (!hero) return;
    hero.position.set(at[0], at[1], 0);
    api.physics.setVelocity(hero, [0, 0, 0]);
  }

  function reset(next) {
    phase = next;
    lives = cfg.lives;
    timeLeft = cfg.time;
    got = new Set();
    checkpoint = spawn.slice();
    result = "";
    stuck = 0;
    for (const c of coins) c.visible = true;
    respawn(spawn);
    publish();
  }

  function finish(won) {
    phase = won ? "won" : "over";
    endAt = api.time();
    if (won) {
      const t = cfg.time - timeLeft;
      result = t.toFixed(1) + " s";
      if (best === null || t < best) {
        best = t;
        api.storage.set("bestTime", best);
        api.ui.toast("New record!", 2);
      }
      api.audio.play("win");
      play("Cheer");
    } else {
      api.audio.play("lose");
      respawn(checkpoint);
      play("Death_A", false);
    }
    api.physics.setVelocity(hero, [0, hero.velocity.y, 0]);
    publish();
  }

  function readInput() {
    const i = api.input;
    let x = 0, jump = false;
    if (i.isDown("ArrowLeft") || i.isDown("KeyA")) x -= 1;
    if (i.isDown("ArrowRight") || i.isDown("KeyD")) x += 1;
    if (i.pressed("Space") || i.pressed("ArrowUp") || i.pressed("KeyW")) jump = true;
    const p = i.pointer;
    if (p.justPressed) {
      heldSince = api.time();
      if (Math.abs(p.x) < 0.33) jump = true; // middle third = jump
    }
    if (p.down && Math.abs(p.x) >= 0.33) x += p.x > 0 ? 1 : -1; // side thirds = run
    if (!p.down) heldSince = -1;
    if (i.swipe() === "up") jump = true;
    const any = x !== 0 || jump || i.pressed("Enter");
    return { x: Math.max(-1, Math.min(1, x)), jump, any };
  }

  function autopilot() {
    let x = 1, jump = false;
    const hx = hero.position.x;
        for (const [jx] of cfg.aiJumps) if (hx > jx - 0.35 && hx < jx + 0.15) jump = true;
    // wait at the edge for the lift, then ride it until it reaches the far side
    if (moverX && hx > 18.6 && hx < 19.0 && Math.abs(moverX.position.x - 20.4) > 0.4) { x = 0; jump = false; }
    const onX = moverX && Math.abs(hx - moverX.position.x) < 1.15 && hero.position.y > moverX.position.y - 0.25;
    if (onX) {
      jump = false;
      if (moverX.position.x < baseX + 1.2) x = Math.max(-1, Math.min(1, (moverX.position.x - hx) * 2));
      else if (hx > moverX.position.x + 0.5) jump = true;
    }
    if (moverY && hx > 31.7 && hx < 32.3 && moverY.position.y > baseY + 0.12) { x = 0; jump = false; }
    const onY = moverY && Math.abs(hx - moverY.position.x) < 1.15 && hero.position.y > moverY.position.y - 0.25;
    if (onY) {
      jump = false;
      if (moverY.position.y < baseY + 2.85) x = Math.max(-1, Math.min(1, (moverY.position.x - hx) * 2));
      else if (hx > moverY.position.x + 0.5) jump = true;
    }
    return { x, jump };
  }

  function moveLifts(t) {
    if (moverX) moverX.position.set(baseX + Math.sin(t * 0.9) * 1.6, moverX.position.y, 0);
    if (moverY) moverY.position.set(moverY.position.x, baseY + 1.5 - Math.cos(t * 0.8) * 1.5, 0);
  }

  // Carry the hero with the lift it stands on (the controller has no friction).
  function ride() {
    const hit = api.physics.raycast([hero.position.x, hero.position.y + 0.3, 0], [0, -1, 0], 0.6, { ignore: [hero], triggers: false });
    if (!hit) return;
    if (hit.objectId === "moverX") hero.position.set(hero.position.x + (moverX.position.x - lastMovers.x), hero.position.y, 0);
    if (hit.objectId === "moverY" && moverY.position.y > lastMovers.y) hero.position.set(hero.position.x, hero.position.y + (moverY.position.y - lastMovers.y), 0);
  }

  return {
    start() {
      reset(api.data.startPhase || "attract");
      play("Idle");
    },
    onEvent(name) {
      if (name === "retry" || name === "start") {
        reset("play");
        api.audio.play("click");
      }
    },
    update(dt, t) {
      if (!hero) return;
      if (moverX) lastMovers.x = moverX.position.x;
      if (moverY) lastMovers.y = moverY.position.y;
      moveLifts(t);
      for (let k = 0; k < coins.length; k++) {
        const c = coins[k];
        c.rotation.set(0, t * 160, 0);
        c.position.set(c.position.x, coinBase[k] + Math.sin(t * 2.4 + k) * 0.08, 0);
      }
      const inp = readInput();
      if (phase === "attract" && inp.any) {
        reset("play");
        api.audio.play("click");
      }
      if (phase === "won" || phase === "over") {
        if (inp.jump && api.time() - endAt > 0.8) reset("play");
        else if (api.time() - endAt > 6) reset("attract");
        api.physics.moveCharacter(hero, { x: 0, z: 0 }, { speed: cfg.speed });
        publish();
        return;
      }

      const ctl = phase === "play" ? inp : autopilot();
      ride();
      api.physics.moveCharacter(hero, { x: ctl.x, z: 0 }, { speed: cfg.speed, acceleration: 45, airControl: 0.6 });
      // keep the run on the z = 0 plane (steer back instead of teleporting every step)
      if (Math.abs(hero.position.z) > 0.005) hero.velocity.z = -hero.position.z * 8;
      const onGround = api.physics.grounded(hero);
      if (ctl.jump && api.physics.jump(hero, cfg.jump) && phase === "play") api.audio.play("jump");
      if (ctl.x !== 0) facing = ctl.x > 0 ? 1 : -1;
      hero.rotation.set(0, facing > 0 ? 90 : -90, 0);
      play(!onGround ? "Jump_Full_Short" : Math.abs(hero.velocity.x) > 0.5 ? "Running_A" : "Idle");
      if (onGround && hero.position.y > -0.5) {
        if (hero.position.x > checkpoint[0] + 6) checkpoint = [hero.position.x, hero.position.y + 0.5, 0];
      }

      for (const c of coins) {
        if (!c.visible) continue;
        const dx = c.position.x - hero.position.x, dy = c.position.y - (hero.position.y + 0.7);
        if (dx * dx + dy * dy < 0.7) {
          got.add(c.id);
          c.visible = false;
          if (phase === "play") api.audio.play("coin");
        }
      }

      if (hero.position.y < cfg.fallY) {
        if (phase === "play") {
          lives -= 1;
          api.audio.play("hurt");
          api.camera.shake(0.25, 0.3);
          if (lives <= 0) { finish(false); return; }
          api.ui.toast("Ouch!", 0.9);
        }
        respawn(checkpoint);
      }

      if (flag && hero.position.x > flag.position.x - 0.6 && hero.position.y > flag.position.y - 0.5) {
        if (phase === "play") { finish(true); return; }
        reset("attract");
      }
      if (phase === "play") {
        timeLeft -= dt;
        if (timeLeft <= 0) finish(false);
      } else {
        stuck = Math.abs(hero.velocity.x) < 0.2 ? stuck + dt : 0;
        if (stuck > 12) { stuck = 0; reset("attract"); }
      }
      publish();
    },
  };
}
