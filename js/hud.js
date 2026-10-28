'use strict';
window.G = window.G || {};
// DSLR 뷰파인더 HUD: REC·타임코드·노출값, 배터리(체력), 남은 컷(탄약), AF 포인트(조준점),
// MMO식 파티 창·이름표·피해 숫자·채팅·미니맵.
(function (G) {
  const MAX_CHAT = 7, TAG_POOL = 36, FLOAT_POOL = 28, MAP_W = 150, MAP_H = 120;
  const TAG_RANGE = 26, FLOAT_LIFE = 0.9;
  const $ = (id) => document.getElementById(id);
  const el = {};
  const tags = [];
  const floats = [];
  let mapBase = null, mapCtx = null, partyKey = '';
  const timers = {};

  function flash(id, ms) {
    const node = el[id];
    node.classList.add('show');
    clearTimeout(timers[id]);
    timers[id] = setTimeout(() => node.classList.remove('show'), ms);
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function timecode(t) {
    const f = Math.floor((t % 1) * 24), s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
    return [h, m, s, f].map((v) => String(v).padStart(2, '0')).join(':');
  }

  function drawMapBase(S) {
    const w = G.world, sx = MAP_W / w.W, sz = MAP_H / w.H;
    const ctx = mapBase.getContext('2d');
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    w.rooms.forEach((r) => {
      const c = r.color, k = r.restored ? 255 : r.visited ? 150 : 60;
      ctx.fillStyle = `rgb(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0})`;
      ctx.fillRect(r.x0 * sx, r.z0 * sz, w.ROOM * sx, w.ROOM * sz);
    });
    for (let z = 0; z < w.H; z++) for (let x = 0; x < w.W; x++) {
      const h = w.cells[z * w.W + x];
      if (h <= 0) continue;
      const gate = w.gateMask[z * w.W + x];
      ctx.fillStyle = gate ? '#ff7a33' : h >= w.WALL_H ? '#151715' : 'rgba(0,0,0,.35)';
      ctx.fillRect(x * sx, z * sz, Math.ceil(sx), Math.ceil(sz));
    }
    S.mapDirty = false;
  }

  function drawMap(S) {
    if (S.mapDirty) drawMapBase(S);
    const w = G.world, sx = MAP_W / w.W, sz = MAP_H / w.H, ctx = mapCtx;
    ctx.clearRect(0, 0, MAP_W, MAP_H);
    ctx.drawImage(mapBase, 0, 0);
    const marked = G.Actors.has(S, 'mark');
    S.enemies.forEach((e) => {
      if (!e.alive || !(marked || e.room === S.room || e.type === 'visitor')) return;
      ctx.fillStyle = e.type === 'visitor' ? '#fff' : '#ff4a3a';
      ctx.fillRect(e.x * sx - 1.5, e.z * sz - 1.5, 3, 3);
    });
    S.pickups.forEach((pk) => { if (pk.type === 'seal') { ctx.fillStyle = '#fff6c8'; ctx.fillRect(pk.x * sx - 2, pk.z * sz - 2, 4, 4); } });
    S.bots.forEach((b) => { ctx.fillStyle = b.charId >= 0 ? G.CONTENT.css[b.charId] : '#777'; ctx.fillRect(b.x * sx - 1.5, b.z * sz - 1.5, 3, 3); });
    const p = S.player, px = p.x * sx, pz = p.z * sz;
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-p.yaw);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.lineTo(3.5, -3); ctx.lineTo(-3.5, -3); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function partyRow(name, lvl, color, hp, max, alive, isMe) {
    return `<div class="pf${isMe ? ' me' : ''}${alive ? '' : ' down'}"><b style="color:${color}">${esc(name)}</b><span>LV${lvl}</span><i><u style="width:${Math.max(0, hp / max * 100)}%"></u></i></div>`;
  }

  function drawParty(S) {
    const p = S.player, chars = G.GAME_DATA.characters;
    const key = S.bots.map((b) => b.charId + (b.alive ? 'a' : 'd') + Math.round(b.hp / b.maxHp * 20)).join() + '|' + Math.round(p.hp / p.maxHp * 20) + p.lvl + p.alive;
    if (key === partyKey) return;
    partyKey = key;
    el.party.innerHTML = partyRow(chars[p.charId].name, p.lvl, G.CONTENT.css[p.charId], p.hp, p.maxHp, p.alive, true)
      + S.bots.map((b) => partyRow(b.name, p.lvl, b.charId >= 0 ? G.CONTENT.css[b.charId] : '#888', b.hp, b.maxHp, b.alive, false)).join('');
  }

  function placeTag(i, x, y, name, color, hp, max) {
    const t = tags[i];
    t.style.transform = `translate(${x | 0}px,${y | 0}px)`;
    if (t._name !== name) { t._name = name; t.firstChild.textContent = name; }
    t.firstChild.style.color = color;
    t.lastChild.firstChild.style.width = Math.max(0, hp / max * 100) + '%';
    t.style.display = 'block';
  }

  function drawTags(S, mirror) {
    let n = 0;
    const p = S.player, cam = S.cam;
    const show = (a, y, name, color, hp, max) => {
      if (n >= TAG_POOL) return;
      const q = G.gfx.project(a.x, y, a.z);
      if (!q) return;
      placeTag(n++, mirror ? G.gfx.cssW - q[0] : q[0], q[1], name, color, hp, max);
    };
    S.bots.forEach((b) => { if (Math.hypot(b.x - p.x, b.z - p.z) < 40) show(b, b.y + 2.15, b.name, b.charId >= 0 ? G.CONTENT.css[b.charId] : '#aaa', b.hp, b.maxHp); });
    const marked = G.Actors.has(S, 'mark');
    const eye = { x: cam.eye[0], z: cam.eye[2] };
    S.enemies.forEach((e) => {
      if (!e.alive || e.type === 'visitor') return;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d > TAG_RANGE) return;
      const top = e.y + e.def.size + 0.5;
      if (!marked && !G.world.los(eye, cam.eye[1], e, top - 0.3)) return;
      show(e, top, e.def.name, '#ff8a7a', e.hp, e.maxHp);
    });
    for (let i = n; i < TAG_POOL; i++) if (tags[i].style.display !== 'none') tags[i].style.display = 'none';
  }

  function drawFloats(dt, mirror) {
    floats.forEach((f) => {
      if (f.t <= 0) return;
      f.t -= dt;
      const q = f.t > 0 ? G.gfx.project(f.x, f.y + (FLOAT_LIFE - f.t) * 1.2, f.z) : null;
      if (!q) { f.node.style.display = 'none'; return; }
      f.node.style.display = 'block';
      f.node.style.opacity = Math.min(1, f.t * 3);
      f.node.style.transform = `translate(${(mirror ? G.gfx.cssW - q[0] : q[0]) | 0}px,${q[1] | 0}px)`;
    });
  }

  function expo(S) {
    const p = S.player, w = p.weapon, r = (id) => G.Rules.active(S, id);
    const iso = r('lowres') ? 25600 : r('blackout') ? 12800 : 400 * (1 + Math.floor(S.hurt * 4));
    const shutter = r('slowmo') ? 8000 : Math.round(w.rate * 30);
    const fnum = S.aiming ? '5.6' : '2.8';
    const mm = S.aiming ? (w.zoom ? 300 : 85) : 24;
    return `ISO ${iso} · 1/${shutter} · F${fnum} · ${mm}mm`;
  }

  const hud = {
    init() {
      ['hud', 'tc', 'mode', 'obj', 'expo', 'batt', 'hpText', 'party', 'af', 'hitm', 'tags', 'bossbar', 'banner', 'rulebox', 'ruleTag', 'subline', 'choice', 'chat', 'skillName', 'skillCd', 'skillBox', 'wname', 'ammo', 'xpFill', 'lvl', 'toast', 'dead', 'lvlup']
        .forEach((id) => { el[id] = $(id); });
      for (let i = 0; i < TAG_POOL; i++) {
        const t = document.createElement('div');
        t.className = 'tag';
        t.innerHTML = '<span></span><i><u></u></i>';
        t.style.display = 'none';
        el.tags.appendChild(t);
        tags.push(t);
      }
      for (let i = 0; i < FLOAT_POOL; i++) {
        const node = document.createElement('div');
        node.className = 'float';
        node.style.display = 'none';
        el.tags.appendChild(node);
        floats.push({ node, t: 0, x: 0, y: 0, z: 0 });
      }
      mapBase = document.createElement('canvas');
      mapBase.width = MAP_W; mapBase.height = MAP_H;
      mapCtx = $('mini').getContext('2d');
    },

    show(on) { el.hud.hidden = !on; },

    chat(channel, name, text, color) {
      const label = { party: '파티', world: '월드', system: '시스템' }[channel] || channel;
      const line = document.createElement('div');
      line.className = 'c-' + channel;
      line.innerHTML = `<em>[${label}]</em> ${name ? `<b style="color:${color || '#fff'}">${esc(name)}</b>: ` : ''}<span${!name && color ? ` style="color:${color}"` : ''}>${esc(text)}</span>`;
      el.chat.appendChild(line);
      while (el.chat.children.length > MAX_CHAT) el.chat.removeChild(el.chat.firstChild);
    },

    toast(text, color) {
      el.toast.textContent = text;
      el.toast.style.color = color || '';
      flash('toast', 2200);
    },

    banner(title, sub) {
      el.banner.innerHTML = `<small>${esc(sub || '')}</small><b>${esc(title)}</b>`;
      flash('banner', 2800);
    },

    rule(name, sub) {
      el.rulebox.innerHTML = `<small>건물 규칙 변경</small><b>${esc(name)}</b><span>${esc(sub)}</span>`;
      flash('rulebox', 2600);
    },

    sub(text) {
      el.subline.textContent = text;
      flash('subline', 5200);
    },

    levelUp(lvl) {
      el.lvlup.innerHTML = `<small>LEVEL UP</small><b>LV ${lvl}</b>`;
      flash('lvlup', 1800);
    },

    showChoice(ev, onPick) {
      const hints = G.CONTENT.statHint, names = G.CONTENT.statName;
      el.choice.innerHTML = `<header><small>선택 사건 · 1 / 2 / 3</small><b>${esc(ev.title)}</b><p>${esc(ev.text)}</p></header>`
        + ev.choices.map((c, i) => `<button data-i="${i}"><kbd>${i + 1}</kbd> ${esc(c[0])}<small>${names[c[1]]} +${c[2]} · ${hints[c[1]]}</small></button>`).join('')
        + '<i class="timer"><u></u></i>';
      el.choice.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => onPick(Number(b.dataset.i))));
      el.choice.hidden = false;
    },

    hideChoice() { el.choice.hidden = true; },

    choiceTimer(f) {
      const u = el.choice.querySelector('.timer u');
      if (u) u.style.width = Math.max(0, f * 100) + '%';
    },

    floatText(x, y, z, text, color, big) {
      const f = floats.find((q) => q.t <= 0) || floats[0];
      f.x = x + (Math.random() - 0.5) * 0.4; f.y = y; f.z = z; f.t = FLOAT_LIFE;
      f.node.textContent = text;
      f.node.style.color = color;
      f.node.classList.toggle('big', !!big);
    },

    dead(on) { el.dead.hidden = !on; },

    reset() {
      el.chat.innerHTML = '';
      partyKey = '';
      floats.forEach((f) => { f.t = 0; f.node.style.display = 'none'; });
      this.hideChoice();
      this.dead(false);
    },

    update(S, dt) {
      const p = S.player, w = p.weapon, mirror = G.Rules.active(S, 'mirror');
      el.tc.textContent = timecode(S.time);
      el.mode.textContent = S.tps ? '3인칭 TPS' : '1인칭 FPS';
      el.expo.textContent = expo(S);
      const segs = Math.ceil(Math.max(0, p.hp) / p.maxHp * 4);
      el.batt.className = segs <= 1 ? 'low' : '';
      el.batt.dataset.v = segs;
      el.hpText.textContent = `${Math.max(0, Math.ceil(p.hp))}/${p.maxHp}`;
      const goal = S.boss ? '방문자를 쓰러뜨려라' : S.gateOpen ? '출구 개방 · 가장 남쪽 방으로' : '출구 봉인됨';
      el.obj.textContent = `봉인 ${S.restored}/${G.Main.GATE_NEED} · ${goal}`;
      el.ruleTag.textContent = S.rule ? `⚠ ${S.rule.name} ${Math.ceil(S.rule.left)}s` : '';
      const sk = G.CONTENT.skills[p.charId];
      el.skillName.textContent = sk.name;
      el.skillCd.style.height = (p.skillCd / sk.cd * 100) + '%';
      el.skillBox.classList.toggle('ready', p.skillCd <= 0);
      el.wname.textContent = w.name;
      el.wname.style.color = w.color;
      el.ammo.textContent = p.reloadT > 0 ? '[ 장전 ]' : G.Rules.active(S, 'burst') ? '[ ∞ ]' : `[ ${p.ammo} ]`;
      el.xpFill.style.width = (p.xp / (50 + p.lvl * 40) * 100) + '%';
      el.lvl.textContent = `LV ${p.lvl}`;
      const ray = S.cam && p.alive ? G.Actors.rayEnemy(S, S.cam.eye, S.cam.dir, G.world.raycast(S.cam.eye[0], S.cam.eye[1], S.cam.eye[2], S.cam.dir[0], S.cam.dir[1], S.cam.dir[2], 60), S.cam.minT) : null;
      el.af.classList.toggle('lock', !!ray);
      el.af.classList.toggle('aim', !!S.aiming);
      el.hitm.classList.toggle('show', S.hitMarkT > 0);
      if (S.boss) {
        el.bossbar.hidden = false;
        el.bossbar.querySelector('u').style.width = Math.max(0, S.boss.hp / S.boss.maxHp * 100) + '%';
      } else el.bossbar.hidden = true;
      drawParty(S);
      drawTags(S, mirror);
      drawFloats(dt, mirror);
      drawMap(S);
    },
  };

  G.hud = hud;
})(window.G);
