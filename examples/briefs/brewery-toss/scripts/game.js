// Hopfield Can Toss: tap / click to throw a ball at the point under the pointer.
// Every can knocked off the counter scores 1; when all are down the stack is
// rebuilt. 30 s rounds, best score saved. phase: ready (autopilot) -> play -> over.
export default function (api) {
  const { launch, flight, roundTime, counterTop } = api.data;
  const cans = api.findByTag("can").map((o) => ({ o, p: [o.position.x, o.position.y, o.position.z], down: false }));
  let balls = [];
  let n = 0;
  let nextAuto = 0.5;
  let endsAt = 0;
  let overAt = 0;
  let lastHit = -1;
  let restackAt = -1; // pending rebuild once the knocked cans had time to fly off

  // A can counts once it left the counter top or lies tipped over (> 60 degrees).
  const tipped = (c) => Math.abs(c.o.rotation.x) > 60 && Math.abs(c.o.rotation.x) < 120 || Math.abs(c.o.rotation.z) > 60 && Math.abs(c.o.rotation.z) < 120;
  const fell = (c) => c.o.position.y < counterTop - 0.05 || Math.abs(c.o.position.z) > 1.15 || Math.abs(c.o.position.x) > 3.5 || tipped(c);

  function restack() {
    for (const c of cans) {
      c.o.position.set(c.p[0], c.p[1], c.p[2]);
      c.o.rotation.set(0, 0, 0);
      api.physics.setVelocity(c.o, [0, 0, 0]);
      api.physics.setAngularVelocity(c.o, [0, 0, 0]);
      api.physics.wake(c.o);
      c.down = false;
      c.o.visible = true;
    }
  }
  function clearBalls() { for (const b of balls) b.remove(); balls = []; }

  function reset(phase) {
    restack();
    clearBalls();
    restackAt = -1;
    api.state.phase = phase;
    api.state.score = 0;
    api.state.best = Number(api.storage.get("best") ?? 0);
    api.state.timeLeft = roundTime;
    endsAt = api.time() + roundTime;
    nextAuto = api.time() + 0.5;
  }

  function throwAt(target) {
    const ball = api.clone("ballProto", { id: "ball" + n++, position: launch });
    ball.visible = true;
    const T = flight;
    api.physics.setVelocity(ball, [(target[0] - launch[0]) / T, (target[1] - launch[1]) / T + 4.905 * T, (target[2] - launch[2]) / T]);
    balls.push(ball);
    if (balls.length > 5) balls.shift().remove();
    if (api.state.phase === "play") api.audio.play("throw");
  }

  function aim() {
    const hit = api.input.pointerWorld();
    if (hit && hit.objectId && hit.objectId !== "floor" && hit.objectId !== "wall") return [hit.x, hit.y, hit.z];
    // Missed every body: aim at a vertical plane through the stack.
    return [api.input.pointer.x * 4, 2.2 + api.input.pointer.y * 2, 0];
  }

  function gameOver() {
    api.state.phase = "over";
    clearBalls();
    for (const c of cans) c.o.visible = false; // clean backdrop for the result
    overAt = api.time();
    const best = Math.max(Number(api.state.best), Number(api.state.score));
    api.state.best = best;
    api.storage.set("best", best);
    api.audio.play("end");
    api.camera.shake(0.15, 0.3);
  }

  return {
    start() {
      api.physics.onCollision((a, b, info) => {
        if (api.state.phase !== "play" || info.impulse < 1 || api.time() - lastHit < 0.08) return;
        lastHit = api.time();
        api.audio.play("hit");
      });
      reset(api.data.startPhase ?? "ready");
      if (api.state.phase === "over") overAt = -10;
    },
    onEvent(name) {
      if (name === "start" || name === "retry") reset("play");
    },
    update() {
      const t = api.time();
      const phase = api.state.phase;
      const tapped = api.input.pointer.justPressed || api.input.pressed("Space");

      // Count cans that left the counter.
      for (const c of cans) {
        if (!c.down && fell(c)) {
          c.down = true;
          if (phase === "play") { api.state.score = Number(api.state.score) + 1; api.audio.play("point"); }
        }
      }
      const allDown = cans.every((c) => c.down);

      if (phase === "ready") {
        if (tapped) { reset("play"); return; } // first tap starts the round (touch friendly)
        if (t >= nextAuto) {
          const standing = cans.filter((c) => !c.down);
          if (!standing.length) { restack(); nextAuto = t + 0.8; }
          else {
            const c = standing[Math.floor(api.random() * standing.length)];
            throwAt([c.o.position.x, c.o.position.y, c.o.position.z]);
            nextAuto = t + 1.3;
          }
        }
      } else if (phase === "play") {
        if (tapped) throwAt(aim());
        if (allDown && restackAt < 0) { api.ui.toast("Cleared! +3", 1.2); api.state.score = Number(api.state.score) + 3; restackAt = t + 0.9; }
        if (restackAt >= 0 && t >= restackAt) { restackAt = -1; clearBalls(); restack(); }
        api.state.timeLeft = Math.max(0, Math.ceil(endsAt - t));
        if (t >= endsAt) gameOver();
      } else if (phase === "over") {
        if ((tapped || api.input.pressed("KeyR")) && t - overAt > 0.8) reset("play");
      }
    },
  };
}
