'use strict';
window.G = window.G || {};
// 게임 진행: 메뉴 → 로비 → 방 정리·봉인 수집 → 출구 개방 → 방문자 처치 → 결말.
(function (G) {
  const EYE_H = 1.55, GIANT_EYE = 3.7, MOVE_SPEED = 5.4, SPRINT_MULT = 1.45, AIM_MOVE = 0.6, HASTE = 1.5, GIANT_SPEED = 1.25;
  const JUMP_V = 6.4, GRAVITY = 18, LOW_GRAV = 0.32;
  const FOV = 74, AIM_FOV = 48, TPS_BACK = 3.0, TPS_AIM_BACK = 1.6, TPS_SIDE = 0.7, LOOK_SENS = 0.0024, AIM_SENS = 0.55;
  const GATE_NEED = 12, RESPAWN_TIME = 3, REGEN_DELAY = 4, REGEN_RATE = 12, HIST_STEP = 0.1, HIST_LEN = 30;
  const WORLD_CHAT_GAP = [16, 34], END_DELAY = 2.5, NORMAL_RES = 180;
  const SAVE_KEY = 'newroom-online-v1';
  const $ = (id) => document.getElementById(id);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rule = (id) => G.Rules.active(S, id);
  let S = null, last = 0, crashed = false;

  function loadSave() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (d && Array.isArray(d.endings)) return { endings: d.endings.filter((x) => typeof x === 'string'), bestLevel: Number(d.bestLevel) || 1 };
    } catch (err) {
      console.warn('저장 기록을 읽지 못했습니다:', err);
    }
    return { endings: [], bestLevel: 1 };
  }

  function writeSave(d) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (err) { console.warn('저장하지 못했습니다:', err); }
  }

  function newState(seed) {
    G.world = G.World.build(seed, G.GAME_DATA);
    G.gfx.setStatic(G.world.staticVerts);
    G.world.staticVerts = null;
    G.gfx.setLowRes(NORMAL_RES);
    return {
      seed, playing: false, paused: false, time: 0, player: null, bots: [], enemies: [], orbs: [], tracers: [], parts: [], pickups: [],
      room: null, tps: false, aiming: false, cam: null, fovNow: FOV, stats: { freedom: 0, clarity: 0, bond: 0 }, items: new Set(),
      restored: 0, kills: 0, gateOpen: false, boss: null, won: false, endT: 0, endingShown: false, checkpoint: null,
      hurt: 0, shift: 0, flashT: 0, recoil: 0, hitMarkT: 0, visitorFlash: 0, xpMult: 1, mapDirty: true, worldChatT: 8,
    };
  }

  // ---- 시작 ----
  function startGame(charId) {
    G.audio.unlock();
    const [cx, cz] = G.world.center(G.world.lobby);
    S.player = G.Actors.createPlayer(charId, cx, cz - 2);
    S.bots = [0, 1, 2, 3, 4, 5].filter((i) => i !== charId).map((id, slot) => G.Actors.createBot(id, slot, cx + (slot - 2) * 1.2, cz + 1.5));
    G.Rules.init(S);
    S.playing = true;
    S.time = 0;
    $('menu').hidden = true;
    $('touch').hidden = !G.input.touch;
    G.hud.reset();
    G.hud.show(true);
    G.input.lock();
    G.audio.music('ambience');
    G.hud.chat('system', '', '접속자 6 / 6 · 파티가 결성되었습니다', '#c8c4b4');
    G.Actors.botSay(S, S.bots[0], 'quote');
    G.hud.toast('잡음을 쓸어내고 봉인 12개를 모으면 출구가 열린다');
  }

  // ---- 플레이어 ----
  function startReload(p) {
    if (p.reloadT > 0 || p.ammo >= p.weapon.mag) return;
    p.reloadT = p.weapon.reload;
  }

  function updateWeapon(p, inp, dt) {
    p.fireCd -= dt;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) p.ammo = p.weapon.mag;
    } else if (inp.fire && p.fireCd <= 0) {
      if (p.ammo > 0 || rule('burst')) G.Actors.playerFire(S);
      else startReload(p);
    }
  }

  function updatePlayer(dt) {
    const p = S.player, inp = G.input;
    p.inv = Math.max(0, p.inv - dt);
    p.skillCd = Math.max(0, p.skillCd - dt);
    if (!p.alive) {
      inp.lookX = 0; inp.lookY = 0;
      p.respawnT -= dt;
      if (p.respawnT <= 0) respawn();
      return;
    }
    const mir = rule('mirror') ? -1 : 1;
    S.aiming = inp.aim;
    const sens = LOOK_SENS * (S.aiming ? AIM_SENS : 1);
    p.yaw -= inp.lookX * sens * mir;
    p.pitch = Math.max(-1.4, Math.min(1.4, p.pitch - inp.lookY * sens));
    inp.lookX = 0; inp.lookY = 0;

    let mx = inp.moveX * mir, mz = inp.moveZ;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const spd = MOVE_SPEED * (inp.sprint && !S.aiming ? SPRINT_MULT : 1) * (S.aiming ? AIM_MOVE : 1)
      * (G.Actors.has(S, 'haste') ? HASTE : 1) * (rule('giant') ? GIANT_SPEED : 1);
    if (ml > 0.05) {
      G.world.move(p, (sy * mz - cy * mx) * spd * dt, (cy * mz + sy * mx) * spd * dt);
      p.walk += dt * spd * 1.6;
    }
    if (inp.consume('jump') && p.onGround) p.vy = JUMP_V;
    G.Actors.fall(p, dt, GRAVITY * (rule('lowgrav') ? LOW_GRAV : 1));

    if (inp.consume('view')) { S.tps = !S.tps; G.hud.toast(S.tps ? '3인칭 (TPS)' : '1인칭 (FPS)'); }
    if (inp.consume('skill')) G.Actors.useSkill(S);
    if (inp.consume('reload')) startReload(p);
    const ch = inp.consume('choice');
    if (ch && S.choice) G.Rules.pick(S, ch - 1);
    updateWeapon(p, inp, dt);

    if (S.time - p.lastHurt > REGEN_DELAY && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + REGEN_RATE * dt);
    p.histT -= dt;
    if (p.histT <= 0) {
      p.histT = HIST_STEP;
      p.history.push({ x: p.x, y: p.y, z: p.z, hp: p.hp });
      if (p.history.length > HIST_LEN) p.history.shift();
    }
    const r = G.world.roomAt(p.x, p.z);
    if (r !== S.room) enterRoom(r);
  }

  function playerDown() {
    const p = S.player;
    p.alive = false;
    p.hp = 0;
    p.respawnT = RESPAWN_TIME;
    G.hud.dead(true);
    G.Actors.botSay(S, pick(S.bots.filter((b) => b.alive)), 'down');
  }

  function respawn() {
    const p = S.player, room = S.checkpoint || G.world.lobby;
    const [cx, cz] = G.world.center(room);
    p.x = cx; p.z = cz; p.y = 0; p.vy = 0;
    p.hp = p.maxHp; p.alive = true; p.inv = 2; p.history = [];
    p.ammo = p.weapon.mag; p.reloadT = 0;
    S.room = null;
    G.hud.dead(false);
    G.hud.toast('재접속 완료');
  }

  // ---- 방 ----
  function enterRoom(r) {
    S.room = r;
    if (!r) return;
    if (!r.visited) { r.visited = true; G.hud.banner(r.name, r.cat); G.audio.play('neon'); S.mapDirty = true; }
    if (!r.active && !r.cleared) activateRoom(r);
    if (r.isExit && S.gateOpen && !S.boss && !S.won) spawnBoss(r);
  }

  function activateRoom(r) {
    r.active = true;
    if (r.isExit) return;
    const p = S.player;
    const n = r.isSecret ? 4 : 3 + r.tier + Math.min(3, Math.floor(p.lvl / 3));
    const scale = 1 + r.tier * 0.18 + (p.lvl - 1) * 0.06;
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      const type = r.tier <= 1 ? (roll < 0.65 ? 'noise' : 'echo') : roll < 0.45 ? 'noise' : roll < 0.75 ? 'echo' : 'glitch';
      const [x, z] = G.world.freeSpot(r, p.x, p.z, 5);
      G.Actors.spawnEnemy(S, type, x, z, r, scale);
    }
    if (r.isSecret) { const [x, z] = G.world.freeSpot(r, p.x, p.z, 6); G.Actors.spawnEnemy(S, 'ghost', x, z, r, scale); }
  }

  function updateRooms() {
    const counts = {};
    S.enemies.forEach((e) => { if (e.alive && e.room) counts[e.room.slot] = (counts[e.room.slot] || 0) + 1; });
    G.world.rooms.forEach((r) => {
      if (!r.active || r.cleared || r.isExit || counts[r.slot]) return;
      r.cleared = true;
      S.pickups.push({ type: 'seal', room: r, x: r.x0 + 7, z: r.z0 + 7, y: 0, t: 0 });
      G.hud.chat('system', '', `${r.name} 정적 제거 · 방 가운데 봉인이 나타났다`, '#fff6c8');
      G.audio.sfx('clear');
      S.mapDirty = true;
    });
  }

  function takeSeal(r) {
    const p = S.player;
    r.restored = true;
    S.restored += 1;
    S.checkpoint = r;
    S.mapDirty = true;
    G.Actors.addXP(S, 40 + r.tier * 15);
    p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35);
    if (r.memory.length) G.hud.sub(pick(r.memory));
    G.hud.toast(`봉인 ${S.restored} / ${GATE_NEED}`, '#fff6c8');
    if (r.isSecret) { S.items.add('출구 설계도'); G.hud.chat('system', '', '「출구 설계도」를 얻었다', '#ffb347'); }
    const owner = S.bots.find((b) => b.charId === r.owner);
    if (owner) G.Actors.botSay(S, owner, 'quote');
    else if (Math.random() < 0.5) G.Actors.botSay(S, pick(S.bots), 'restore');
    if (S.restored >= GATE_NEED && !S.gateOpen) openGate();
  }

  function openGate() {
    S.gateOpen = true;
    G.world.openGates();
    S.mapDirty = true;
    G.hud.banner('출구 봉인 해제', '가장 남쪽 방 · ' + G.world.exit.name);
    G.audio.play('shift');
    S.shift = 1;
    G.hud.chat('world', pick(G.CONTENT.worldNames), '누가 출구 열었다!!', '#9ab');
  }

  function spawnBoss(r) {
    S.boss = G.Actors.spawnEnemy(S, 'visitor', r.x0 + 7, r.z0 + 9, r, 1 + (S.player.lvl - 1) * 0.08);
    if (S.choice) G.Rules.pick(S, 0);
    G.audio.music('masquerade');
    G.hud.banner('방문자', '아직 읽히지 않은 문장');
  }

  function bossDown() {
    S.won = true;
    S.boss = null;
    S.endT = END_DELAY;
    if (S.rule) G.Rules.end(S);
    G.hud.banner('출구 완성', 'EXIT DESIGNED');
  }

  // ---- 카메라·렌더 ----
  function computeCamera() {
    const p = S.player;
    const head = [p.x, p.y + (rule('giant') ? GIANT_EYE : EYE_H), p.z];
    const cp = Math.cos(p.pitch);
    const dir = [Math.sin(p.yaw) * cp, Math.sin(p.pitch), Math.cos(p.yaw) * cp];
    let eye = head, minT = 0, dist = 0;
    if (!p.alive) {
      eye = [p.x - Math.sin(p.yaw) * 4, p.y + 6, p.z - Math.cos(p.yaw) * 4];
      S.cam = { eye, dir, target: [p.x, p.y, p.z], fov: FOV, minT: 0, tps: true, dist: 9 };
      return S.cam;
    }
    if (S.tps) {
      const back = S.aiming ? TPS_AIM_BACK : TPS_BACK;
      const right = [-Math.cos(p.yaw), 0, Math.sin(p.yaw)];
      const want = [head[0] - dir[0] * back + right[0] * TPS_SIDE, head[1] - dir[1] * back + 0.3, head[2] - dir[2] * back + right[2] * TPS_SIDE];
      const v = [want[0] - head[0], want[1] - head[1], want[2] - head[2]];
      const L = Math.hypot(v[0], v[1], v[2]);
      const n = v.map((c) => c / L);
      dist = Math.max(0.15, G.world.raycast(head[0], head[1], head[2], n[0], n[1], n[2], L) - 0.3);
      eye = [head[0] + n[0] * dist, head[1] + n[1] * dist, head[2] + n[2] * dist];
      minT = dist * 0.9;
    }
    const kick = S.recoil * 0.06;
    S.cam = { eye, dir, target: [eye[0] + dir[0], eye[1] + dir[1] + kick, eye[2] + dir[2]], fov: S.fovNow, minT, tps: S.tps, dist };
    return S.cam;
  }

  function attractCamera() {
    const t = S.time * 0.05, c = [G.world.W / 2, 0, G.world.H / 2];
    const eye = [c[0] + Math.sin(t) * 34, 24, c[2] + Math.cos(t) * 34];
    return { eye, dir: [0, 0, 1], target: c, fov: 60, minT: 0, tps: true, dist: 0 };
  }

  function render(dt) {
    const p = S.player;
    const cam = S.playing ? computeCamera() : attractCamera();
    const black = S.playing && rule('blackout');
    const light = p ? [p.x + cam.dir[0] * 2, p.y + 1.5 + cam.dir[1] * 2, p.z + cam.dir[2] * 2] : cam.target;
    G.gfx.begin(cam, {
      fog: black ? [0.012, 0.012, 0.014] : [0.1, 0.105, 0.098],
      fogDist: !S.playing ? 110 : black ? 15 : 52,
      amb: black ? 0.05 : 0.8,
      light,
      lightOn: black ? 1.4 : 0.35,
      flash: S.flashT > 0 ? 1 : 0,
    });
    G.Draw.scene(S, cam);
    G.gfx.end({
      time: S.time,
      hurt: S.hurt,
      mirror: S.playing && rule('mirror') ? 1 : 0,
      mono: S.playing && rule('lowres') ? 1 : p && !p.alive ? 0.8 : 0,
      shift: S.shift,
    });
    if (S.playing) G.hud.update(S, dt);
  }

  function worldChat(dt) {
    S.worldChatT -= dt;
    if (S.worldChatT > 0) return;
    S.worldChatT = rnd(WORLD_CHAT_GAP[0], WORLD_CHAT_GAP[1]);
    G.hud.chat('world', pick(G.CONTENT.worldNames), pick(G.CONTENT.worldLines), '#9ab');
  }

  function update(dt) {
    S.time += dt;
    G.input.poll();
    updatePlayer(dt);
    const eScale = (G.Actors.has(S, 'slow') ? 0.3 : 1) * (rule('slowmo') ? 0.45 : 1);
    G.Actors.updateBots(S, dt);
    G.Actors.updateEnemies(S, dt * eScale);
    G.Actors.updateOrbs(S, dt * eScale);
    G.Actors.updatePickups(S, dt);
    G.Actors.updateFx(S, dt);
    updateRooms();
    G.Rules.update(S, dt);
    worldChat(dt);
    S.hurt = Math.max(0, S.hurt - dt * 1.4);
    S.shift = Math.max(0, S.shift - dt * 1.3);
    S.recoil = Math.max(0, S.recoil - dt * 1.5);
    S.flashT -= dt; S.hitMarkT -= dt; S.visitorFlash -= dt;
    const fovTarget = S.aiming ? (S.player.weapon.zoom || AIM_FOV) : FOV;
    S.fovNow += (fovTarget - S.fovNow) * Math.min(1, dt * 12);
    if (S.won && !S.endingShown) { S.endT -= dt; if (S.endT <= 0) showEnding(); }
  }

  function frame(ts) {
    const dt = Math.min(0.05, Math.max(0, (ts - last) / 1000));
    last = ts;
    try {
      if (!S.playing) S.time += dt;
      else if (!S.paused) update(dt);
      render(dt);
    } catch (err) {
      if (!crashed) { crashed = true; console.error(err); G.hud.toast('오류가 발생했습니다. 새로고침해 주세요.', '#ff6b5a'); }
    }
    requestAnimationFrame(frame);
  }

  // ---- 메뉴·결말 ----
  function buildMenu() {
    const chars = G.GAME_DATA.characters, saved = loadSave();
    $('chars').innerHTML = chars.map((c, i) => `<button class="char" data-id="${i}" style="--c:${G.CONTENT.css[i]}">
      <span class="num">0${i + 1}</span><b>${esc(c.name)}</b><small>${esc(c.tag)}</small>
      <em>Q · ${esc(G.CONTENT.skills[i].name)}</em><i>${esc(G.CONTENT.weapons[G.CONTENT.startWeapon[i]].name)}</i></button>`).join('');
    $('chars').querySelectorAll('.char').forEach((b) => b.addEventListener('click', () => startGame(Number(b.dataset.id))));
    $('record').textContent = `발견한 결말 ${saved.endings.length} / 6 · 최고 LV ${saved.bestLevel}`;
    $('soundBtn').addEventListener('click', () => { $('soundBtn').textContent = G.audio.toggle() ? '소리 켜짐' : '소리 꺼짐'; });
  }

  function showEnding() {
    S.endingShown = true;
    S.paused = true;
    const end = G.Rules.ending(S), p = S.player, saved = loadSave();
    const found = saved.endings.includes(end.id) ? saved.endings : saved.endings.concat([end.id]);
    writeSave({ endings: found, bestLevel: Math.max(saved.bestLevel, p.lvl) });
    if (document.exitPointerLock) document.exitPointerLock();
    G.audio.music('ending');
    const list = G.GAME_DATA.endings.map((e) => `<li class="${found.includes(e.id) ? 'got' : ''}${e.id === end.id ? ' now' : ''}"><b>${e.num}</b> ${found.includes(e.id) ? esc(e.name) : '???'}<small>${esc(G.CONTENT.endingHints[e.id])}</small></li>`).join('');
    const st = S.stats;
    $('ending').innerHTML = `<div class="end-in"><small>ENDING ${end.num} · REC STOP</small><h2>${esc(end.name)}</h2>
      <p class="story">${esc(end.story)}</p>
      <div class="stats">LV ${p.lvl} · 처치 ${S.kills} · 복원 ${S.restored} · 자유 ${st.freedom} · 명료 ${st.clarity} · 연결 ${st.bond}</div>
      <ul>${list}</ul>
      <div class="btns"><button id="endStay">계속 탐험</button><button id="endNew" class="primary">새 건물에서 다시</button></div></div>`;
    $('ending').hidden = false;
    $('endStay').addEventListener('click', () => { $('ending').hidden = true; S.paused = false; G.audio.music('ambience'); G.input.lock(); });
    $('endNew').addEventListener('click', () => window.location.reload());
  }

  function onLockChange(locked) {
    if (!S.playing || G.input.touch || S.endingShown) return;
    S.paused = !locked;
    $('pause').hidden = locked;
  }

  function boot() {
    const canvas = $('view');
    try {
      G.gfx.init(canvas);
    } catch (err) {
      $('menu').innerHTML = `<div class="menu-in"><h1>NEW방 <span>ONLINE</span></h1><p>${esc(err.message)}</p><p>Chrome · Edge · Safari 최신 버전에서 열어 주세요.</p></div>`;
      return;
    }
    G.gfx.loadTexture(G.VISITOR_SRC);
    G.hud.init();
    G.audio.init();
    G.input.init(canvas);
    G.input.onLockChange = onLockChange;
    S = newState((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    buildMenu();
    $('pause').addEventListener('click', () => G.input.lock());
    requestAnimationFrame(frame);
  }

  G.Main = { GATE_NEED, takeSeal, bossDown, playerDown, state: () => S };
  boot();
})(window.G);
