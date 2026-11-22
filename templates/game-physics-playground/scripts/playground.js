// Tower smash — a rigid-body physics playground. Click / tap anywhere to
// throw a ball at the point under the pointer (ballistic arc from below the
// camera); knock every block off the pedestal in as few throws as possible.
// Blocks are real rigid bodies (they tumble, stack, slide and sleep), balls
// are clones of the hidden `ballProto`. No input → attract mode: an autopilot
// lobs balls at the tower and rebuilds it, so the embed is alive.

export default function (api) {
  const cfg = Object.assign({ throwSpeed: 19, autoEvery: 1.3, maxBalls: 10 }, api.data.playground || {});
  const G = 9.81;
  const LAUNCH = [0, 1.3, 7.2];
  const PEDESTAL_TOP = 0.6;
  const PEDESTAL_RADIUS = 2.1;
  const COLORS = ["#ef476f", "#118ab2", "#06d6a0", "#ffd166", "#8338ec", "#f78c6b"];

  const blocks = api.findByTag("block").map((o) => ({
    o,
    p: [o.position.x, o.position.y, o.position.z],
    r: [o.rotation.x, o.rotation.y, o.rotation.z],
  }));
  let balls = [];
  let ballCount = 0;
  let phase = "attract"; // attract | play | cleared
  let throws = 0;
  let nextAuto = 0.8;
  let autoThrows = 0;
  let clearedAt = 0;
  let lastHit = -1;
  let best = api.storage.get("bestThrows");
  best = typeof best === "number" ? best : null;

  const isDown = (b) => b.o.position.y < PEDESTAL_TOP - 0.05 || Math.hypot(b.o.position.x, b.o.position.z) > PEDESTAL_RADIUS + 0.2;
  const downCount = () => blocks.filter(isDown).length;

  function publish() {
    api.state.phase = phase;
    api.state.down = downCount();
    api.state.total = blocks.length;
    api.state.throws = throws;
    api.state.best = best === null ? "—" : best + " throws";
    api.state.balls = balls.length;
  }

  function rebuild() {
    for (const b of blocks) {
      b.o.position.set(b.p[0], b.p[1], b.p[2]);
      b.o.rotation.set(b.r[0], b.r[1], b.r[2]);
      api.physics.setVelocity(b.o, [0, 0, 0]);
      api.physics.setAngularVelocity(b.o, [0, 0, 0]);
    }
    for (const ball of balls) ball.remove();
    balls = [];
    throws = 0;
    autoThrows = 0;
  }

  // Ballistic throw from LAUNCH to `target` (flight time from the distance).
  function throwAt(target) {
    const dx = target[0] - LAUNCH[0], dy = target[1] - LAUNCH[1], dz = target[2] - LAUNCH[2];
    const dist = Math.hypot(dx, dy, dz);
    const T = Math.max(0.35, Math.min(1.1, dist / cfg.throwSpeed));
    const ball = api.clone("ballProto", { id: "ball" + ++ballCount, position: LAUNCH });
    ball.visible = true;
    ball.setColor(COLORS[ballCount % COLORS.length]);
    api.physics.setVelocity(ball, [dx / T, dy / T + 0.5 * G * T, dz / T]);
    api.physics.setAngularVelocity(ball, [api.randomRange(-200, 200), api.randomRange(-200, 200), api.randomRange(-200, 200)]);
    balls.push(ball);
    while (balls.length > cfg.maxBalls) balls.shift().remove();
    throws++;
    if (phase !== "attract") api.audio.play("throw");
  }

  // Where the pointer aims: the object / ground under it, else a point on the tower's plane.
  function aimPoint() {
    const hit = api.input.pointerWorld();
    if (hit && hit.objectId !== "ground") return [hit.x, hit.y, hit.z];
    const p = api.input.pointer;
    return [p.x * 6, 2 + p.y * 3.5, 0];
  }

  // Autopilot: aim at a random block still standing (lower half first).
  function autoTarget() {
    const standing = blocks.filter((b) => !isDown(b));
    if (!standing.length) return [0, 1, 0];
    standing.sort((a, b) => a.o.position.y - b.o.position.y);
    const pick = standing[Math.floor(api.random() * Math.min(standing.length, 9))];
    return [pick.o.position.x + api.randomRange(-0.2, 0.2), pick.o.position.y, pick.o.position.z];
  }

  return {
    start() {
      api.physics.onCollision((a, b, info) => {
        // Clacks for real impacts only (sleeping stacks and soft touches stay quiet).
        if (phase === "attract" || info.impulse < 1.2 || api.time() - lastHit < 0.07) return;
        lastHit = api.time();
        api.audio.play("hit");
      });
      publish();
    },
    onEvent(name) {
      if (name === "rebuild") {
        rebuild();
        phase = "play";
        api.audio.play("click");
        publish();
      }
    },
    update() {
      const t = api.time();
      const pressed = api.input.pointer.justPressed || api.input.pressed("Space");
      if (phase === "attract") {
        if (pressed) {
          phase = "play";
          rebuild();
          throwAt(aimPoint());
        } else if (t >= nextAuto) {
          nextAuto = t + cfg.autoEvery;
          if (autoThrows >= 6 || downCount() >= blocks.length * 0.85) {
            rebuild();
            nextAuto = t + 1;
          } else {
            throwAt(autoTarget());
            autoThrows++;
          }
        }
      } else if (phase === "play") {
        if (pressed) throwAt(aimPoint());
        if (downCount() === blocks.length) {
          phase = "cleared";
          clearedAt = t;
          if (best === null || throws < best) {
            best = throws;
            api.storage.set("bestThrows", best);
            api.ui.toast("New record!", 2);
          }
          api.audio.play("win");
        }
      } else if (phase === "cleared" && (pressed || t - clearedAt > 5) && t - clearedAt > 0.8) {
        rebuild();
        phase = "play";
      }
      // Balls that rolled far away are recycled.
      balls = balls.filter((b) => {
        if (b.position.y > -5 && Math.abs(b.position.x) < 25 && b.position.z > -20) return true;
        b.remove();
        return false;
      });
      publish();
    },
  };
}
