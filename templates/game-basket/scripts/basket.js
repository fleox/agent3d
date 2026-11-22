// Hoop Shot — a 45-second basketball shooting game on real rigid-body physics.
// The ball is a dynamic sphere (ccd), the rim a static trimesh torus, the
// backboard and the floor static boxes; a hidden trigger under the rim counts
// baskets (only when the ball falls through it). After each shot the ball comes
// back at a new spot on the court.
// Controls: swipe / drag up from anywhere (the swipe length is the power, its
// sideways drift the aim) — or hold Space to charge the power bar and release
// (← → nudge the aim). Consecutive baskets build a x2 / x3 streak.
// Attract mode: an autopilot shoots with a small random error.

export default function (api) {
  const cfg = Object.assign({ time: 45, flight: 0.95, respawn: 2.4 }, api.data.basket || {});
  const ball = api.get("ball");
  const aim = api.get("aim");
  const confetti = api.get("confetti");
  const hoop = [0, 3.05, -0.13];
  const g = 9.81;

  let phase = "attract"; // attract | play | over
  let score = 0;
  let streak = 0;
  let timeLeft = cfg.time;
  let spot = [0, 1.3, 5.5];
  let holding = true; // ball waiting in hand
  let shotAt = 0;
  let scoredThisShot = false;
  let charge = 0;
  let charging = false;
  let aimX = 0;
  let dragFrom = null;
  let endAt = 0;
  let confettiUntil = 0;
  let nextAuto = 1.2;
  let best = Number(api.storage.get("best") ?? 0);

  function publish() {
    api.state.phase = phase;
    api.state.score = score;
    api.state.best = best;
    api.state.mult = Math.min(3, 1 + Math.floor(streak / 2));
    api.state.time = Math.max(0, Math.ceil(timeLeft));
    api.state.power = charge;
    api.state.charging = charging && phase === "play";
  }

  function newSpot() {
    const x = api.randomRange(-1.8, 1.8);
    const z = api.randomRange(3.8, 5.4);
    spot = [x, 1.3, z];
    if (aim) aim.position.set(x, 0.01, z);
  }

  function hold() {
    holding = true;
    ball.position.set(spot[0], spot[1] + Math.sin(api.time() * 3) * 0.05, spot[2]);
    api.physics.setVelocity(ball, [0, 0, 0]);
    api.physics.setAngularVelocity(ball, [0, 0, 0]);
  }

  // power 0..1 (0.5 = the ideal arc), side = lateral error in m/s
  function shoot(power, side) {
    const T = cfg.flight;
    const k = 0.78 + power * 0.44;
    const v = [
      ((hoop[0] - spot[0]) / T) * k + side,
      ((hoop[1] + 0.05 - spot[1]) / T + 0.5 * g * T) * k,
      ((hoop[2] + 0.06 - spot[2]) / T) * k,
    ];
    holding = false;
    scoredThisShot = false;
    shotAt = api.time();
    api.physics.setVelocity(ball, v);
    api.physics.setAngularVelocity(ball, [-420, 0, 0]); // backspin
    if (phase === "play") api.audio.play("throw");
  }

  function reset(next) {
    phase = next;
    score = 0;
    streak = 0;
    timeLeft = cfg.time;
    charge = 0;
    charging = false;
    nextAuto = api.time() + 1.2;
    newSpot();
    hold();
    publish();
  }

  function basket() {
    scoredThisShot = true;
    streak += 1;
    const mult = Math.min(3, 1 + Math.floor((streak - 1) / 2));
    if (phase === "play") {
      score += 2 * mult;
      api.audio.play("swish");
      api.ui.toast(mult > 1 ? `+${2 * mult}  x${mult}!` : "+2", 0.8);
    } else score += 2;
    confettiUntil = api.time() + 1.6;
  }

  function input() {
    const i = api.input;
    let started = false;
    const p = i.pointer;
    if (p.justPressed) { dragFrom = { x: p.x, y: p.y }; started = true; }
    let shot = null;
    if (dragFrom && !p.down) {
      const dx = p.x - dragFrom.x, dy = p.y - dragFrom.y;
      dragFrom = null;
      if (dy > 0.12) shot = { power: Math.max(0, Math.min(1, (dy - 0.12) / 0.9)), side: dx * 2.2 };
    }
    const sw = i.swipe();
    if (!shot && sw === "up") shot = { power: 0.5, side: 0 };
    if (i.isDown("ArrowLeft")) aimX = Math.max(-1, aimX - 0.03);
    if (i.isDown("ArrowRight")) aimX = Math.min(1, aimX + 0.03);
    if (i.pressed("Space")) { charging = true; charge = 0; started = true; }
    if (charging) {
      charge = Math.min(1, charge + 1 / 60 / 1.1);
      if (!i.isDown("Space")) { shot = { power: charge, side: aimX * 1.2 }; charging = false; }
    }
    return { shot, started: started || !!shot || i.pressed("Enter") };
  }

  return {
    start() {
      reset(api.data.startPhase || "attract");
      api.physics.onCollision((a, b, info) => {
        const other = a.id === "ball" ? b : b.id === "ball" ? a : null;
        if (other && info.impulse > 0.6 && phase === "play") api.audio.play("bounce");
      });
    },
    onEvent(name) {
      if (name === "retry" || name === "start") { reset("play"); api.audio.play("click"); }
    },
    update(dt) {
      if (!ball) return;
      const inp = input();
      if (phase === "attract" && inp.started) { reset("play"); }
      if (phase === "over") {
        if (inp.started && api.time() - endAt > 1) reset("play");
        else if (api.time() - endAt > 7) reset("attract");
      }

      if (holding) {
        hold();
        if (phase === "play" && inp.shot) shoot(inp.shot.power, inp.shot.side);
        if (phase === "attract" && api.time() > nextAuto) {
          shoot(0.5 + api.randomRange(-0.04, 0.04), api.randomRange(-0.12, 0.12));
        }
      } else {
        if (!scoredThisShot && ball.velocity.y < 0 && api.physics.overlaps(ball, "scoreZone")) basket();
        if (api.time() - shotAt > cfg.respawn || ball.position.y < -2) {
          if (!scoredThisShot) streak = 0;
          newSpot();
          hold();
          nextAuto = api.time() + 0.9;
        }
      }
      if (confetti) confetti.visible = api.time() < confettiUntil;
      if (aim) aim.visible = holding;

      if (phase === "play") {
        timeLeft -= dt;
        if (timeLeft <= 0) {
          phase = "over";
          endAt = api.time();
          charging = false;
          if (score > best) { best = score; api.storage.set("best", best); api.ui.toast("New best!", 2); }
          api.audio.play("buzzer");
        }
      }
      publish();
    },
  };
}
