'use strict';
window.G = window.G || {};
// 장면 그리기: 상자 조합으로 만든 인물·적·전리품·탄도. 모든 것은 저해상도 버퍼로 들어간다.
(function (G) {
  const SKIN = [0.86, 0.8, 0.72];
  const GUN = [0.12, 0.12, 0.12];
  const GATE_COL = [0.95, 0.45, 0.2];

  const g = () => G.gfx;
  const box = (x, y, z, yaw, pitch, sx, sy, sz, c, emit) => g().cube(g().trs(x, y, z, yaw, pitch, sx, sy, sz), c[0], c[1], c[2], emit || 0);

  // 몸 기준 로컬 좌표(lx, ly, lz)에 놓이는 부품
  function part(a, lx, ly, lz, sx, sy, sz, c, emit) {
    const cs = Math.cos(a.yaw), sn = Math.sin(a.yaw);
    box(a.x + lx * cs + lz * sn, a.y + ly, a.z - lx * sn + lz * cs, a.yaw, 0, sx, sy, sz, c, emit);
  }

  function human(a, col, opts) {
    const o = opts || {};
    if (o.down) { box(a.x, a.y + 0.18, a.z, a.yaw, 0, 0.5, 0.3, 1.4, col.map((v) => v * 0.5)); return; }
    const sw = Math.sin(a.walk || 0) * 0.18;
    const dark = col.map((v) => v * 0.45);
    const emit = o.emit || 0;
    part(a, -0.12, 0.38, sw, 0.17, 0.76, 0.2, dark, emit);
    part(a, 0.12, 0.38, -sw, 0.17, 0.76, 0.2, dark, emit);
    part(a, 0, 1.08, 0, 0.52, 0.62, 0.3, col, emit);
    part(a, 0, 1.6, 0, 0.34, 0.34, 0.34, o.head || SKIN, emit);
    part(a, 0, 1.63, 0.16, 0.36, 0.08, 0.05, o.visor || [0.08, 0.08, 0.08], o.visor ? 1 : 0);
    part(a, -0.3, 1.12, 0.2, 0.13, 0.13, 0.5, col, emit);
    part(a, 0.3, 1.12, 0.2, 0.13, 0.13, 0.5, col, emit);
    part(a, -0.18, 1.18, 0.55, 0.09, 0.12, 0.55, GUN);
  }

  function enemyBody(S, e) {
    const t = S.time, s = e.def.size;
    const marked = G.Actors.has(S, 'mark');
    const rev = S.time < e.revUntil;
    let c = e.def.col;
    if (e.flash > 0) c = [1, 1, 1];
    else if (rev) c = [0.35, 0.55, 1];
    const emit = e.flash > 0 ? 0.9 : marked ? 0.7 : 0;
    const bob = Math.sin(t * 3 + e.bob) * 0.08;
    if (e.type === 'noise') {
      const j = () => (Math.random() - 0.5) * 0.08;
      box(e.x + j(), e.y + s * 0.55 + bob, e.z + j(), e.yaw, 0, s, s, s, c, emit);
      part({ x: e.x, y: e.y + bob, z: e.z, yaw: e.yaw }, 0, s * 0.62, s * 0.5, s * 0.5, 0.1, 0.05, [1, 0.2, 0.1], 1);
      for (let i = 0; i < 2; i++) {
        const a = t * 2.5 + i * Math.PI + e.bob;
        box(e.x + Math.sin(a) * s * 0.8, e.y + s * 0.9, e.z + Math.cos(a) * s * 0.8, a, 0, 0.16, 0.16, 0.16, c, emit);
      }
    } else if (e.type === 'echo') {
      box(e.x, e.y + 0.85 + bob, e.z, t * 2 + e.bob, 0, 0.32, 1.25, 0.32, c, emit);
      box(e.x, e.y + 0.9 + bob, e.z, -t * 3, 0, 0.9, 0.06, 0.9, [0.3, 0.1, 0.08], emit);
      box(e.x, e.y + 0.95 + bob, e.z, e.yaw, 0, 0.18, 0.18, 0.4, [1, 0.35, 0.2], 1);
    } else if (e.type === 'glitch') {
      box(e.x, e.y + 0.4 + bob, e.z, t * 9, 0.7, 0.6, 0.16, 0.16, c, Math.max(emit, 0.5));
      box(e.x, e.y + 0.4 + bob, e.z, -t * 9, -0.7, 0.16, 0.6, 0.16, c, Math.max(emit, 0.5));
    } else if (e.type === 'ghost') {
      human(e, e.flash > 0 ? [1, 1, 1] : [0.08, 0.08, 0.09], { head: [0.1, 0.1, 0.1], visor: [1, 0.15, 0.1], emit });
    } else {
      const tint = e.flash > 0 ? [0.6, 0.6, 0.6] : [0.05, 0.05, 0.05];
      if (!g().sprite(e.x, e.y, e.z, s * 1.1, s * 1.4, tint[0], tint[1], tint[2])) box(e.x, e.y + s * 0.55, e.z, e.yaw, 0, s * 0.4, s, s * 0.4, tint, 1);
      for (let i = 0; i < 6; i++) {
        const a = t * 1.2 + i / 6 * Math.PI * 2;
        box(e.x + Math.sin(a) * 2.4, e.y + 1.5 + Math.sin(t * 2 + i) * 0.6, e.z + Math.cos(a) * 2.4, a, a, 0.3, 0.3, 0.3, [0.03, 0.03, 0.03], e.phase === 2 ? 0.2 : 0);
      }
    }
  }

  function rooms(S, w) {
    w.rooms.forEach((r) => {
      const k = r.restored ? 1.2 : r.cleared ? 0.85 : 0.5;
      const c = r.color;
      box(r.x0 + 7, -0.05, r.z0 + 7, 0, 0, 14, 0.1, 14, [c[0] * k, c[1] * k, c[2] * k], 0, 1);
      if (r.restored) {
        box(r.x0 + 7, 3, r.z0 + 7, S.time * 0.6, 0, 0.12, 6, 0.12, c, 1);
        box(r.x0 + 7, 0.05, r.z0 + 7, S.time * 0.3, 0, 1.6, 0.06, 1.6, c, 1);
      }
    });
    if (!S.gateOpen) {
      w.gates.forEach((i, n) => {
        const x = i % w.W, z = Math.floor(i / w.W);
        box(x + 0.5, 1.5, z + 0.5, 0, 0, 1, 3, 1, n % 2 ? GATE_COL : [0.18, 0.08, 0.05], n % 2 ? 0.8 : 0);
      });
    }
  }

  function pickups(S) {
    S.pickups.forEach((pk) => {
      const bob = 0.6 + Math.sin(pk.t * 3) * 0.15;
      if (pk.type === 'seal') {
        const c = pk.room.color;
        box(pk.x, bob + 0.3, pk.z, pk.t * 2, 0.6, 0.5, 0.5, 0.5, [c[0] * 1.6, c[1] * 1.6, c[2] * 1.6], 1);
        box(pk.x, 4, pk.z, 0, 0, 0.08, 8, 0.08, [1, 0.95, 0.8], 1);
      } else if (pk.type === 'loot') {
        const c = pk.w.rgb;
        box(pk.x, bob, pk.z, pk.t * 1.5, 0, 0.5, 0.18, 0.18, c, 1);
        box(pk.x, 1.6, pk.z, 0, 0, 0.05, 3.2, 0.05, c, 1);
      } else {
        box(pk.x, bob, pk.z, pk.t, 0, 0.4, 0.12, 0.12, [0.3, 0.95, 0.4], 1);
        box(pk.x, bob, pk.z, pk.t, 0, 0.12, 0.4, 0.12, [0.3, 0.95, 0.4], 1);
      }
    });
  }

  function fx(S) {
    S.tracers.forEach((t) => {
      const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1], dz = t.b[2] - t.a[2], L = Math.hypot(dx, dy, dz);
      if (L < 0.05) return;
      const c = t.col || [1, 0.9, 0.6];
      box((t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2, (t.a[2] + t.b[2]) / 2, Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz)), 0.035, 0.035, L, c, 1);
    });
    S.orbs.forEach((o) => box(o.x, o.y, o.z, S.time * 6, 0.6, 0.26, 0.26, 0.26, [1, 0.25, 0.15], 1));
    S.parts.forEach((q) => box(q.x, q.y, q.z, q.t * 9, q.t * 7, q.s, q.s, q.s, q.col, 0.6));
  }

  // 1인칭 무기: 카메라 기준으로 붙인다
  function viewModel(S, cam) {
    const p = S.player, w = p.weapon;
    const right = [-Math.cos(p.yaw), 0, Math.sin(p.yaw)];
    const back = S.recoil * 0.4 + (p.reloadT > 0 ? 0.15 : 0);
    const sway = Math.sin(p.walk) * 0.015;
    const side = S.aiming ? 0.02 : 0.24, drop = S.aiming ? 0.12 : 0.22;
    const fwd = 0.7 - back;
    const x = cam.eye[0] + cam.dir[0] * fwd + right[0] * (side + sway);
    const y = cam.eye[1] + cam.dir[1] * fwd - drop + Math.abs(sway) - (p.reloadT > 0 ? 0.12 : 0);
    const z = cam.eye[2] + cam.dir[2] * fwd + right[2] * (side + sway);
    const len = w.base === 'rifle' ? 0.5 : w.base === 'shotgun' ? 0.4 : 0.3;
    box(x, y, z, p.yaw, p.pitch, 0.05, 0.065, len, GUN);
    box(x, y + 0.04, z, p.yaw, p.pitch, 0.025, 0.015, len * 0.8, w.rgb, 0.3);
    box(x - right[0] * 0.01, y - 0.06, z - right[2] * 0.01, p.yaw, p.pitch, 0.045, 0.09, 0.06, G.CONTENT.colors[p.charId]);
    if (S.flashT > 0) box(x + cam.dir[0] * len * 0.6, y + cam.dir[1] * len * 0.6, z + cam.dir[2] * len * 0.6, Math.random() * 6, 0.4, 0.16, 0.16, 0.16, [1, 0.85, 0.4], 1);
  }

  function scene(S, cam) {
    const w = G.world;
    g().drawStatic();
    rooms(S, w);
    pickups(S);
    S.enemies.forEach((e) => { if (e.alive) enemyBody(S, e); });
    S.bots.forEach((b) => human(b, b.charId >= 0 ? G.CONTENT.colors[b.charId] : [0.08, 0.08, 0.09], { down: !b.alive, visor: b.charId < 0 ? [1, 0.15, 0.1] : null }));
    const p = S.player;
    if (p && S.playing) {
      const col = G.CONTENT.colors[p.charId];
      if (!p.alive) human(p, col, { down: true });
      else if (cam.tps && cam.dist > 0.7) human(p, col, { emit: p.inv > 0 ? 0.4 : 0 });
    }
    fx(S);
    if (S.visitorFlash > 0 && p) {
      const vx = cam.eye[0] + cam.dir[0] * 6, vz = cam.eye[2] + cam.dir[2] * 6;
      g().sprite(vx, 0, vz, 3, 4, 0.02, 0.02, 0.02);
    }
    if (p && S.playing && p.alive && !cam.tps) viewModel(S, cam);
  }

  G.Draw = { scene };
})(window.G);
