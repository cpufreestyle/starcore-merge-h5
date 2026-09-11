// 合成星核 Star Core Merge — 纯前端休闲益智游戏核心逻辑 v2
// 新增：道具系统、成就系统、解谜模式、动态背景、拖尾粒子、震动反馈
(function () {
  'use strict';

  const GRID = 5;
  const MAX_LEVEL = 7;          // 7级即可爆发（原8级）
  const TIMED_SECONDS = 60;
  const RAINBOW_CHANCE = 0.12;   // 彩虹核心概率 8%→12%
  const STORM_THRESHOLD = 5;
  const INITIAL_CORES = 10;      // 初始核心 12→10（更多操作空间）
  const COMBO_GRACE = 1500;      // 连击宽容期 1.5s
  const ENERGY_MAX = 20;         // 能量条上限

  // 核心配色：默认主题，可被 index.html 中的 window.STARCORE_THEME.colors 覆盖
  const COLORS = Object.assign({
    1: '#5b8def', 2: '#4fd1c5', 3: '#68d391', 4: '#f6e05e',
    5: '#f6ad55', 6: '#fc8181', 7: '#b794f4', 8: '#f687b3'
  }, (window.STARCORE_THEME && window.STARCORE_THEME.colors) || {});
  // 预计算高光色，避免每帧对每个核心重复解析十六进制串
  const LIGHTEN_COLORS = {};
  for (let lv = 1; lv <= 8; lv++) LIGHTEN_COLORS[lv] = lighten(COLORS[lv] || '#888', 0.35);

  // === DOM ===
  const canvas = document.getElementById('board');
  const boardWrap = document.getElementById('boardWrap');
  const ctx = canvas.getContext('2d');
  const $score = document.getElementById('score');
  const $best = document.getElementById('best');
  const $modeLabel = document.getElementById('modeLabel');
  const $modeVal = document.getElementById('modeVal');
  const $hint = document.getElementById('hint');
  const $menu = document.getElementById('menuOverlay');
  const $pause = document.getElementById('pauseOverlay');
  const $over = document.getElementById('overOverlay');
  const $finalScore = document.getElementById('finalScore');
  const $finalBest = document.getElementById('finalBest');
  const $overTitle = document.getElementById('overTitle');
  const $boardOverlay = document.getElementById('boardOverlay');
  const $boardList = document.getElementById('boardList');
  const $toast = document.getElementById('toast');
  const $achOverlay = document.getElementById('achOverlay');
  const $achGrid = document.getElementById('achGrid');
  const $achPop = document.getElementById('achievementPop');
  const $achTitle = document.getElementById('achTitle');
  const $achDesc = document.getElementById('achDesc');
  const $puzzleInfo = document.getElementById('puzzleInfo');
  const $puzzleTitle = document.getElementById('puzzleTitle');
  const $puzzleDesc = document.getElementById('puzzleDesc');
  const $puzzleGoal = document.getElementById('puzzleGoal');
  const $dailyOverlay = document.getElementById('dailyOverlay');

  // 常用 DOM 引用缓存，避免热路径中反复 getElementById
  const $app = document.getElementById('app');
  const $comboBanner = document.getElementById('comboBanner');
  const $energyFill = document.getElementById('energyFill');
  const $energyLabel = document.getElementById('energyLabel');
  const $comboBar = document.getElementById('comboBar');
  const $comboFill = document.getElementById('comboFill');
  const $comboLabel = document.getElementById('comboLabel');
  const $tutorialOverlay = document.getElementById('tutorialOverlay');
  const $careerOverlay = document.getElementById('careerOverlay');
  const $careerGrid = document.getElementById('careerGrid');
  const TOOL_KEYS = ['lightning', 'shuffle', 'hint', 'bomb'];
  const $toolCount = {};
  const $toolBtn = {};
  TOOL_KEYS.forEach(function (t) {
    $toolCount[t] = document.getElementById(t + 'Count');
    $toolBtn[t] = document.getElementById('tool' + t.charAt(0).toUpperCase() + t.slice(1));
  });

  // === 状态 ===
  let cores = Array.from({ length: GRID }, () => Array(GRID).fill(null));
  let selected = null;
  let score = 0, best = 0;
  let mode = 'classic';
  let running = false, paused = false, gameOver = false, inputLocked = false;
  let combo = 0, maxCombo = 0;
  let comboTimer = 0;            // 连击宽容计时
  let energy = 0;               // 能量条
  let shieldUsed = false;       // 护盾是否已用
  let isDaily = false;          // 本次对局是否为每日挑战（每日按天结算，不支持续玩）
  let elapsed = 0;
  let lastT = 0;
  let dpr = 1, boardPx = 0, pad = 0, gap = 0, cell = 0;
  let anims = [];
  let particles = [];
  let floats = [];
  let stars = [];
  let nebulaT = 0; // 动态星云时间
  let stormActive = false; // 连击风暴
  let stormEndT = 0;

  // 道具
  let tools = { lightning: 2, shuffle: 1, hint: 3, bomb: 1 };
  let activeTool = null; // 'lightning' | 'bomb' | null
  // 暴露给商店模块
  window.StarCoreTools = tools;
  window.StarCoreUpdateToolHud = updateToolHud;

  // 成就
  const ACHIEVEMENTS = [
    { id: 'first_merge', emoji: '🌟', name: '初次合成', desc: '完成第一次合并', check: s => s.totalMerges >= 1 },
    { id: 'combo_5', emoji: '🔗', name: '连击大师', desc: '单局5连击', check: s => s.maxCombo >= 5 },
    { id: 'combo_10', emoji: '⚡', name: '连锁狂魔', desc: '单局10连击', check: s => s.maxCombo >= 10 },
    { id: 'boom_1', emoji: '💥', name: '星核爆发', desc: '触发首次爆发', check: s => s.booms >= 1 },
    { id: 'boom_5', emoji: '🌌', name: '超新星', desc: '单局5次爆发', check: s => s.booms >= 5 },
    { id: 'score_500', emoji: '🏅', name: '初露锋芒', desc: '单局500分', check: s => s.score >= 500 },
    { id: 'score_2000', emoji: '🏆', name: '星核达人', desc: '单局2000分', check: s => s.score >= 2000 },
    { id: 'score_5000', emoji: '👑', name: '星核之王', desc: '单局5000分', check: s => s.score >= 5000 },
    { id: 'level_7', emoji: '🔮', name: '接近极限', desc: '合成出7级核心', check: s => s.maxLevel >= 7 },
    { id: 'puzzle_5', emoji: '🧩', name: '解谜高手', desc: '通过5个解谜关卡', check: s => s.puzzleCleared >= 5 },
    { id: 'puzzle_all', emoji: '🎓', name: '全关通过', desc: '通过全部解谜关卡', check: s => s.puzzleCleared >= 20 },
    { id: 'tool_master', emoji: '🛠️', name: '道具专家', desc: '单局使用全部4种道具', check: s => s.toolsUsedAll },
    { id: 'storm_1', emoji: '🌪️', name: '风暴觉醒', desc: '触发首次连击风暴', check: s => s.storms >= 1 },
    { id: 'storm_3', emoji: '🌩️', name: '风暴之子', desc: '单局触发3次连击风暴', check: s => s.storms >= 3 },
    { id: 'rainbow_1', emoji: '🌈', name: '彩虹链接', desc: '合成出彩虹核心', check: s => s.rainbows >= 1 },
    { id: 'rainbow_5', emoji: '✨', name: '彩虹大师', desc: '单局合成5个彩虹核心', check: s => s.rainbows >= 5 },
    { id: 'daily_1', emoji: '📅', name: '每日勇者', desc: '完成1次每日挑战', check: s => s.dailyDone >= 1 },
    { id: 'daily_7', emoji: '📆', name: '坚持一周', desc: '完成7次每日挑战', check: s => s.dailyDone >= 7 },
    { id: 'awaken_1', emoji: '🌟', name: '觉醒时刻', desc: '触发星核觉醒', check: s => s.awakens >= 1 },
    { id: 'awaken_3', emoji: '⭐', name: '觉醒大师', desc: '单局触发3次星核觉醒', check: s => s.awakens >= 3 },
    { id: 'shield_1', emoji: '🛡️', name: '绝处逢生', desc: '护盾触发救场', check: s => s.shields >= 1 },
    { id: 'combo_15', emoji: '🔥', name: '烈焰连击', desc: '单局15连击', check: s => s.maxCombo >= 15 },
    { id: 'resonance_1', emoji: '🌟', name: '星核共鸣', desc: '触发首次星核共鸣链', check: s => (s.resonances || 0) >= 1 },
    { id: 'resonance_5', emoji: '💫', name: '连锁星河', desc: '单次共鸣连锁达到5连', check: s => (s.maxResonance || 0) >= 5 },
  ];
  let stats = { totalMerges: 0, maxCombo: 0, booms: 0, score: 0, maxLevel: 0, puzzleCleared: 0, toolsUsedAll: false, toolsUsed: {}, storms: 0, rainbows: 0, dailyDone: 0, awakens: 0, shields: 0, resonances: 0, maxResonance: 0 };
  let unlockedAch = new Set();

  // 解谜关卡
  const PUZZLE_LEVELS = [
    { goal: 'score', target: 50, moves: 8, desc: '8步内得到50分' },
    { goal: 'score', target: 100, moves: 10, desc: '10步内得到100分' },
    { goal: 'level', target: 5, moves: 12, desc: '12步内合成出5级核心' },
    { goal: 'boom', target: 1, moves: 15, desc: '15步内触发1次星核爆发' },
    { goal: 'score', target: 200, moves: 12, desc: '12步内得到200分' },
    { goal: 'level', target: 6, moves: 15, desc: '15步内合成出6级核心' },
    { goal: 'combo', target: 3, moves: 10, desc: '10步内达成3连击' },
    { goal: 'score', target: 300, moves: 15, desc: '15步内得到300分' },
    { goal: 'boom', target: 2, moves: 18, desc: '18步内触发2次爆发' },
    { goal: 'level', target: 7, moves: 20, desc: '20步内合成出7级核心' },
    { goal: 'score', target: 500, moves: 18, desc: '18步内得到500分' },
    { goal: 'combo', target: 5, moves: 15, desc: '15步内达成5连击' },
    { goal: 'score', target: 800, moves: 20, desc: '20步内得到800分' },
    { goal: 'boom', target: 3, moves: 20, desc: '20步内触发3次爆发' },
    { goal: 'level', target: 7, moves: 15, desc: '15步内合成出7级核心' },
    { goal: 'score', target: 1200, moves: 22, desc: '22步内得到1200分' },
    { goal: 'combo', target: 8, moves: 18, desc: '18步内达成8连击' },
    { goal: 'score', target: 2000, moves: 25, desc: '25步内得到2000分' },
    { goal: 'boom', target: 5, moves: 25, desc: '25步内触发5次爆发' },
    { goal: 'score', target: 3000, moves: 25, desc: '25步内得到3000分' },
  ];
  let puzzleLevel = 0;
  let puzzleMoves = 0;
  let dailySeed = 0;
  let dailyPlayed = false;

  // ---------- 工具 ----------
  function rint(n) { return Math.floor(Math.random() * n); }
  function inBounds(r, c) { return r >= 0 && r < GRID && c >= 0 && c < GRID; }
  function adjacent(a, b) { return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1; }
  function emptyCells() {
    const list = [];
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (!cores[r][c]) list.push({ r, c });
    return list;
  }
  function weightedLevel() {
    const x = seededRand ? seededRand() : Math.random();
    if (x < 0.5) return 1;
    if (x < 0.8) return 2;
    return 3;
  }
  function roundRect(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function easeOutBack(t) {
    const s = 1.70158;
    return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
  }
  function haptic(ms) {
    if (navigator.vibrate) try { navigator.vibrate(ms); } catch (e) {}
  }

  // 种子随机数（用于每日挑战）
  let seededRand = null;
  function mulberry32(seed) {
    return function() {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // 连击风暴
  function triggerStorm() {
    stormActive = true;
    stormEndT = performance.now() + 4000; // 4秒
    stats.storms++;
    $comboBanner.textContent = '🌪️ 连击风暴 x' + combo + '!';
    $comboBanner.classList.remove('show');
    void $comboBanner.offsetWidth; // reflow
    $comboBanner.classList.add('show');
    $app.classList.remove('storm');
    void $app.offsetWidth;
    $app.classList.add('storm');
    haptic([40, 80, 40, 80, 40]);
    SFX.boom();
    checkAchievements();
    setTimeout(() => {
      stormActive = false;
      $app.classList.remove('storm');
    }, 4000);
  }

  // 星核觉醒：能量条满时触发，全场核心降1级 + 分数加成
  function awakenStarCore() {
    toast('🌟 星核觉醒！');
    haptic([50, 80, 50, 80, 100]);
    SFX.boom();
    stats.awakens++;
    let count = 0;
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const v = cores[r][c];
      if (v && v.level > 1 && !v.rainbow) {
        v.level = Math.max(1, v.level - 1);
        v.pop = performance.now();
        const rc = cellRect(r, c);
        burst(rc.cx, rc.cy, COLORS[v.level] || '#888', 8);
        count++;
      }
    }
    const bonus = count * 15;
    score += bonus;
    stats.score = score;
    // 全屏闪光
    $app.classList.remove('storm');
    void $app.offsetWidth;
    $app.classList.add('storm');
    setTimeout(() => $app.classList.remove('storm'), 600);
    // 中心冲击波
    const cc = cellRect(2, 2);
    shockwaves.push({ x: cc.cx, y: cc.cy, r: 0, maxR: cell * 5, born: performance.now() });
    addFloat(cc.cx, cc.cy, '🌟 +' + bonus, '#ffe66d');
    ensurePlayable();
  }

  // 护盾：棋盘锁死时自动重排（每局1次）
  function tryShield() {
    if (shieldUsed) return false;
    shieldUsed = true;
    stats.shields++;
    toast('🛡️ 护盾触发！重排核心中…');
    haptic([30, 60, 30, 60, 30]);
    // 保留一半核心，另一半重新生成
    const allCores = [];
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      if (cores[r][c]) allCores.push({ r, c, level: cores[r][c].level, rainbow: cores[r][c].rainbow });
    }
    // 随机移除一半
    allCores.sort(() => Math.random() - 0.5);
    const keep = Math.ceil(allCores.length / 2);
    cores = Array.from({ length: GRID }, () => Array(GRID).fill(null));
    for (let i = 0; i < keep; i++) {
      const pos = allCores[i];
      cores[pos.r][pos.c] = { level: pos.level, born: performance.now(), pop: performance.now(), rainbow: pos.rainbow };
    }
    // 填充新核心
    while (emptyCells().length > GRID * GRID - INITIAL_CORES) spawnOne();
    ensurePlayable();
    updateHud();
    return true;
  }

  // ---------- 布局 ----------
  function resize() {
    // 以 #boardWrap 的可用空间为基准，把棋盘设成能放进容器的最大正方形
    // 容器尚未完成布局（宽高为 0）时跳过，避免把棋盘尺寸钉死在 120px 最小值
    const wrapW = boardWrap.clientWidth;
    const wrapH = boardWrap.clientHeight;
    if (wrapW <= 0 || wrapH <= 0) return;
    const avail = Math.min(wrapW, wrapH);
    boardPx = Math.max(120, Math.floor(avail * 0.98));
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    canvas.style.width = boardPx + 'px';
    canvas.style.height = boardPx + 'px';
    canvas.width = Math.round(boardPx * dpr);
    canvas.height = Math.round(boardPx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pad = boardPx * 0.045;
    gap = boardPx * 0.025;
    cell = (boardPx - pad * 2 - gap * (GRID - 1)) / GRID;
    buildNebulaSprites();
    buildCoreSprites();
  }

  // 预渲染星云精灵（一次性径向渐变），每帧仅 drawImage 到位，避免每帧 createRadialGradient
  let nebulaSprites = [];
  const NEBULA_COLORS = ['rgba(91,141,239,0.04)', 'rgba(79,209,197,0.035)', 'rgba(183,148,244,0.03)'];
  function buildNebulaSprites() {
    if (!boardPx) return;
    nebulaSprites = NEBULA_COLORS.map(function (c) {
      const cv = document.createElement('canvas');
      cv.width = boardPx; cv.height = boardPx;
      const nctx = cv.getContext('2d');
      const grad = nctx.createRadialGradient(boardPx / 2, boardPx / 2, 0, boardPx / 2, boardPx / 2, boardPx / 2);
      grad.addColorStop(0, c);
      grad.addColorStop(1, 'transparent');
      nctx.fillStyle = grad;
      nctx.fillRect(0, 0, boardPx, boardPx);
      return cv;
    });
  }

  // 预渲染核心精灵（一次性径向渐变 + 数字），每帧仅 drawImage 到位。
  // 静态核心 size==cell，drawImage 在 dpr 变换下为 1:1，与原实时绘制像素一致；
  // born/pop 动画期间 size 略变，缩放可接受。彩虹核心色相逐帧旋转，单独实时绘制。
  let coreSprites = {};
  function buildCoreSprites() {
    if (!cell || !dpr) return;
    coreSprites = {};
    const S = Math.round(cell * dpr);
    if (S <= 0) return;
    for (let lv = 1; lv <= 8; lv++) {
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const g = cv.getContext('2d');
      const color = COLORS[lv] || '#888';
      const sz = S, cx = S / 2, cy = S / 2;
      roundRect(g, 0, 0, S, S, S * 0.2);
      const grad = g.createRadialGradient(cx - S * 0.18, cy - S * 0.18, S * 0.1, cx, cy, S * 0.75);
      grad.addColorStop(0, LIGHTEN_COLORS[lv] || lighten(color, 0.35));
      grad.addColorStop(1, color);
      g.fillStyle = grad;
      g.fill();
      // 数字（随等级固定，一并烘焙进精灵，省去每帧 ctx.font/fillText）
      g.fillStyle = '#0b0b1f';
      g.font = '800 ' + Math.round(S * 0.42) + 'px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(lv), cx, cy + S * 0.02);
      coreSprites[lv] = cv;
    }
  }
  function cellRect(r, c) {
    const x = pad + c * (cell + gap);
    const y = pad + r * (cell + gap);
    return { x, y, cx: x + cell / 2, cy: y + cell / 2 };
  }
  // 数学直接定位：原先每次点击要遍历 25 格并各分配一个 rect 对象，现改为 O(1)
  function cellAt(px, py) {
    const stride = cell + gap;
    const c = Math.floor((px - pad) / stride);
    const r = Math.floor((py - pad) / stride);
    if (!inBounds(r, c)) return null;
    if (px > pad + c * stride + cell || py > pad + r * stride + cell) return null; // 落在格间缝隙
    return { r, c };
  }

  // ---------- 棋盘逻辑 ----------
  function newGame(m) {
    mode = m;
    isDaily = (m === 'daily');
    cores = Array.from({ length: GRID }, () => Array(GRID).fill(null));
    selected = null; score = 0; combo = 0; maxCombo = 0; comboTimer = 0; energy = 0; shieldUsed = false;
    elapsed = 0; anims = []; particles = []; floats = [];
    running = true; paused = false; gameOver = false; inputLocked = false;
    activeTool = null;
    tools = { lightning: 3, shuffle: 2, hint: 4, bomb: 2 };  // 道具增加
    window.StarCoreTools = tools; // 新对象需重新暴露，否则商店/广告发放的道具写到旧引用
    if (window.StarCoreShop) window.StarCoreShop.resetRevive();
    const prevDaily = stats ? (stats.dailyDone || 0) : 0;
    stats = { totalMerges: 0, maxCombo: 0, booms: 0, score: 0, maxLevel: 0, puzzleCleared: stats.puzzleCleared || 0, toolsUsedAll: false, toolsUsed: {}, storms: 0, rainbows: 0, dailyDone: prevDaily, awakens: 0, shields: 0, resonances: 0, maxResonance: 0 };

    if (m === 'daily') {
      // 每日挑战：固定种子 + 计时模式 + 无道具
      const today = new Date();
      dailySeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
      // 检查今天是否已玩过
      const lastDaily = parseInt(localStorage.getItem('starcore_daily_last') || '0', 10);
      dailyPlayed = (lastDaily === dailySeed);
      mode = 'timed'; // 用计时模式逻辑
      tools = { lightning: 0, shuffle: 0, hint: 0, bomb: 0 };
      $menu.classList.add('hidden');
      // 用种子生成固定棋盘
      seededRand = mulberry32(dailySeed);
      spawnInitial();
      seededRand = null;
      ensurePlayable();
      updateHud();
      updateToolHud();
      $hint.textContent = '📅 每日挑战 — 今天所有玩家同关！60秒拿高分';
      return;
    }

    if (m === 'puzzle') {
      const pz = PUZZLE_LEVELS[puzzleLevel];
      if (!pz) { toast('已通关全部关卡！'); return; }
      puzzleMoves = pz.moves;
      $puzzleTitle.textContent = '第 ' + (puzzleLevel + 1) + ' 关';
      $puzzleDesc.textContent = pz.desc;
      $puzzleGoal.textContent = '剩余步数: ' + puzzleMoves;
      $puzzleInfo.classList.remove('hidden');
      $menu.classList.add('hidden');
      running = false;   // 关卡信息展示阶段尚未开局，避免存下空棋盘
      return; // 等待玩家点击开始
    }

    $menu.classList.add('hidden');
    $pause.classList.add('hidden');
    $over.classList.add('hidden');
    spawnInitial();
    ensurePlayable();
    updateHud();
    updateToolHud();
    $hint.textContent = mode === 'timed'
      ? '60 秒内尽可能拿高分，连击越多分越高！'
      : '点击相邻同色核心合并，凑出两个 7 引爆星核！';
    saveGame();
  }

  function startPuzzle() {
    $puzzleInfo.classList.add('hidden');
    running = true; paused = false; gameOver = false; inputLocked = false;
    cores = Array.from({ length: GRID }, () => Array(GRID).fill(null));
    selected = null; score = 0; combo = 0; maxCombo = 0; comboTimer = 0; energy = 0; shieldUsed = false;
    anims = []; particles = []; floats = [];
    spawnInitial();
    ensurePlayable();
    updateHud();
    updateToolHud();
    const pz = PUZZLE_LEVELS[puzzleLevel];
    $hint.textContent = pz.desc + '（剩余 ' + puzzleMoves + ' 步）';
    saveGame();
  }

  function spawnInitial() {
    for (let i = 0; i < INITIAL_CORES; i++) spawnOne();
  }
  function spawnOne() {
    const empties = emptyCells();
    if (!empties.length) return;
    const { r, c } = empties[rint(empties.length)];
    cores[r][c] = { level: weightedLevel(), born: performance.now(), pop: 0 };
  }
  function spawn(n) { for (let i = 0; i < n; i++) spawnOne(); }

  function ensurePlayable() {
    if (canMergeAnywhere()) return;
    const filled = [];
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (cores[r][c]) filled.push({ r, c });
    if (!filled.length) { spawnOne(); return; }
    const src = filled[rint(filled.length)];
    const neigh = [{ r: src.r - 1, c: src.c }, { r: src.r + 1, c: src.c }, { r: src.r, c: src.c - 1 }, { r: src.r, c: src.c + 1 }]
      .filter(p => inBounds(p.r, p.c) && !cores[p.r][p.c]);
    if (neigh.length) {
      const t = neigh[rint(neigh.length)];
      cores[t.r][t.c] = { level: cores[src.r][src.c].level, born: performance.now(), pop: 0 };
    }
  }

  function canMergeAnywhere() {
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const v = cores[r][c];
      if (!v) continue;
      // 彩虹核心可以和任何相邻核心合并
      if (v.rainbow) return true;
      if (c + 1 < GRID && cores[r][c + 1] && (cores[r][c + 1].level === v.level || cores[r][c + 1].rainbow)) return true;
      if (r + 1 < GRID && cores[r + 1][c] && (cores[r + 1][c].level === v.level || cores[r + 1][c].rainbow)) return true;
    }
    return false;
  }

  function findHintPair() {
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const v = cores[r][c];
      if (!v) continue;
      if (v.rainbow) {
        // 彩虹核心：找任何相邻的核心
        if (c + 1 < GRID && cores[r][c + 1]) return [{ r, c }, { r, c: c + 1 }];
        if (r + 1 < GRID && cores[r + 1][c]) return [{ r, c }, { r: r + 1, c }];
        if (c - 1 >= 0 && cores[r][c - 1]) return [{ r, c }, { r, c: c - 1 }];
        if (r - 1 >= 0 && cores[r - 1][c]) return [{ r, c }, { r: r - 1, c }];
      }
      if (c + 1 < GRID && cores[r][c + 1] && (cores[r][c + 1].level === v.level || cores[r][c + 1].rainbow)) return [{ r, c }, { r, c: c + 1 }];
      if (r + 1 < GRID && cores[r + 1][c] && (cores[r + 1][c].level === v.level || cores[r + 1][c].rainbow)) return [{ r, c }, { r: r + 1, c }];
    }
    return null;
  }

  // ---------- 道具 ----------
  function useLightning(target) {
    if (tools.lightning <= 0) return;
    tools.lightning--;
    stats.toolsUsed.lightning = true;
    const rc = cellRect(target.r, target.c);
    burst(rc.cx, rc.cy, '#ffd479', 20);
    cores[target.r][target.c] = null;
    haptic(30);
    SFX.boom();
    toast('⚡ 闪电击中！');
    checkToolsAchievement();
    updateToolHud();
    spawn(1);
    ensurePlayable();
    checkEnd();
    saveGame();
  }

  function useBomb(target) {
    if (tools.bomb <= 0) return;
    tools.bomb--;
    stats.toolsUsed.bomb = true;
    const rc = cellRect(target.r, target.c);
    burst(rc.cx, rc.cy, '#fc8181', 40);
    haptic(50);
    SFX.boom();
    // 清除 3x3 范围
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = target.r + dr, c = target.c + dc;
        if (inBounds(r, c) && cores[r][c]) {
          const pr = cellRect(r, c);
          burst(pr.cx, pr.cy, COLORS[cores[r][c].level] || '#888', 10);
          cores[r][c] = null;
        }
      }
    }
    toast('💥 炸弹清除！');
    checkToolsAchievement();
    updateToolHud();
    spawn(2);
    ensurePlayable();
    checkEnd();
    saveGame();
  }

  function useShuffle() {
    if (tools.shuffle <= 0) return;
    tools.shuffle--;
    stats.toolsUsed.shuffle = true;
    // 收集所有核心
    const allCores = [];
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      if (cores[r][c]) allCores.push(cores[r][c]);
    }
    // 打乱
    for (let i = allCores.length - 1; i > 0; i--) {
      const j = rint(i + 1);
      [allCores[i], allCores[j]] = [allCores[j], allCores[i]];
    }
    // 重新放置
    cores = Array.from({ length: GRID }, () => Array(GRID).fill(null));
    let idx = 0;
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      if (idx < allCores.length) {
        cores[r][c] = allCores[idx++];
        cores[r][c].pop = performance.now();
      }
    }
    haptic(40);
    SFX.select();
    toast('🔄 棋盘已洗牌！');
    checkToolsAchievement();
    updateToolHud();
    ensurePlayable();
    checkEnd();
    saveGame();
  }

  function useHint() {
    if (tools.hint <= 0) return;
    tools.hint--;
    stats.toolsUsed.hint = true;
    const pair = findHintPair();
    if (pair) {
      // 高亮闪烁
      pair.forEach(p => {
        const v = cores[p.r][p.c];
        if (v) v.hintT = performance.now();
      });
      haptic(20);
      SFX.select();
      toast('💡 看闪光的位置！');
    } else {
      toast('没有可合并的了！');
    }
    checkToolsAchievement();
    updateToolHud();
    saveGame();
  }

  function checkToolsAchievement() {
    if (stats.toolsUsed.lightning && stats.toolsUsed.shuffle && stats.toolsUsed.hint && stats.toolsUsed.bomb) {
      stats.toolsUsedAll = true;
    }
    checkAchievements();
  }

  function updateToolHud() {
    if ($toolCount.lightning) $toolCount.lightning.textContent = tools.lightning;
    if ($toolCount.shuffle) $toolCount.shuffle.textContent = tools.shuffle;
    if ($toolCount.hint) $toolCount.hint.textContent = tools.hint;
    if ($toolCount.bomb) $toolCount.bomb.textContent = tools.bomb;

    for (const t of TOOL_KEYS) {
      const btn = $toolBtn[t];
      if (btn) {
        btn.classList.toggle('disabled', tools[t] <= 0);
        btn.classList.toggle('active', activeTool === t);
      }
    }
  }

  // ---------- 成就 ----------
  function loadAchievements() {
    try {
      const saved = JSON.parse(localStorage.getItem('starcore_ach_v1') || '[]');
      unlockedAch = new Set(saved);
    } catch (e) { unlockedAch = new Set(); }
  }
  function saveAchievements() {
    try { localStorage.setItem('starcore_ach_v1', JSON.stringify([...unlockedAch])); } catch (e) {}
  }
  function checkAchievements() {
    for (const ach of ACHIEVEMENTS) {
      if (!unlockedAch.has(ach.id) && ach.check(stats)) {
        unlockedAch.add(ach.id);
        saveAchievements();
        showAchievement(ach);
      }
    }
  }
  function showAchievement(ach) {
    $achTitle.textContent = ach.name;
    $achDesc.textContent = ach.desc;
    $achPop.classList.remove('hidden');
    $achPop.classList.add('show');
    haptic([30, 50, 30]);
    setTimeout(() => {
      $achPop.classList.remove('show');
      setTimeout(() => $achPop.classList.add('hidden'), 300);
    }, 2500);
  }
  function showAchWall() {
    $achGrid.innerHTML = ACHIEVEMENTS.map(ach => {
      const unlocked = unlockedAch.has(ach.id);
      return '<div class="ach-card ' + (unlocked ? 'unlocked' : 'locked') + '">' +
        '<span class="ach-emoji">' + ach.emoji + '</span>' +
        '<div class="ach-name">' + ach.name + '</div>' +
        '<div class="ach-desc-text">' + ach.desc + '</div>' +
        '</div>';
    }).join('');
    $achOverlay.classList.remove('hidden');
  }

  // ---------- 星核共鸣（创新玩法）----------
  // 当一次合并创造出棋盘“新峰值”核心时，触发共鸣脉冲：
  // 自动连锁场上所有 3 级及以上的相邻同色对，形成连锁爆发。
  const RESONANCE_MIN = 3;   // 仅连锁 3 级及以上，避免无脑清屏
  function findResonancePair() {
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const v = cores[r][c];
      if (!v || v.level < RESONANCE_MIN || v.rainbow) continue;
      const neigh = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
      for (const [nr, nc] of neigh) {
        if (!inBounds(nr, nc)) continue;
        const w = cores[nr][nc];
        if (w && !w.rainbow && w.level === v.level && w.level < MAX_LEVEL) return [{ r, c }, { r: nr, c: nc }];
      }
    }
    return null;
  }
  function triggerResonance(peak) {
    let cascade = 0, gained = 0, guard = 0;
    while (guard++ < 80) {
      const pair = findResonancePair();
      if (!pair) break;
      const a = pair[0], b = pair[1];
      const lvl = cores[a.r][a.c].level;
      cores[a.r][a.c] = null;
      cascade++;
      const cMult = 1 + cascade * 0.25; // 连锁倍率
      const bRC = cellRect(b.r, b.c);
      let g;
      if (lvl + 1 < MAX_LEVEL) {
        cores[b.r][b.c] = { level: lvl + 1, born: performance.now(), pop: performance.now(), rainbow: false };
        g = Math.round((lvl + 1) * 14 * cMult);
        score += g; gained += g; stats.totalMerges++;
        if (lvl + 1 > stats.maxLevel) stats.maxLevel = lvl + 1;
        burst(bRC.cx, bRC.cy, COLORS[lvl + 1] || '#888', 8);
      } else {
        // 连锁到 7 级 → 爆发
        cores[b.r][b.c] = null;
        stats.booms++;
        g = Math.round(150 * cMult);
        score += g; gained += g;
        triggerBoom(b);
      }
      addFloat(bRC.cx, bRC.cy, '🌟+' + g, '#ffe66d');
    }
    if (cascade > 0) {
      stats.resonances = (stats.resonances || 0) + 1;
      if (cascade > (stats.maxResonance || 0)) stats.maxResonance = cascade;
      toast('🌟 星核共鸣 x' + cascade + '! +' + gained);
      haptic([20, 40, 20, 40, 20]);
      SFX.boom();
      const cc = cellRect(2, 2);
      shockwaves.push({ x: cc.cx, y: cc.cy, r: 0, maxR: cell * 6, born: performance.now() });
      stats.score = score;
      ensurePlayable();
      checkAchievements();
      checkEnd();
    }
  }

  // ---------- 输入处理 ----------
  function handlePointer(e) {
    if (!running || paused || gameOver || inputLocked) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX !== undefined ? e.clientX : e.touches[0].clientX) - rect.left;
    const py = (e.clientY !== undefined ? e.clientY : e.touches[0].clientY) - rect.top;
    const hit = cellAt(px, py);
    if (!hit) return;

    const { r, c } = hit;

    // 道具模式：点击目标
    if (activeTool === 'lightning') {
      if (cores[r][c]) useLightning({ r, c });
      activeTool = null;
      updateToolHud();
      return;
    }
    if (activeTool === 'bomb') {
      if (cores[r][c]) useBomb({ r, c });
      activeTool = null;
      updateToolHud();
      return;
    }

    if (!cores[r][c]) { selected = null; return; }
    if (!selected) { selected = { r, c }; SFX.select(); return; }
    if (selected.r === r && selected.c === c) { selected = null; return; }

    const sel = cores[selected.r][selected.c];
    const tgt = cores[r][c];
    const sameLevel = sel.level === tgt.level;
    const hasRainbow = sel.rainbow || tgt.rainbow;
    if (adjacent(selected, { r, c }) && (sameLevel || hasRainbow)) {
      doMerge(selected, { r, c });
    } else {
      selected = { r, c }; SFX.select();
    }
  }

  function doMerge(from, to) {
    const fromCore = cores[from.r][from.c];
    const toCore = cores[to.r][to.c];
    const peakBefore = maxLevelOnBoard(); // 合并前棋盘峰值（用于判定“新峰值→共鸣”）
    // 彩虹核心：取另一方等级，不+1
    const L = fromCore.rainbow ? toCore.level : fromCore.level;
    const newLevel = L + 1;
    cores[from.r][from.c] = null;
    selected = null;
    combo++;
    if (combo > maxCombo) maxCombo = combo;
    if (combo > stats.maxCombo) stats.maxCombo = combo;
    comboTimer = COMBO_GRACE; // 重置连击宽容计时
    energy = Math.min(ENERGY_MAX, energy + 1); // 能量+1
    
    const mult = 1 + (combo - 1) * 0.15 + (stormActive ? 1.0 : 0);

    const a = cellRect(from.r, from.c), b = cellRect(to.r, to.c);
    // 拖尾粒子
    for (let i = 0; i < 6; i++) {
      const t = i / 6;
      particles.push({
        x: a.cx + (b.cx - a.cx) * t,
        y: a.cy + (b.cy - a.cy) * t,
        vx: (Math.random() - 0.5) * 0.05 * boardPx,
        vy: (Math.random() - 0.5) * 0.05 * boardPx,
        life: 0.6, color: COLORS[L] || '#888', size: 2 + Math.random() * 2
      });
    }
    anims.push({ fromX: a.cx, fromY: a.cy, toX: b.cx, toY: b.cy, level: L, start: performance.now(), dur: 150 });
    inputLocked = true;
    stats.totalMerges++;

    if (newLevel < MAX_LEVEL) {
      cores[to.r][to.c] = { level: newLevel, born: performance.now() - 1000, pop: performance.now() };
      if (newLevel > stats.maxLevel) stats.maxLevel = newLevel;
      const gain = Math.round(newLevel * 10 * mult);
      score += gain;
      stats.score = score;
      addFloat(b.cx, b.cy, '+' + gain, COLORS[newLevel]);
      if (combo >= 2) addFloat(b.cx, b.cy - cell * 0.45, '连击 x' + combo, '#38e1ff');
      haptic(15 + combo * 3);
      SFX.merge(newLevel);
    } else {
      cores[to.r][to.c] = null;
      stats.booms++;
      const gain = Math.round(150 * mult);
      score += gain;
      stats.score = score;
      addFloat(b.cx, b.cy, '+' + gain, '#f687b3');
      addFloat(b.cx, b.cy - cell * 0.45, '星核爆发!', '#f687b3');
      triggerBoom(to);
      haptic([30, 60, 30]);
      SFX.boom();
    }

    // 星核共鸣：本次合并创造出棋盘“新峰值”核心 → 触发连锁脉冲
    if (newLevel > peakBefore) triggerResonance(newLevel);

    // 彩虹核心变异
    if (newLevel < MAX_LEVEL && cores[to.r][to.c] && Math.random() < RAINBOW_CHANCE) {
      cores[to.r][to.c].rainbow = true;
      stats.rainbows++;
      const rc = cellRect(to.r, to.c);
      burst(rc.cx, rc.cy, '#ff6b6b', 15);
      burst(rc.cx, rc.cy, '#4ecdc4', 15);
      burst(rc.cx, rc.cy, '#ffe66d', 15);
      addFloat(rc.cx, rc.cy - cell * 0.5, '🌈 彩虹核心!', '#ffe66d');
      haptic(20);
      checkAchievements();
    }

    // 连击风暴
    if (combo === STORM_THRESHOLD) {
      triggerStorm();
    }

    // 解谜模式扣步数
    if (mode === 'puzzle') {
      puzzleMoves--;
      checkPuzzleGoal();
    }

    // 每日挑战结算
    if (mode === 'timed' && dailySeed && !dailyPlayed) {
      // 标记已玩
      try { localStorage.setItem('starcore_daily_last', String(dailySeed)); } catch(e) {}
      stats.dailyDone = (stats.dailyDone || 0) + 1;
      dailyPlayed = true;
      checkAchievements();
    }

    // 连击阶梯奖励：3/6/10 连击奖励道具
    if (combo === 3) { tools.hint++; toast('💡 3连击奖励：+1 提示！'); updateToolHud(); }
    if (combo === 6) { tools.shuffle++; toast('🔄 6连击奖励：+1 洗牌！'); updateToolHud(); }
    if (combo === 10) { tools.lightning++; tools.bomb++; toast('⚡10连击奖励：+1 闪电 +1 炸弹！'); updateToolHud(); }

    // 能量条满 → 星核觉醒
    if (energy >= ENERGY_MAX) {
      energy = 0;
      awakenStarCore();
    }

    spawn(1);
    updateHud();
    checkAchievements();
    checkEnd();
    saveGame();
  }

  function checkPuzzleGoal() {
    const pz = PUZZLE_LEVELS[puzzleLevel];
    if (!pz) return;
    let achieved = false;
    if (pz.goal === 'score' && score >= pz.target) achieved = true;
    if (pz.goal === 'level' && stats.maxLevel >= pz.target) achieved = true;
    if (pz.goal === 'boom' && stats.booms >= pz.target) achieved = true;
    if (pz.goal === 'combo' && stats.maxCombo >= pz.target) achieved = true;

    if (achieved) {
      toast('🎉 第 ' + (puzzleLevel + 1) + ' 关通过！');
      haptic([50, 100, 50]);
      puzzleLevel++;
      stats.puzzleCleared = puzzleLevel;
      try { localStorage.setItem('starcore_puzzle_v1', String(puzzleLevel)); } catch (e) {} // 持久化解谜进度
      clearSave();                                                                          // 本关已通过，续玩存档作废
      checkAchievements();
      setTimeout(() => {
        running = false; gameOver = true;
        $overTitle.textContent = '🎉 关卡通过！';
        $finalScore.textContent = score;
        $finalBest.textContent = best;
        $over.classList.remove('hidden');
      }, 800);
      return;
    }

    if (puzzleMoves <= 0) {
      toast('步数用完了…');
      endGame('挑战失败');
    } else {
      $hint.textContent = pz.desc + '（剩余 ' + puzzleMoves + ' 步）';
    }
  }

  function triggerBoom(cell) {
    const rc = cellRect(cell.r, cell.c);
    burst(rc.cx, rc.cy, '#f687b3', 30);
    // 冲击波动画
    shockwaves.push({ x: rc.cx, y: rc.cy, r: 0, maxR: cell * 3, born: performance.now() });
    const neigh = [{ r: cell.r - 1, c: cell.c }, { r: cell.r + 1, c: cell.c }, { r: cell.r, c: cell.c - 1 }, { r: cell.r, c: cell.c + 1 }];
    let bonus = 0;
    neigh.forEach(p => {
      if (!inBounds(p.r, p.c)) return;
      const v = cores[p.r][p.c];
      if (v && v.level < MAX_LEVEL) {
        v.level = Math.max(1, v.level - 1);
        v.pop = performance.now();
        bonus += 8;
        const pr = cellRect(p.r, p.c);
        burst(pr.cx, pr.cy, COLORS[v.level], 10);
      }
    });
    if (bonus) { score += bonus; stats.score = score; addFloat(rc.cx, rc.cy + cell * 0.4, '+' + bonus, '#ffd479'); }
    updateHud();
  }

  let shockwaves = [];

  function addFloat(x, y, text, color) { floats.push({ x, y, text, color, born: performance.now() }); }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.06 + Math.random() * 0.22;
      particles.push({ x, y, vx: Math.cos(a) * sp * boardPx, vy: Math.sin(a) * sp * boardPx, life: 1, color, size: 2 + Math.random() * 3 });
    }
  }

  function checkEnd() {
    if (mode === 'classic' && !canMergeAnywhere()) {
      // 尝试护盾
      if (tryShield()) return;
      endGame('棋盘锁死啦');
    }
  }
  function endGame(title) {
    running = false; gameOver = true; selected = null; inputLocked = false;
    clearSave(); // 对局结束，存档作废
    if (score > best) { best = score; try { localStorage.setItem('starcore_best_v1', String(best)); } catch (e) {} }
    addToBoard(score, mode);
    accumulateCareer();
    $overTitle.textContent = title || '游戏结束';
    $finalScore.textContent = score;
    $finalBest.textContent = best;
    // 续命按钮状态
    const reviveBtn = document.getElementById('reviveBtn');
    if (reviveBtn && window.StarCoreShop) {
      const canRev = window.StarCoreShop.canRevive();
      reviveBtn.disabled = !canRev;
      reviveBtn.textContent = canRev ? '💎 花费 50 星核币续命' : '💎 星核币不足（需50）';
    }
    $over.classList.remove('hidden');
    $hint.textContent = '点击「再来一局」继续挑战';
    checkAchievements();
    SFX.over();
  }

  // ---------- 对局存档（刷新/误关后可续玩）----------
  const SAVE_KEY = 'starcore_save_v1';

  function saveNow() {
    try {
      if (!running || gameOver) return;   // 仅保存进行中的对局
      if (isDaily) return;                // 每日挑战按天结算，不支持续玩
      if (!cores.some(row => row.some(c => c))) return; // 空棋盘（尚未开局）不保存
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 1,
        mode: mode,
        cores: cores.map(row => row.map(c => c ? { level: c.level, rainbow: !!c.rainbow } : null)),
        score: score, maxCombo: maxCombo, energy: energy,
        shieldUsed: shieldUsed, elapsed: elapsed,
        tools: Object.assign({}, tools),
        puzzleLevel: puzzleLevel, puzzleMoves: puzzleMoves,
        ts: Date.now(),
      }));
    } catch (e) {}
  }

  // 节流：连击时合并/道具会在极短时间内多次触发，而 localStorage 是同步 IO，
  // 每次都全量序列化 + 落盘会造成可感知卡顿。500ms 窗口内合并为一次写入。
  // 页面隐藏/关闭时由 setupAutoSave 直接调用 saveNow()，保证进度不丢。
  let saveThrottleId = null, saveDirty = false;
  function saveGame() {
    if (saveThrottleId) { saveDirty = true; return; }
    saveNow();
    saveThrottleId = setTimeout(function () {
      saveThrottleId = null;
      if (saveDirty) { saveDirty = false; saveNow(); }
    }, 500);
  }

  function loadSave() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!d || d.v !== 1 || !Array.isArray(d.cores) || d.cores.length !== GRID) return null;
      for (const row of d.cores) if (!Array.isArray(row) || row.length !== GRID) return null;
      if (d.mode !== 'classic' && d.mode !== 'timed' && d.mode !== 'puzzle') return null;
      return d;
    } catch (e) { return null; }
  }

  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  }

  function restoreGame(d) {
    mode = d.mode;
    const t = performance.now();
    cores = d.cores.map(row => row.map(c => c ? { level: c.level, rainbow: !!c.rainbow, born: t, pop: 0 } : null));
    score = d.score || 0;
    combo = 0;                        // 连击不跨会话延续
    maxCombo = d.maxCombo || 0;
    energy = d.energy || 0;
    shieldUsed = !!d.shieldUsed;
    elapsed = d.elapsed || 0;
    tools = Object.assign({ lightning: 0, shuffle: 0, hint: 0, bomb: 0 }, d.tools || {});
    window.StarCoreTools = tools;
    puzzleLevel = d.puzzleLevel || 0;
    puzzleMoves = d.puzzleMoves || 0;
    selected = null; activeTool = null;
    anims = []; particles = []; floats = [];
    running = true; paused = false; gameOver = false; inputLocked = false;
    if (window.StarCoreShop) window.StarCoreShop.resetRevive();
    $menu.classList.add('hidden');
    $pause.classList.add('hidden');
    $over.classList.add('hidden');
    $puzzleInfo.classList.add('hidden');
    updateHud();
    updateToolHud();
    if (mode === 'puzzle') {
      const pz = PUZZLE_LEVELS[puzzleLevel];
      $puzzleGoal.textContent = '剩余步数: ' + puzzleMoves;
      $hint.textContent = (pz ? pz.desc : '') + '（剩余 ' + puzzleMoves + ' 步）';
    } else {
      $hint.textContent = mode === 'timed'
        ? '60 秒内尽可能拿高分，连击越多分越高！'
        : '点击相邻同色核心合并，凑出两个 7 引爆星核！';
    }
    toast('▶️ 已恢复上次对局');
  }

  // 菜单中动态插入「继续上局」按钮（仅当存在未结束对局）
  function setupResumeButton() {
    const saved = loadSave();
    if (!saved || !$menu) return;
    const panel = $menu.querySelector('.panel');
    if (!panel) return;
    const label = saved.mode === 'timed' ? '计时挑战' : saved.mode === 'puzzle' ? '解谜模式' : '无尽模式';
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.textContent = '▶️ 继续上局（' + label + ' ' + saved.score + ' 分）';
    btn.addEventListener('click', function () {
      const d = loadSave();
      if (!d) { btn.remove(); return; }
      restoreGame(d);
      btn.remove();
    });
    const first = panel.querySelector('.btn[data-mode]');
    if (first) panel.insertBefore(btn, first);
    else panel.appendChild(btn);
  }

  // 页面隐藏/关闭前兜底保存，避免最后一步操作丢失
  function setupAutoSave() {
    // 这里必须用 saveNow（跳过节流），否则切后台/关闭时可能丢掉窗口内的最后一次状态
    document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
    window.addEventListener('pagehide', saveNow);
    window.addEventListener('beforeunload', saveNow);
  }

  // ---------- 生涯统计（跨局累计）----------
  const CAREER_KEY = 'starcore_career_v1';
  let career = {
    games: 0, totalScore: 0, best: 0, merges: 0, booms: 0,
    maxCombo: 0, rainbows: 0, storms: 0, awakens: 0,
  };

  function loadCareer() {
    try {
      const d = JSON.parse(localStorage.getItem(CAREER_KEY) || 'null');
      if (d && typeof d === 'object') career = Object.assign(career, d);
    } catch (e) {}
  }
  function saveCareer() {
    try { localStorage.setItem(CAREER_KEY, JSON.stringify(career)); } catch (e) {}
  }
  function accumulateCareer() {
    career.games += 1;
    career.totalScore += score;
    career.merges += stats.totalMerges || 0;
    career.booms += stats.booms || 0;
    career.rainbows += stats.rainbows || 0;
    career.storms += stats.storms || 0;
    career.awakens += stats.awakens || 0;
    if ((stats.maxCombo || 0) > career.maxCombo) career.maxCombo = stats.maxCombo;
    if (score > career.best) career.best = score;
    saveCareer();
  }
  function showCareer() {
    if (!$careerGrid || !$careerOverlay) return;
    const avg = career.games ? Math.round(career.totalScore / career.games) : 0;
    const items = [
      ['🎮', '总局数', career.games],
      ['🏅', '累计得分', career.totalScore],
      ['👑', '历史最高', career.best],
      ['📈', '场均得分', avg],
      ['🔗', '累计合成', career.merges],
      ['💥', '累计爆发', career.booms],
      ['⚡', '最高连击', career.maxCombo],
      ['🌈', '彩虹核心', career.rainbows],
      ['🌪️', '连击风暴', career.storms],
      ['🌟', '星核觉醒', career.awakens],
    ];
    $careerGrid.innerHTML = items.map(function (it) {
      return '<div class="career-item">' +
        '<span class="career-emoji">' + it[0] + '</span>' +
        '<div class="career-num">' + it[2] + '</div>' +
        '<div class="career-name">' + it[1] + '</div>' +
        '</div>';
    }).join('');
    $careerOverlay.classList.remove('hidden');
  }

  // 首次进入显示新手引导，之后不再打扰
  function maybeShowTutorial() {
    if (!$tutorialOverlay) return;
    let seen = false;
    try { seen = localStorage.getItem('starcore_tutorial_v1') === '1'; } catch (e) {}
    if (seen) return;
    $tutorialOverlay.classList.remove('hidden');
    const btn = document.getElementById('tutorialStartBtn');
    if (btn) btn.addEventListener('click', function () {
      try { localStorage.setItem('starcore_tutorial_v1', '1'); } catch (e) {}
      $tutorialOverlay.classList.add('hidden');
    });
  }

  // ---------- 排行榜 / 分享 ----------
  function loadBoard() {
    try { return JSON.parse(localStorage.getItem('starcore_board_v1') || '[]'); } catch (e) { return []; }
  }
  function addToBoard(sc, md) {
    const b = loadBoard();
    b.push({ score: sc, mode: md, date: new Date().toISOString().slice(0, 10) });
    b.sort((a, z) => z.score - a.score);
    const top = b.slice(0, 10);
    try { localStorage.setItem('starcore_board_v1', JSON.stringify(top)); } catch (e) {}
    return top;
  }
  function showBoard() {
    const b = loadBoard();
    if (!b.length) {
      $boardList.innerHTML = '<li class="empty">还没有记录，快去玩一局！</li>';
    } else {
      $boardList.innerHTML = b.map((r, i) =>
        '<li><span class="rank">' + (i + 1) + '</span>' +
        '<span class="sc">' + r.score + '</span>' +
        '<span class="md">' + (r.mode === 'timed' ? '计时' : r.mode === 'puzzle' ? '解谜' : '无尽') + '</span></li>'
      ).join('');
    }
    $boardOverlay.classList.remove('hidden');
  }
  function shareScore() {
    const label = mode === 'timed' ? '计时挑战' : mode === 'puzzle' ? '解谜模式' : '无尽模式';
    const url = (location.origin || '') + (location.pathname || '');
    const text = '我在《合成星核》' + label + '拿了 ' + score + ' 分！来挑战我吧 → ' + url;
    if (navigator.share) {
      navigator.share({ title: '合成星核', text: text, url: url }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('成绩已复制，去分享吧！'); }).catch(function () { toast(text); });
    } else {
      toast(text);
    }
  }
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { $toast.classList.remove('show'); }, 2200);
  }

  // ---------- HUD ----------
  function maxLevelOnBoard() {
    let m = 0;
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (cores[r][c]) m = Math.max(m, cores[r][c].level);
    return m;
  }
  // HUD 脏检查：值未变化就不写 DOM，避免无谓的样式重算
  const hudPrev = { score: null, best: null, mode: null, modeVal: null, energy: null };
  function updateHud() {
    if (hudPrev.score !== score) { hudPrev.score = score; $score.textContent = score; }
    if (hudPrev.best !== best) { hudPrev.best = best; $best.textContent = best; }
    const ml = mode === 'timed' ? '计时' : mode === 'puzzle' ? '解谜' : '无尽';
    if (hudPrev.mode !== ml) { hudPrev.mode = ml; $modeLabel.textContent = ml; }
    let mv;
    if (mode === 'timed') mv = Math.max(0, Math.ceil(TIMED_SECONDS - elapsed / 1000)) + 's';
    else if (mode === 'puzzle') mv = puzzleMoves + '步';
    else mv = 'Lv ' + maxLevelOnBoard();
    if (hudPrev.modeVal !== mv) { hudPrev.modeVal = mv; $modeVal.textContent = mv; }
    // 能量条
    if (hudPrev.energy !== energy) {
      hudPrev.energy = energy;
      const pct = (energy / ENERGY_MAX) * 100;
      if ($energyFill) {
        $energyFill.style.width = pct + '%';
        $energyFill.classList.toggle('full', energy >= ENERGY_MAX);
      }
      if ($energyLabel) $energyLabel.textContent = '能量 ' + energy + '/' + ENERGY_MAX;
    }
  }

  // 连击计时条：把原本不可见的 1.5s 宽容期可视化
  let lastComboLabel = '';
  function updateComboBar() {
    if (!running || gameOver || combo <= 0) {
      if ($comboBar && !$comboBar.classList.contains('hidden')) $comboBar.classList.add('hidden');
      return;
    }
    const pct = Math.max(0, Math.min(100, (comboTimer / COMBO_GRACE) * 100));
    $comboBar.classList.remove('hidden');
    $comboFill.style.width = pct + '%';
    const txt = '连击 x' + combo + (combo >= STORM_THRESHOLD ? ' 🌪️' : '');
    if (txt !== lastComboLabel) { $comboLabel.textContent = txt; lastComboLabel = txt; }
  }

  // ---------- 更新与渲染 ----------
  function update(dt, now) {
    nebulaT += dt / 1000;
    if (running && !paused) {
      if (mode === 'timed') {
        elapsed += dt;
        if (elapsed >= TIMED_SECONDS * 1000) { updateHud(); endGame('时间到'); }
        else if (Math.floor(now / 250) !== Math.floor((now - dt) / 250)) updateHud();
      }
      if (inputLocked && !anims.length) inputLocked = false;
    // 连击宽容期递减
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0 && combo > 0) {
        combo = 0; // 超时清零连击
      }
    }
    // 连击风暴超时
    if (stormActive && now > stormEndT) {
      stormActive = false;
      document.getElementById('app').classList.remove('storm');
    }
    }
    anims = anims.filter(a => now - a.start < a.dur);
    for (const p of particles) {
      p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000;
      p.vy += 0.0006 * boardPx * dt / 1000;
      p.life -= dt / 600;
    }
    particles = particles.filter(p => p.life > 0);
    floats = floats.filter(f => now - f.born < 900);
    shockwaves = shockwaves.filter(s => now - s.born < 500);
    updateComboBar();
  }

  function render(now) {
    ctx.clearRect(0, 0, boardPx, boardPx);
    drawBackground(now);

    // 格子底
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const rc = cellRect(r, c);
      roundRect(ctx, rc.x, rc.y, cell, cell, cell * 0.18);
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fill();
    }

    // 冲击波
    for (const s of shockwaves) {
      const t = Math.max(0, Math.min(1, (now - s.born) / 500));
      s.r = Math.max(0, s.maxR * t);
      ctx.strokeStyle = 'rgba(246,135,179,' + (1 - t) * 0.6 + ')';
      ctx.lineWidth = 3 * (1 - t);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 核心
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const v = cores[r][c];
      if (!v) continue;
      const rc = cellRect(r, c);
      let scale = 1;
      const age = Math.max(0, now - v.born);
      if (age < 220) scale = 0.6 + 0.4 * easeOutBack(Math.min(1, age / 220));
      if (v.pop) {
        const pe = (now - v.pop) / 220;
        if (pe < 1) scale *= 1 + 0.18 * Math.sin(pe * Math.PI);
      }
      scale = Math.max(0.1, scale);
      // 提示闪烁
      let hintGlow = 0;
      if (v.hintT) {
        const ht = (now - v.hintT) / 2000;
        if (ht < 1) hintGlow = 0.5 + 0.5 * Math.sin(ht * Math.PI * 4);
        else v.hintT = 0;
      }
      drawCore(rc.cx, rc.cy, cell * scale, v.level, selected && selected.r === r && selected.c === c, now, null, hintGlow, v.rainbow);
    }

    // 飞行块
    for (const a of anims) {
      const t = (now - a.start) / a.dur;
      const e = t * t * (3 - 2 * t);
      const x = a.fromX + (a.toX - a.fromX) * e;
      const y = a.fromY + (a.toY - a.fromY) * e;
      const s = cell * (1 - 0.25 * e);
      drawCore(x, y, s, a.level, false, now, 1 - e * 0.6, 0, a.rainbow);
    }

    // 粒子
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 浮字
    for (const f of floats) {
      const t = (now - f.born) / 900;
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.fillStyle = f.color;
      ctx.font = '700 ' + Math.round(cell * 0.34) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.text, f.x, f.y - t * cell * 0.6);
    }
    ctx.globalAlpha = 1;
  }

  function drawBackground(now) {
    // 动态星云：用预渲染精灵 drawImage 到位（每帧比重建径向渐变便宜得多）
    const t = nebulaT;
    for (let i = 0; i < 3; i++) {
      const cx = boardPx * (0.3 + 0.4 * Math.sin(t * 0.15 + i * 2.1));
      const cy = boardPx * (0.3 + 0.4 * Math.cos(t * 0.12 + i * 2.1));
      const r = Math.max(1, boardPx * (0.3 + 0.1 * Math.sin(t * 0.2 + i)));
      const sp = nebulaSprites[i];
      if (sp) ctx.drawImage(sp, cx - r, cy - r, r * 2, r * 2);
    }

    // 背景星星
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(now / 1000 * s.sp + s.ph);
      ctx.globalAlpha = s.a * (0.4 + 0.6 * tw);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(s.x * boardPx, s.y * boardPx, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawCore(cx, cy, size, level, isSel, now, alpha, hintGlow, isRainbow) {
    const half = size / 2;
    const x = cx - half, y = cy - half;
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;

    if (isRainbow) {
      // 彩虹核心：色相逐帧旋转，无法预渲染，保持实时绘制
      const hue = (now / 20) % 360;
      roundRect(ctx, x, y, size, size, size * 0.2);
      const grad = ctx.createRadialGradient(cx - size * 0.18, cy - size * 0.18, Math.max(0, size * 0.1), cx, cy, Math.max(0, size * 0.75));
      grad.addColorStop(0, 'hsl(' + (hue + 60) + ',90%,75%)');
      grad.addColorStop(0.5, 'hsl(' + hue + ',85%,60%)');
      grad.addColorStop(1, 'hsl(' + ((hue + 180) % 360) + ',80%,45%)');
      ctx.fillStyle = grad;
      ctx.shadowColor = 'hsl(' + hue + ',90%,60%)';
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.shadowBlur = 0;
      // 彩虹光环
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'hsla(' + ((hue + 120) % 360) + ',90%,70%,0.6)';
      roundRect(ctx, x, y, size, size, size * 0.2);
      ctx.stroke();
      // 数字（彩虹核心等级固定，仍实时绘制）
      ctx.fillStyle = '#0b0b1f';
      ctx.font = '800 ' + Math.round(size * 0.42) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(level), cx, cy + size * 0.02);
    } else {
      // 非彩虹核心：复用离屏精灵（含径向渐变 + 数字），仅 drawImage 到位
      const sp = coreSprites[level];
      if (sp) {
        ctx.drawImage(sp, x, y, size, size);
      } else {
        // 兜底：精灵未就绪时退回实时绘制，避免白块
        const color = COLORS[level] || '#888';
        roundRect(ctx, x, y, size, size, size * 0.2);
        const grad = ctx.createRadialGradient(cx - size * 0.18, cy - size * 0.18, Math.max(0, size * 0.1), cx, cy, Math.max(0, size * 0.75));
        grad.addColorStop(0, LIGHTEN_COLORS[level] || lighten(color, 0.35));
        grad.addColorStop(1, color);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.fillStyle = '#0b0b1f';
        ctx.font = '800 ' + Math.round(size * 0.42) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(level), cx, cy + size * 0.02);
      }
    }

    // 选中发光
    if (isSel) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 200);
      ctx.lineWidth = 3 + pulse * 2;
      ctx.strokeStyle = '#38e1ff';
      ctx.shadowColor = '#38e1ff';
      ctx.shadowBlur = 16 + pulse * 10;
      roundRect(ctx, x, y, size, size, size * 0.2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 提示发光
    if (hintGlow > 0) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,212,121,' + hintGlow + ')';
      ctx.shadowColor = '#ffd479';
      ctx.shadowBlur = 14 * hintGlow;
      roundRect(ctx, x, y, size, size, size * 0.2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }

  function lighten(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // WebView 容器（TapTap 等）内存压力下可能丢失 2D 上下文，丢失期间所有绘制静默无效
  let ctxLost = false;
  let lastHealT = 0, lastWrapW = 0, lastWrapH = 0;
  function selfHeal(now) {
    if (now - lastHealT < 500) return;
    lastHealT = now;
    if (typeof ctx.isContextLost === 'function' && ctx.isContextLost()) return;
    // 容器环境里布局可能迟于脚本初始化，或 canvas 属性被外部改写：定期校正
    const w = boardWrap.clientWidth, h = boardWrap.clientHeight;
    if (w > 0 && h > 0 && (w !== lastWrapW || h !== lastWrapH)) {
      lastWrapW = w; lastWrapH = h;
      resize();
    } else if (boardPx > 0 && (canvas.width !== Math.round(boardPx * dpr) || canvas.height !== Math.round(boardPx * dpr))) {
      resize();
    }
  }
  let renderErrors = 0;
  function loop(t) {
    // 先排程下一帧：渲染异常不应中断整个渲染循环（否则棋盘永久空白）
    requestAnimationFrame(loop);
    // 后台标签页不渲染，省电省 CPU；重置时间基准避免回前台时 dt 突跳
    if (document.hidden) { lastT = t; return; }
    const dt = Math.min(50, t - lastT || 16);
    lastT = t;
    if (!ctxLost) {
      try {
        update(dt, t);
        render(t);
      } catch (e) {
        if (renderErrors < 3) { try { console.error('[SC] 渲染异常:', e); } catch (_) {} renderErrors++; }
      }
    }
    selfHeal(t);
  }

  // ---------- 事件 ----------
  function bindEvents() {
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 200));
    window.addEventListener('load', resize);
    if (typeof ResizeObserver !== 'undefined' && boardWrap) {
      new ResizeObserver(resize).observe(boardWrap);
    }
    // 2D 上下文丢失/恢复：恢复后重建尺寸与变换
    canvas.addEventListener('contextlost', () => { ctxLost = true; });
    canvas.addEventListener('contextrestored', () => { ctxLost = false; resize(); });
    // 容器切后台/回前台：rAF 停走，回来后校正时间基准与布局
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { lastT = performance.now(); resize(); }
    });

    // 横竖屏切换按钮：优先用 Orientation API 锁定，不支持则提示旋转设备
    const rotateBtn = document.getElementById('rotateBtn');
    if (rotateBtn) {
      rotateBtn.addEventListener('click', () => {
        const target = (window.innerHeight > window.innerWidth) ? 'landscape' : 'portrait';
        try {
          if (screen.orientation && typeof screen.orientation.lock === 'function') {
            const fs = (document.documentElement.requestFullscreen)
              ? document.documentElement.requestFullscreen().catch(() => {}) : Promise.resolve();
            Promise.resolve(fs).then(() => {
              try { screen.orientation.lock(target); } catch (_) { /* 部分浏览器需用户手势/全屏，忽略 */ }
            });
          } else {
            toast('请旋转你的设备以切换横竖屏');
          }
        } catch (_) {
          toast('请旋转你的设备以切换横竖屏');
        }
      });
    }

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (SFX && SFX.resume) SFX.resume();
      handlePointer(e);
    });

    document.querySelectorAll('#menuOverlay .btn[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (SFX && SFX.resume) SFX.resume();
        if (btn.dataset.mode === 'daily') {
          // 显示每日挑战信息
          const today = new Date();
          const dateStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
          const lastDaily = parseInt(localStorage.getItem('starcore_daily_last') || '0', 10);
          const seed = today.getFullYear() * 10000 + (today.getMonth()+1) * 100 + today.getDate();
          const played = lastDaily === seed;
          document.getElementById('dailyDesc').textContent = '每天一关，所有玩家面对相同棋盘。60秒内拿高分！';
          document.getElementById('dailyTip').textContent = played ? '今日已挑战，可重复游玩' : '今日首次挑战';
          document.getElementById('dailyTitle').textContent = '📅 每日挑战 — ' + dateStr;
          $dailyOverlay.classList.remove('hidden');
          $menu.classList.add('hidden');
        } else {
          newGame(btn.dataset.mode);
        }
      });
    });

    // 道具按钮
    document.getElementById('toolLightning').addEventListener('click', () => {
      if (tools.lightning <= 0) return;
      activeTool = activeTool === 'lightning' ? null : 'lightning';
      selected = null;
      updateToolHud();
      toast(activeTool ? '⚡ 点击要炸掉的核心' : '取消');
    });
    document.getElementById('toolShuffle').addEventListener('click', () => {
      if (tools.shuffle <= 0) return;
      useShuffle();
    });
    document.getElementById('toolHint').addEventListener('click', () => {
      if (tools.hint <= 0) return;
      useHint();
    });
    document.getElementById('toolBomb').addEventListener('click', () => {
      if (tools.bomb <= 0) return;
      activeTool = activeTool === 'bomb' ? null : 'bomb';
      selected = null;
      updateToolHud();
      toast(activeTool ? '💥 点击爆炸中心' : '取消');
    });

    // 解谜
    // 每日挑战
    document.getElementById('dailyStartBtn').addEventListener('click', () => {
      $dailyOverlay.classList.add('hidden');
      newGame('daily');
    });
    document.getElementById('dailyBackBtn').addEventListener('click', () => {
      $dailyOverlay.classList.add('hidden');
      $menu.classList.remove('hidden');
    });

    document.getElementById('puzzleStartBtn').addEventListener('click', startPuzzle);
    document.getElementById('puzzleBackBtn').addEventListener('click', () => {
      $puzzleInfo.classList.add('hidden');
      $menu.classList.remove('hidden');
    });

    document.getElementById('pauseBtn').addEventListener('click', () => {
      if (!running || gameOver) return;
      paused = true; $pause.classList.remove('hidden');
    });
    document.getElementById('resumeBtn').addEventListener('click', () => { paused = false; $pause.classList.add('hidden'); });
    document.getElementById('restartBtn').addEventListener('click', () => newGame(mode));
    document.getElementById('menuBtn').addEventListener('click', () => { running = false; $pause.classList.add('hidden'); $menu.classList.remove('hidden'); });
    document.getElementById('againBtn').addEventListener('click', () => newGame(mode));
    document.getElementById('overMenuBtn').addEventListener('click', () => { $over.classList.add('hidden'); $menu.classList.remove('hidden'); });
    document.getElementById('boardBtn').addEventListener('click', showBoard);
    document.getElementById('boardCloseBtn').addEventListener('click', () => $boardOverlay.classList.add('hidden'));
    document.getElementById('shareBtn').addEventListener('click', shareScore);
    document.getElementById('achBtn').addEventListener('click', showAchWall);
    document.getElementById('achCloseBtn').addEventListener('click', () => $achOverlay.classList.add('hidden'));
    const careerBtn = document.getElementById('careerBtn');
    if (careerBtn) careerBtn.addEventListener('click', showCareer);
    const careerCloseBtn = document.getElementById('careerCloseBtn');
    if (careerCloseBtn) careerCloseBtn.addEventListener('click', () => $careerOverlay.classList.add('hidden'));

    // 续命按钮
    document.getElementById('reviveBtn').addEventListener('click', () => {
      if (!window.StarCoreShop || !window.StarCoreShop.canRevive()) return;
      if (window.StarCoreShop.doRevive()) {
        $over.classList.add('hidden');
        gameOver = false;
        running = true;
        // 清除一半核心给玩家喘息空间
        const filled = [];
        for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (cores[r][c]) filled.push({ r, c });
        filled.sort(() => Math.random() - 0.5);
        const remove = Math.ceil(filled.length / 2);
        for (let i = 0; i < remove; i++) cores[filled[i].r][filled[i].c] = null;
        // 补充3个道具
        tools.lightning++; tools.hint++;
        window.StarCoreTools = tools;
        updateToolHud();
        toast('💎 续命成功！棋盘已清理，继续战斗！');
        ensurePlayable();
        updateHud();
      }
    });
  }

  function init() {
    resize();
    stars = [];
    for (let i = 0; i < 60; i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.4, a: Math.random() * 0.5 + 0.3, sp: Math.random() * 2 + 0.5, ph: Math.random() * 6.28 });
    try { best = parseInt(localStorage.getItem('starcore_best_v1') || '0', 10) || 0; } catch (e) { best = 0; }
    try { puzzleLevel = parseInt(localStorage.getItem('starcore_puzzle_v1') || '0', 10) || 0; } catch (e) { puzzleLevel = 0; }
    loadAchievements();
    loadCareer();
    bindEvents();
    setupResumeButton();
    setupAutoSave();
    maybeShowTutorial();
    // 容器环境（iframe/webview）布局可能迟于 DOMContentLoaded：延迟补几次尺寸校正
    [200, 600, 1500].forEach((ms) => setTimeout(resize, ms));
    // 初始化付费系统
    if (window.StarCoreShop) window.StarCoreShop.init();
    updateHud();
    updateToolHud();
    requestAnimationFrame(loop);
  }

  // === QA 调试钩子（只读，无害）===
  window.__SC_DEBUG = {
    GRID,
    MAX_LEVEL,
    getGrid: () => cores.map(row => row.map(c => c ? { level: c.level, rainbow: !!c.rainbow } : null)),
    setGrid: (arr) => {
      cores = arr.map(row => row.map(c => c ? { level: c.level, born: performance.now(), pop: 0, rainbow: !!c.rainbow } : null));
    },
    newGame,
    doMergeDebug: (a, b) => doMerge(a, b),
    triggerResonance,
    cellRect,
    canvas,
    geom: () => ({ boardPx, pad, gap, cell, dpr }),
    score: () => score,
    mode: () => mode,
    tools: () => Object.assign({}, tools),
    stats: () => Object.assign({}, stats),
    // 找到一对可合并的相邻同色核心，返回 [{r,c},{r,c}] 或 null
    findMergeablePair: () => {
      for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
        const a = cores[r][c];
        if (!a) continue;
        const neigh = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
        for (const [nr,nc] of neigh) {
          if (!inBounds(nr,nc)) continue;
          const b = cores[nr][nc];
          if (!b) continue;
          if (a.level === b.level || a.rainbow || b.rainbow) return [{r,c},{r:nr,c:nc}];
        }
      }
      return null;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
