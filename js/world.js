'use strict';
window.G = window.G || {};
// 건물 지도: 5×4칸의 방(각 14×14 타일). 타일마다 높이를 저장해 충돌·시야·정적 메시를 만든다.
(function (G) {
  const ROOM = 14, COLS = 5, ROWS = 4, W = ROOM * COLS, H = ROOM * ROWS;
  const WALL_H = 3, STEP_UP = 0.42, RAY_STEP = 0.08;
  const LOBBY = 2, EXIT = 17, GATE_FROM = 12;
  const DOOR_A = 5, DOOR_B = 8;
  const PALETTE = [[0.46, 0.5, 0.42], [0.55, 0.45, 0.38], [0.4, 0.46, 0.55], [0.56, 0.52, 0.4], [0.48, 0.42, 0.53], [0.4, 0.52, 0.5], [0.58, 0.4, 0.36]];
  const WALL_COL = [0.3, 0.315, 0.3];
  const SECRET_ROOM = { name: '접속자 7의 방', cat: '?? / SEVENTH SEAT', kind: 'secret', memory: ['일곱 번째 자리는 비어 있었다. 누군가 앉기를 기다리면서.'], secret: true };

  function makeRng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  const ri = (rand, n) => 1 + Math.floor(rand() * n);

  // 방 종류별 소품 배치. 원래 퍼즐 장치(교차 전등, 신호 막대, 경로 등)를 엄폐물 지형으로 옮겼다.
  const PROPS = {
    circuit: (put) => [[3, 3], [9, 3], [3, 9], [9, 9]].forEach(([a, b]) => { put(a, b, WALL_H); put(a + 1, b, WALL_H); put(a, b + 1, WALL_H); put(a + 1, b + 1, WALL_H); }),
    logic: (put) => { for (let l = 2; l <= 11; l++) { put(l, 4, 1); put(l, 9, 1); } },
    sequence: (put) => { for (let l = 2; l <= 11; l += 2) { put(l, 3, 0.8); put(l, 10, 0.8); } },
    memory: (put) => [[3, 3], [10, 3], [3, 10], [10, 10], [2, 6], [11, 7]].forEach(([a, b]) => put(a, b, 2.2)),
    route: (put, rand) => { for (let i = 0; i < 22; i++) put(ri(rand, 12), ri(rand, 12), 1); },
    signal: (put) => { for (let l = 2; l <= 11; l++) { put(l, 3, 0.35 + l * 0.24); put(l, 10, 0.35 + (13 - l) * 0.24); } },
    pairs: (put) => { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; put(Math.round(6.5 + Math.cos(a) * 3.6), Math.round(6.5 + Math.sin(a) * 3.6), 0.55); } },
    oracle: (put) => [[2, 2], [10, 2], [2, 10], [10, 10]].forEach(([a, b]) => { put(a, b, 1.4); put(a + 1, b, 1.4); }),
    balance: (put) => {
      for (let a = 2; a <= 4; a++) for (let b = 2; b <= 4; b++) put(a, b, 0.9);
      for (let a = 2; a <= 3; a++) put(a, 3, 1.8);
      for (let a = 9; a <= 11; a++) for (let b = 9; b <= 11; b++) put(a, b, 0.9);
      put(10, 10, 1.8);
    },
    tiles: (put, rand) => { for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) if (rand() < 0.25) put(a, b, 0.35); },
    lobby: (put) => { put(3, 3, 0.5); put(4, 3, 0.5); put(9, 3, 0.5); put(10, 3, 0.5); },
    secret: (put, rand) => { for (let i = 0; i < 14; i++) put(ri(rand, 12), ri(rand, 12), rand() < 0.5 ? 0.8 : 2.4); },
    exit: (put) => [[3, 3], [10, 3], [3, 10], [10, 10]].forEach(([a, b]) => put(a, b, WALL_H)),
  };

  function makeRooms(data, rand) {
    const pool = shuffle(data.rooms.slice(0, 17).concat([SECRET_ROOM]), rand);
    const rooms = [];
    for (let slot = 0; slot < COLS * ROWS; slot++) {
      const cx = slot % COLS, cy = Math.floor(slot / COLS);
      let info;
      if (slot === LOBBY) info = { name: '입구 로비', cat: '00 / LOBBY', kind: 'lobby', memory: [] };
      else if (slot === EXIT) info = Object.assign({}, data.rooms[17], { kind: 'exit' });
      else info = pool.pop();
      const base = PALETTE[Math.floor(rand() * PALETTE.length)];
      rooms.push({
        slot, cx, cy, x0: cx * ROOM, z0: cy * ROOM,
        name: info.name, cat: info.cat, kind: info.kind, memory: info.memory || [], owner: info.owner,
        isLobby: slot === LOBBY, isExit: slot === EXIT, isSecret: !!info.secret,
        tier: Math.abs(cx - 2) + cy,
        color: base.map((v) => v * (0.9 + rand() * 0.2)),
        visited: false, active: false, cleared: slot === LOBBY, restored: false,
      });
    }
    return rooms;
  }

  function build(seed, data) {
    const rand = makeRng(seed);
    const cells = new Float32Array(W * H);
    const gateMask = new Uint8Array(W * H);
    const gates = [];
    const idx = (x, z) => z * W + x;
    const rooms = makeRooms(data, rand);

    rooms.forEach((r) => {
      for (let l = 0; l < ROOM; l++) {
        cells[idx(r.x0 + l, r.z0)] = WALL_H; cells[idx(r.x0 + l, r.z0 + ROOM - 1)] = WALL_H;
        cells[idx(r.x0, r.z0 + l)] = WALL_H; cells[idx(r.x0 + ROOM - 1, r.z0 + l)] = WALL_H;
      }
    });

    const door = (x, z, isGate) => {
      const i = idx(x, z);
      if (isGate) { gateMask[i] = 1; gates.push(i); cells[i] = WALL_H; } else cells[i] = 0;
    };
    rooms.forEach((a) => {
      const right = a.cx + 1 < COLS ? rooms[a.slot + 1] : null;
      const down = a.cy + 1 < ROWS ? rooms[a.slot + COLS] : null;
      [[right, 'h'], [down, 'v']].forEach(([b, dir]) => {
        if (!b) return;
        const involvesExit = a.isExit || b.isExit;
        const isGate = involvesExit && (a.slot === GATE_FROM || b.slot === GATE_FROM);
        if (involvesExit && !isGate) return;
        for (let l = DOOR_A; l <= DOOR_B; l++) {
          if (dir === 'h') { door(a.x0 + ROOM - 1, a.z0 + l, isGate); door(b.x0, b.z0 + l, isGate); }
          else { door(a.x0 + l, a.z0 + ROOM - 1, isGate); door(b.x0 + l, b.z0, isGate); }
        }
      });
    });

    // 중앙 십자 통로(로컬 5–8)에는 높은 소품을 두지 않아 모든 문이 항상 이어진다.
    rooms.forEach((r) => {
      const put = (lx, lz, h) => {
        if (lx < 1 || lx > 12 || lz < 1 || lz > 12) return;
        const inCross = (lx >= DOOR_A && lx <= DOOR_B) || (lz >= DOOR_A && lz <= DOOR_B);
        if (inCross && h > 1.05) return;
        if (inCross && (lx <= 2 || lx >= 11 || lz <= 2 || lz >= 11)) return;
        if (lx >= 6 && lx <= 7 && lz >= 6 && lz <= 7) return;
        const i = idx(r.x0 + lx, r.z0 + lz);
        cells[i] = Math.max(cells[i], h);
      };
      const gen = PROPS[r.kind];
      if (gen) gen(put, rand);
      if (!r.isLobby && !r.isExit) for (let i = 0, n = 3 + Math.floor(rand() * 3); i < n; i++) put(ri(rand, 12), ri(rand, 12), 0.8);
    });

    const staticVerts = [];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const i = idx(x, z), h = cells[i];
      if (h <= 0 || gateMask[i]) continue;
      const r = rooms[Math.floor(z / ROOM) * COLS + Math.floor(x / ROOM)];
      const lx = x % ROOM, lz = z % ROOM;
      const isWall = h >= WALL_H && (lx === 0 || lx === ROOM - 1 || lz === 0 || lz === ROOM - 1);
      const j = 0.88 + rand() * 0.24;
      const col = isWall ? WALL_COL.map((v) => v * j) : r.color.map((v) => Math.min(1, v * j * (0.75 + h * 0.12)));
      G.gfx.pushBox(staticVerts, x, 0, z, 1, h, 1, col);
    }

    const heightAt = (x, z) => (x < 0 || z < 0 || x >= W || z >= H ? 99 : cells[Math.floor(z) * W + Math.floor(x)]);
    const roomAt = (x, z) => (x < 0 || z < 0 || x >= W || z >= H ? null : rooms[Math.floor(z / ROOM) * COLS + Math.floor(x / ROOM)]);

    const blocked = (x, z, r, foot) => {
      for (let iz = Math.floor(z - r); iz <= Math.floor(z + r); iz++)
        for (let ix = Math.floor(x - r); ix <= Math.floor(x + r); ix++)
          if (heightAt(ix, iz) > foot + STEP_UP) return true;
      return false;
    };

    const groundAt = (x, z, r, foot) => {
      let g = 0;
      for (let iz = Math.floor(z - r); iz <= Math.floor(z + r); iz++)
        for (let ix = Math.floor(x - r); ix <= Math.floor(x + r); ix++) {
          const h = heightAt(ix, iz);
          if (h <= foot + STEP_UP && h > g) g = h;
        }
      return g;
    };

    // 축별로 미끄러지며 이동. 벽에 막히면 true.
    const move = (a, dx, dz) => {
      let hit = false;
      if (!blocked(a.x + dx, a.z, a.r, a.y)) a.x += dx; else hit = true;
      if (!blocked(a.x, a.z + dz, a.r, a.y)) a.z += dz; else hit = true;
      return hit;
    };

    const raycast = (ox, oy, oz, dx, dy, dz, max) => {
      for (let t = 0; t < max; t += RAY_STEP) {
        const y = oy + dy * t;
        if (y < 0 || y < heightAt(ox + dx * t, oz + dz * t)) return t;
      }
      return max;
    };

    const los = (a, ay, b, by) => {
      const dx = b.x - a.x, dy = by - ay, dz = b.z - a.z, d = Math.hypot(dx, dy, dz);
      if (d < 0.01) return true;
      return raycast(a.x, ay, a.z, dx / d, dy / d, dz / d, d) >= d - 0.05;
    };

    const isOpen = (x, z) => heightAt(x, z) === 0 && heightAt(x + 1, z) === 0 && heightAt(x - 1, z) === 0 && heightAt(x, z + 1) === 0 && heightAt(x, z - 1) === 0;

    // 방 안의 빈 타일 중심. avoid에서 minD 이상 떨어진 곳을 고른다.
    const freeSpot = (room, ax, az, minD) => {
      for (let i = 0; i < 60; i++) {
        const x = room.x0 + 2 + Math.floor(Math.random() * 10), z = room.z0 + 2 + Math.floor(Math.random() * 10);
        if (!isOpen(x, z)) continue;
        if (Math.hypot(x + 0.5 - ax, z + 0.5 - az) < minD) continue;
        return [x + 0.5, z + 0.5];
      }
      return [room.x0 + 7, room.z0 + 7];
    };

    const openGates = () => { gates.forEach((i) => { cells[i] = 0; }); };
    const center = (room) => [room.x0 + 7, room.z0 + 7];

    return { W, H, ROOM, COLS, ROWS, WALL_H, cells, gateMask, gates, rooms, staticVerts, heightAt, roomAt, move, groundAt, raycast, los, freeSpot, openGates, center, lobby: rooms[LOBBY], exit: rooms[EXIT] };
  }

  G.World = { build };
})(window.G);
