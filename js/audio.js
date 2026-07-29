// 极简 Web Audio 音效合成器：无需任何外部音频素材，全部用振荡器实时生成。
(function (global) {
  'use strict';

  let ctx = null;
  let enabled = true;

  function ensure() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 单个音符
  function tone(freq, dur, type, gain, when) {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.18, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // 合并音：随等级升高音调上扬
  function merge(level) {
    const base = 320 + level * 38;
    tone(base, 0.14, 'triangle', 0.16);
    tone(base * 1.5, 0.12, 'sine', 0.08, 0.02);
  }

  // 满级爆发：明亮和弦 + 噪声感
  function boom() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.5, 'sawtooth', 0.12, i * 0.04));
    tone(120, 0.4, 'sine', 0.18);
  }

  function select() { tone(540, 0.06, 'sine', 0.08); }
  function error() { tone(160, 0.12, 'square', 0.08); }
  function over() {
    [440, 349, 262].forEach((f, i) => tone(f, 0.35, 'triangle', 0.14, i * 0.12));
  }

  const SFX = { merge, boom, select, error, over, setEnabled: (v) => { enabled = v; }, resume: ensure };

  global.SFX = SFX;
})(window);
