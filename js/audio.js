'use strict';
window.G = window.G || {};
// 효과음은 WebAudio로 합성해 파일을 늘리지 않는다. 음악·특수음은 기존 mp3 다섯 개만 쓴다.
(function (G) {
  const TRACKS = { ambience: 0.32, masquerade: 0.5, ending: 0.6, shift: 0.55, neon: 0.4 };
  const SFX_GAP = { shot: 0.04, botshot: 0.09, hit: 0.03, orb: 0.12, hurt: 0.15 };
  let ctx = null, master = null, noise = null, enabled = true, music = null;
  const media = {};
  const lastPlayed = {};

  function tone(type, f0, f1, dur, vol, delay) {
    const t = ctx.currentTime + (delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function hiss(cutoff, dur, vol) {
    const t = ctx.currentTime;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  const SOUNDS = {
    shot: () => { hiss(2600, 0.09, 0.5); tone('sine', 140, 45, 0.1, 0.5); },
    rifle: () => { hiss(4200, 0.22, 0.6); tone('sine', 110, 30, 0.25, 0.7); },
    shotgun: () => { hiss(1800, 0.26, 0.75); tone('sine', 90, 30, 0.22, 0.7); },
    botshot: () => hiss(2200, 0.05, 0.12),
    hit: () => tone('square', 1300, 900, 0.03, 0.12),
    crit: () => { tone('square', 1800, 1500, 0.05, 0.16); tone('sine', 2600, 2400, 0.08, 0.1, 0.02); },
    kill: () => tone('sawtooth', 420, 70, 0.22, 0.2),
    hurt: () => { hiss(500, 0.18, 0.5); tone('sine', 90, 50, 0.15, 0.35); },
    boom: () => { hiss(700, 0.5, 0.8); tone('sine', 80, 25, 0.5, 0.6); },
    orb: () => tone('sine', 700, 320, 0.18, 0.1),
    pickup: () => { tone('sine', 880, 880, 0.08, 0.2); tone('sine', 1320, 1320, 0.12, 0.18, 0.07); },
    level: () => [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.16, 0.22, i * 0.08)),
    skill: () => tone('sawtooth', 200, 1200, 0.3, 0.16),
    event: () => { tone('triangle', 660, 660, 0.1, 0.18); tone('triangle', 990, 990, 0.16, 0.16, 0.1); },
    clear: () => [392, 523, 659].forEach((f, i) => tone('triangle', f, f, 0.2, 0.2, i * 0.1)),
  };

  const audio = {
    init() {
      Object.keys(TRACKS).forEach((name) => {
        const a = new Audio('assets/' + name + '.mp3');
        a.preload = 'auto';
        a.volume = TRACKS[name];
        if (name === 'ambience' || name === 'masquerade') a.loop = true;
        a.addEventListener('error', () => console.warn('음원을 불러오지 못했습니다:', name));
        media[name] = a;
      });
    },

    unlock() {
      try {
        if (!ctx) {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          master = ctx.createGain();
          master.gain.value = 0.45;
          master.connect(ctx.destination);
          noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (err) {
        console.warn('WebAudio를 사용할 수 없습니다:', err);
      }
    },

    sfx(name) {
      if (!enabled || !ctx || !SOUNDS[name]) return;
      const now = ctx.currentTime;
      if (now - (lastPlayed[name] || 0) < (SFX_GAP[name] || 0)) return;
      lastPlayed[name] = now;
      SOUNDS[name]();
    },

    play(name) {
      const a = media[name];
      if (!enabled || !a) return;
      a.currentTime = 0;
      a.play().catch(() => {});
    },

    music(name) {
      if (music && music !== media[name]) music.pause();
      music = media[name] || null;
      if (enabled && music) { music.currentTime = 0; music.play().catch(() => {}); }
    },

    toggle() {
      enabled = !enabled;
      if (!enabled) Object.values(media).forEach((a) => a.pause());
      else if (music) music.play().catch(() => {});
      return enabled;
    },
  };

  G.audio = audio;
})(window.G);
