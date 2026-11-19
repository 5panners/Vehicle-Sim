// Dev-only route verifier: drives the real controller along the generated route and reports unreachable steps.
export async function runBot(g, from = 1, to = 9999, opts = {}) {
  const { player: P, world: W, keys, cam } = g;
  const route = W.route, fails = [], stats = { ok: 0, tele: 0 };
  const tmp = [];
  const inside = (c, x, z, m = 0) => { const dx = x - c.x, dz = z - c.z; if (c.kind === 1) return Math.hypot(dx, dz) < c.r + m; const lx = dx * c.c + dz * c.s, lz = -dx * c.s + dz * c.c; return Math.abs(lx) < c.hx + m && Math.abs(lz) < c.hz + m; };
  const groundAhead = (x, z, y, hx, hz) => {
    W.query(x, y, z, tmp);
    let ground = false;
    for (const c of tmp) { if (c.enabled && c.top <= y + 0.1 && c.top >= y - 0.45 && inside(c, x, z)) ground = true; }
    W.query(x + hx * 0.4, y, z + hz * 0.4, tmp);
    for (const c of tmp) { if (c.enabled && c.top > y + 0.12 && c.top < y + 2.2 && c.bot < y + 1 && inside(c, x + hx * 0.4, z + hz * 0.4, 0.2)) return false; }
    return ground;
  };
  const run = (steer, maxT, done, o = {}) => {
    let t = 0, ok = false;
    while (t < maxT) {
      const [tx, tz] = steer(); const dx = tx - P.pos.x, dz = tz - P.pos.z, d = Math.hypot(dx, dz);
      cam.yaw = Math.atan2(-dx, -dz);
      keys.KeyW = d > 0.25; keys.ShiftLeft = o.sprint !== false && d > 7;
      const hx = dx / (d || 1), hz = dz / (d || 1);
      const want = !o.nojump && P.onGround && !groundAhead(P.pos.x + hx * 0.5, P.pos.z + hz * 0.5, P.pos.y, hx, hz);
      keys.Space = !P.onGround && P.vel.y > 0.5;
      if (want) { g.inp.jumpPressed = false; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); keys.Space = true; }
      g.tick(1 / 60); t += 1 / 60;
      if (!want && !keys.Space) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
      if (done()) { ok = true; break; }
    }
    keys.KeyW = false; keys.Space = false;
    return ok;
  };
  const standingOn = (Pl) => P.onGround && Math.abs(P.pos.y - Pl.y) < 0.25 && (Pl.shape === 'disc' ? Math.hypot(P.pos.x - Pl.x, P.pos.z - Pl.z) < Pl.w / 2 : Math.hypot(P.pos.x - Pl.x, P.pos.z - Pl.z) < Math.max(Pl.w, Pl.d) / 2);
  for (let i = from; i < Math.min(route.length, to); i++) {
    const r = route[i], Pl = r.P;
    let ok = false;
    if (opts.independent && r.kind !== 'tele') {
      const A = route[i - 1].P;
      for (let a = 0; a < 30; a++) { P.teleport(A.x, A.y + 0.05, A.z); for (let k = 0; k < 30; k++) g.tick(1 / 60); if (P.onGround && Math.abs(P.pos.y - A.y) < 0.3) break; for (let k = 0; k < 30; k++) g.tick(1 / 60); }
    }
    if (r.kind === 'tele') { stats.tele++; for (let a = 0; a < 20; a++) { P.teleport(Pl.x, Pl.y + 0.05, Pl.z); for (let k = 0; k < 30; k++) g.tick(1 / 60); if (P.onGround && Math.abs(P.pos.y - Pl.y) < 0.3) break; for (let k = 0; k < 60; k++) g.tick(1 / 60); } continue; }
    if (r.kind === 'hop' || r.kind === 'gate') ok = run(() => [Pl.x, Pl.z], 7, () => standingOn(Pl));
    else if (r.kind === 'ladder') {
      const l = r.lad;
      ok = run(() => (P.pos.y > l.topY - 1.2 ? [Pl.x, Pl.z] : [l.x + l.ux * 1.2, l.z + l.uz * 1.2]), 14, () => standingOn(Pl));
    } else if (r.kind === 'pad') {
      const pd = r.pad; let launched = false;
      ok = run(() => (P.pos.y > pd.y + 1.5 ? [Pl.x, Pl.z] : (launched ? [Pl.x, Pl.z] : [pd.x, pd.z])), 9, () => standingOn(Pl), { sprint: false, nojump: true });
    }
    if (ok) stats.ok++;
    else {
      fails.push({ i, kind: r.kind, lvl: r.i, from: [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)], to: [+Pl.x.toFixed(1), +Pl.y.toFixed(1), +Pl.z.toFixed(1)], size: [+Pl.w.toFixed(1), +Pl.d.toFixed(1)] });
      P.teleport(Pl.x, Pl.y + 0.05, Pl.z); for (let k = 0; k < 20; k++) g.tick(1 / 60);
    }
  }
  return { stats, fails, total: route.length };
}
