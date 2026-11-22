// Marble maze — roll the ball from the start (west) to the glowing exit (east).
// Controls: arrows / WASD; touch / mouse: hold a finger, the ball rolls toward
// it (relative to the screen centre). The clock starts on the first move.
// No input → attract mode: the ball solves the maze by itself (BFS path).

export default function (api) {
  const cfg = Object.assign({ accel: 16, maxSpeed: 6, damping: 2.2 }, api.data.maze || {});
  const ball = api.get("ball");
  const mazeObj = api.get("maze");
  const goal = api.get("goal");
  const info = mazeObj && mazeObj.userData.maze;
  const N = 1, E = 2, S = 4, W = 8;
  let phase = "attract"; // attract | play | won
  let elapsed = 0;
  let wonAt = 0;
  let path = [];
  let pathIndex = 0;
  let best = api.storage.get("bestTime");
  best = typeof best === "number" ? best : null;
  const start = info ? info.start : [0, 0, 0];
  const exit = info ? info.exit : [0, 0, 0];

  // Cell index from a world position (the maze object sits at the origin).
  function cellOf(x, z) {
    const cs = info.cellSize;
    const i = Math.floor((x + (info.columns * cs) / 2) / cs);
    const j = Math.floor((z + (info.rows * cs) / 2) / cs);
    return [Math.max(0, Math.min(info.columns - 1, i)), Math.max(0, Math.min(info.rows - 1, j))];
  }

  function solve(fromX, fromZ) {
    const cols = info.columns, rows = info.rows;
    const [si, sj] = cellOf(fromX, fromZ);
    const target = cols * rows - 1;
    const prev = new Array(cols * rows).fill(-2);
    const queue = [sj * cols + si];
    prev[queue[0]] = -1;
    while (queue.length) {
      const c = queue.shift();
      if (c === target) break;
      const i = c % cols, j = Math.floor(c / cols), w = info.walls[c];
      const next = [];
      if (!(w & N) && j > 0) next.push(c - cols);
      if (!(w & S) && j < rows - 1) next.push(c + cols);
      if (!(w & E) && i < cols - 1) next.push(c + 1);
      if (!(w & W) && i > 0) next.push(c - 1);
      for (const n of next) if (prev[n] === -2) { prev[n] = c; queue.push(n); }
    }
    const out = [];
    for (let c = target; c >= 0; c = prev[c]) out.unshift(c);
    return out.map((c) => {
      const i = c % cols, j = Math.floor(c / cols);
      const cs = info.cellSize;
      return [-(cols * cs) / 2 + (i + 0.5) * cs, -(rows * cs) / 2 + (j + 0.5) * cs];
    });
  }

  function reset(next) {
    phase = next;
    elapsed = 0;
    if (ball) {
      ball.position.set(start[0], 0.5, start[2]);
      ball.velocity.set(0, 0, 0);
    }
    path = info ? solve(start[0], start[2]) : [];
    pathIndex = 0;
    publish();
  }

  function publish() {
    api.state.phase = phase;
    api.state.time = elapsed.toFixed(1);
    api.state.best = best === null ? "—" : best.toFixed(1) + " s";
    api.state.demo = phase === "attract";
    api.state.progress = path.length ? Math.round((100 * pathIndex) / Math.max(1, path.length - 1)) : 0;
  }

  let heldSince = -1;
  function input() {
    const i = api.input;
    let x = 0, z = 0;
    if (i.isDown("ArrowLeft") || i.isDown("KeyA")) x -= 1;
    if (i.isDown("ArrowRight") || i.isDown("KeyD")) x += 1;
    if (i.isDown("ArrowUp") || i.isDown("KeyW")) z -= 1;
    if (i.isDown("ArrowDown") || i.isDown("KeyS")) z += 1;
    const p = i.pointer;
    if (p.justPressed) heldSince = api.time();
    if (!p.down) heldSince = -1;
    if (p.down && heldSince >= 0) {
      x += Math.max(-1, Math.min(1, p.x * 2.5));
      z += Math.max(-1, Math.min(1, -p.y * 2.5));
    }
    return { x, z, any: x !== 0 || z !== 0 || i.pressed("Space") || i.pressed("Enter") };
  }

  return {
    start() {
      reset("attract");
    },
    onEvent(name) {
      if (name === "retry") {
        reset("play");
        api.audio.play("click");
      }
    },
    update(dt) {
      if (!ball || !info) return;
      if (goal) goal.rotation.set(0, api.time() * 90, 0);
      const inp = input();
      if (phase === "attract" && inp.any) {
        reset("play");
        api.audio.play("click");
      }
      if (phase === "won") {
        ball.velocity.set(ball.velocity.x * 0.9, ball.velocity.y, ball.velocity.z * 0.9);
        if (inp.any && api.time() - wonAt > 1) reset("play");
        else if (api.time() - wonAt > 6) reset("attract");
        publish();
        return;
      }

      let ax = inp.x, az = inp.z;
      if (phase === "attract" && path.length) {
        let wp = path[Math.min(pathIndex, path.length - 1)];
        if (Math.hypot(wp[0] - ball.position.x, wp[1] - ball.position.z) < 0.45 && pathIndex < path.length - 1) {
          pathIndex++;
          wp = path[pathIndex];
        }
        if (pathIndex >= path.length - 1) wp = [exit[0] + info.cellSize, exit[2]];
        ax = wp[0] - ball.position.x;
        az = wp[1] - ball.position.z;
        const d = Math.hypot(ax, az) || 1;
        ax /= d;
        az /= d;
      }
      const l = Math.hypot(ax, az);
      if (l > 1) { ax /= l; az /= l; }
      let vx = ball.velocity.x + ax * cfg.accel * dt;
      let vz = ball.velocity.z + az * cfg.accel * dt;
      const damp = Math.max(0, 1 - cfg.damping * dt);
      vx *= damp;
      vz *= damp;
      const sp = Math.hypot(vx, vz);
      const max = phase === "attract" ? cfg.maxSpeed * 0.8 : cfg.maxSpeed;
      if (sp > max) { vx *= max / sp; vz *= max / sp; }
      ball.velocity.x = vx;
      ball.velocity.z = vz;

      if (phase === "play" && (inp.any || elapsed > 0)) elapsed += dt;
      // Out through the east opening of the exit cell → win.
      const won = ball.position.x > exit[0] + info.cellSize * 0.45 && Math.abs(ball.position.z - exit[2]) < info.cellSize;
      if (won) {
        if (phase === "play") {
          phase = "won";
          wonAt = api.time();
          if (best === null || elapsed < best) {
            best = elapsed;
            api.storage.set("bestTime", best);
            api.ui.toast("New record!", 2);
          }
          api.audio.play("win");
        } else reset("attract");
      }
      if (ball.position.y < -5) reset(phase);
      publish();
    },
  };
}
