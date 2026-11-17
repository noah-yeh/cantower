/**
 * 音频层（v3.30 起）—— 背景音乐 + 打击音效。
 *
 * ── v3.60 / v3.61：背景乐换成**真实音频文件** ─────────────────────────
 *
 * 用户提供了 4 首生成的 wav（参照素材/AI生成背景音/），选中
 * 02《奇幻探索_竖琴长笛拨弦》：转 40000Hz mono 后 1.6MB / 21 秒，
 * `assets/audio/bgm-harp.wav`，**fetch + decodeAudioData 后用 BufferSource 交叉淡化循环**。
 * 合成器和弦垫**降级为兜底**：文件加载失败（旧缓存 / 断网首屏）才启用。
 * 打击音效依旧全部实时合成（0 字节、无延迟）。
 *
 * v3.60 第一版用 `<audio loop>`，用户实测报了两件事，v3.61 全部改掉：
 *   - **打击音效全没了** → 音频元素抢了页面的音频会话，AudioContext 被挂起，
 *     `sfx()` 走 suspended 分支只 resume 不播。现在 BGM 与音效共用同一个
 *     AudioContext / master 总线，物理上不存在两套会话。
 *   - **循环接缝不连贯** → 硬切回 0 的接缝能听出来。改为交叉淡化：
 *     每段提前 1.6 秒起下一段，前段淡出、后段淡入。
 *   - 顺便把音量降到 0.3（用户：太大）。
 *
 * 为什么音效仍不用音频文件：一套打击音效再加几百 KB，而这是个装在手机
 * 浏览器里的 PWA。合成器把这部分压到 0 字节，还顺带解决了版权问题。
 *
 * 三层结构：
 *   master ──┬─ musicGain(0.85) ── 合成和弦垫（兜底）+ 稀疏拨弦
 *            ├─ bgmGain(0.30)   ── 文件背景乐（主力，交叉淡化循环）
 *            └─ sfxGain(1)      ── 打击 / 格挡 / 治疗 / 中毒 / 金币 / 点击
 *
 * ── v3.31 修的两个"听不到" ────────────────────────────────────────────
 *
 * 1. **resume 是异步的**。`new AudioContext()` 在部分浏览器（iOS Safari 尤其）
 *    里初始就是 suspended，`resume()` 返回 Promise，**同步读 `ctx.state`
 *    仍然是 suspended**。旧代码 `unlockAudio` 里 resume 完立刻 `startMusic()`，
 *    而 `startMusic` 第一行就是 `if (state === 'suspended') return` ——
 *    于是 BGM 一次都没起过，只有零星的点击音。现在改成 resume **成功之后**
 *    再起 BGM，并且任何一次手势都会重试，直到 state 真的变成 running。
 *
 * 2. **调度器每秒推一个 5.2 秒的和弦**。旧版 setInterval(1000) 每次都调
 *    `pad()`，不管该不该到点 —— 结果永远是 5 个和弦叠在一起，
 *    总音量是设计的 5 倍、和声也糊成一团。现在用标准 lookahead 调度：
 *    每 250ms 只看 1.2 秒的窗口，到点才排，同一时刻最多 1 个和弦。
 *
 * 手机小喇叭听不见 87~130Hz 的基频，所以和弦垫额外挂一条高八度泛音，
 * 音量很小但决定了"手机上到底有没有声音"。
 *
 * 节点测试里没有 window —— 所有入口都做空保护，import 本身不产生副作用。
 */

const MUTE_KEY = 'rs_mute';

let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;
let noiseBuf = null;
let muted = false;
let musicTimer = null;
let nextChordAt = 0;
let chordIndex = 0;
let started = false;
let unlockedOnce = false;
let lifecycleAttached = false;

/* ------------------------------------------------------------------ *
 * v3.60/v3.61 文件背景乐
 *
 * v3.60 第一版用 `<audio loop>` 播放，v3.61 换回 **WebAudio 解码 + 缓冲循环**，
 * 原因有两条（都是用户报的）：
 *
 *  1. **打击音效全没了**。iOS 上 `<audio>` 元素一开播，会抢走页面的"音频会话"，
 *     AudioContext 被置为 interrupted/suspended —— 而 `sfx()` 遇到 suspended 只
 *     resume 不播（见下方 sfx 的空转分支），于是打击音全静音、只有背景乐在响。
 *     现在 BGM 和音效共用**同一个 AudioContext 与同一条 master 总线**，
 *     不存在两套会话打架的问题。
 *
 *  2. **循环接缝听得出来**。`<audio loop>` 是硬切回 0，素材首尾不是同相位，接缝
 *     会有一次明显的"咔"。这里改成**交叉淡化循环**：每段提前 BGM_FADE 秒起下一段，
 *     前一段同步淡出、后一段淡入，接缝处是两段叠着过渡，听不出断点。
 *
 * 音量也从 0.6 降到 BGM_GAIN（用户：太大）。
 * ------------------------------------------------------------------ */

const BGM_SRC = 'assets/audio/bgm-harp.wav';
/** 背景乐相对主音量（0.6 → 0.3：用户反馈"声音太大"） */
const BGM_GAIN = 0.3;
/** 交叉淡化时长（秒）：接缝前后各取这么长做互补淡入淡出 */
const BGM_FADE = 1.6;
/** 排程器心跳（毫秒）：每跳看一次未来 1.2 秒要不要起新段 */
const BGM_TICK = 300;

let bgmGainNode = null;
let bgmBuf = null;
let bgmLoad = null;
let bgmFailed = false;
let bgmTimer = null;
let bgmNextAt = 0;
let bgmFirstAt = 0;
let bgmNodes = [];
let synthOn = false;
/** 当前音乐来源：'none' | 'file' | 'synth' —— 探针与自检用 */
let bgmSource = 'none';

/**
 * 音频地址要带上页面自己的 query。
 * 线上站点的静态资源不带 `?sharecode=…` 会直接 403，而**相对路径不会继承 query**。
 * 本地 / 无 query 环境就是空串，等于原样。
 */
function bgmUrl() {
  const q = typeof location !== 'undefined' ? location.search : '';
  return BGM_SRC + q;
}

/** fetch + decode 一次，结果常驻（1.6MB wav → 约 3.4MB 浮点缓冲） */
function loadBgm() {
  if (bgmBuf || bgmFailed) return Promise.resolve(bgmBuf);
  if (bgmLoad) return bgmLoad;
  const c = ensure();
  if (!c || typeof fetch !== 'function') return Promise.resolve(null);
  bgmLoad = fetch(bgmUrl())
    .then((r) => {
      if (!r.ok) throw new Error(`bgm ${r.status}`);
      return r.arrayBuffer();
    })
    .then((ab) => new Promise((res, rej) => {
      /** 老 Safari 只有回调式签名，新浏览器返回 Promise —— 两种都接住 */
      const p = c.decodeAudioData(ab, res, rej);
      if (p && typeof p.then === 'function') p.then(res, rej);
    }))
    .then((buf) => {
      bgmBuf = buf;
      return buf;
    })
    .catch(() => {
      bgmFailed = true;
      return null;
    });
  return bgmLoad;
}

/** 起一段缓冲：淡入 → 保持 → 淡出，段长 = 素材全长 */
function spawnBgmSegment(t0) {
  const c = ctx;
  if (!c || !bgmBuf || !bgmGainNode) return;
  const dur = bgmBuf.duration;
  const src = c.createBufferSource();
  src.buffer = bgmBuf;
  const g = c.createGain();
  const fadeIn = Math.min(BGM_FADE, dur * 0.25);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(1, t0 + fadeIn);
  g.gain.setValueAtTime(1, Math.max(t0 + fadeIn, t0 + dur - fadeIn));
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  src.connect(g).connect(bgmGainNode);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
  bgmNodes.push(src);
  src.onended = () => { bgmNodes = bgmNodes.filter((n) => n !== src); };
}

/**
 * 段起点序列（纯函数，给测试用）：相邻两段的间隔 = dur - fade，
 * 也就是**每段的尾巴和下一段的头重叠 fade 秒** —— 这就是"交叉淡化"的定义。
 * 硬切循环的间隔会是 dur（零重叠），听感上就是接缝处"咔"的一下。
 */
export function bgmSegmentStarts(dur, fade, count, t0 = 0) {
  const step = Math.max(0.5, dur - fade);
  return Array.from({ length: count }, (_, i) => Math.round((t0 + i * step) * 1000) / 1000);
}

/** lookahead 排程：段与段重叠 BGM_FADE 秒，接缝是交叉淡化而不是硬切 */
function scheduleBgm() {
  const c = ctx;
  if (!c || !bgmBuf || !bgmTimer) return;
  const now = c.currentTime;
  /** 被挂起过很久（锁屏回来）重新对齐，别把错过的段一口气补出来 */
  if (bgmNextAt < now - 1) bgmNextAt = now + 0.1;
  let guard = 0;
  while (bgmNextAt < now + 1.2 && guard++ < 4) {
    spawnBgmSegment(bgmNextAt);
    bgmNextAt += Math.max(0.5, bgmBuf.duration - BGM_FADE);
  }
}

function startBgmLoop() {
  const c = ctx;
  if (!c || !bgmBuf || bgmTimer) return;
  bgmSource = 'file';
  bgmNextAt = c.currentTime + 0.2;
  bgmFirstAt = bgmNextAt;
  scheduleBgm();
  bgmTimer = setInterval(scheduleBgm, BGM_TICK);
}

export function bgmInfo() {
  const c = ctx;
  let t = 0;
  if (bgmBuf && c) {
    const span = c.currentTime - bgmFirstAt;
    if (span > 0) t = span % bgmBuf.duration;
  }
  return {
    source: bgmSource,
    muted,
    started,
    t,
    paused: bgmSource !== 'file' && !synthOn,
    loop: true,
    src: bgmBuf ? 'bgm-harp.wav' : '',
    dur: bgmBuf ? bgmBuf.duration : 0,
    segments: bgmNodes.length,
    ctxState: c ? c.state : 'none',
  };
}

/**
 * 各条总线的现值 —— 给探针用。
 * v3.61 的"音效全没了"就是靠这几条值定位的：要能一眼看到
 * 「bgm 在播但 sfx/master 被人为压到 0」还是「ctx 根本没 running」。
 */
export function audioDebug() {
  return {
    ctxState: ctx ? ctx.state : 'none',
    master: master ? master.gain.value : null,
    music: musicGain ? musicGain.gain.value : null,
    bgm: bgmGainNode ? bgmGainNode.gain.value : null,
    sfx: sfxGain ? sfxGain.gain.value : null,
    muted,
    source: bgmSource,
  };
}

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(v) {
  try {
    localStorage.setItem(MUTE_KEY, v ? '1' : '0');
  } catch { /* 隐私模式忽略 */ }
}

/** 惰性建图。没有 window / 没有 AudioContext（node 测试）时返回 null，调用方一律空转 */
function ensure() {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 1;
  master.connect(ctx.destination);

  musicGain = ctx.createGain();
  musicGain.gain.value = 0.85;
  musicGain.connect(master);

  sfxGain = ctx.createGain();
  sfxGain.gain.value = 1;
  sfxGain.connect(master);

  /**
   * 文件背景乐自己的音量节点（v3.61）：挂在 master 上、和 sfxGain 平级。
   * 不并进 musicGain —— 那个 0.85 是给合成和弦垫调的，文件素材的响度是母带定的，
   * 两者混用会让"换一手音源"就得重调一次参数。
   */
  bgmGainNode = ctx.createGain();
  bgmGainNode.gain.value = BGM_GAIN;
  bgmGainNode.connect(master);

  /* 白噪声缓冲：打击/格挡/中毒的"实体感"全靠它，建一次复用 */
  const len = Math.floor(ctx.sampleRate * 0.5);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  return ctx;
}

export function audioSupported() {
  if (typeof window === 'undefined') return false;
  return !!(window.AudioContext || window.webkitAudioContext);
}

/** 'none' | 'suspended' | 'running' | 'closed' —— 给诊断与自检用 */
export function audioState() {
  return ctx ? ctx.state : 'none';
}

export function isMuted() {
  return muted;
}

/** 页面切回来时，浏览器可能把 ctx 挂起；能恢复就恢复（不需要新手势时 resume 是合法的） */
function attachLifecycle() {
  if (lifecycleAttached || typeof document === 'undefined') return;
  lifecycleAttached = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (muted || !ctx) return;
    if (ctx.state === 'suspended') ctx.resume().then(() => startMusic()).catch(() => {});
    /** 文件 BGM 现在是 WebAudio 缓冲（v3.61），时钟会跟着 ctx 走，不需要额外补播 */
  });
}

/** 恢复 AudioContext 并起 BGM。resume 是异步的，必须在它**之后**再起音乐 */
function resumeThenStart() {
  const c = ensure();
  if (!c) return Promise.resolve(false);
  if (muted) return Promise.resolve(true);
  if (c.state === 'running') {
    startMusic();
    return Promise.resolve(true);
  }
  return c.resume()
    .then(() => {
      startMusic();
      return c.state === 'running';
    })
    .catch(() => false);
}

/**
 * 首次（以及所有后续）用户手势调用：恢复 AudioContext 并按设置启动 BGM。
 * main.js 会一直挂着手势监听，直到 `audioState() === 'running'` 才摘掉 ——
 * 因为 iOS 上第一次 resume 有时会静默失败，得靠下一次点击兜住。
 */
export function unlockAudio() {
  if (typeof window === 'undefined') return;
  muted = readMuted();
  const c = ensure();
  if (!c) return;
  attachLifecycle();
  const first = !unlockedOnce;
  resumeThenStart().then((ok) => {
    if (!ok) return;
    if (first) unlockedOnce = true;
    /** 第一次真的跑起来时给一记轻响：玩家立刻能确认"声音是开的" */
    if (first && !muted) sfx('boot');
    // 每次手势都重试一次 BGM（started 内部会去重，不会叠音）
    if (!muted && c.state === 'running') startMusic();
  });
}

export function toggleMute() {
  muted = !muted;
  writeMuted(muted);
  const c = ensure();
  if (!c) return muted;
  const t = c.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.05);
  if (!muted) {
    attachLifecycle();
    resumeThenStart();
  }
  return muted;
}

/* ------------------------------------------------------------------ *
 * 基础音色
 * ------------------------------------------------------------------ */

/** 单音：freq → freq2 的滑音（freq2 省略即定音），带 attack/decay */
function tone({ type = 'sine', freq = 440, freq2 = null, dur = 0.2, gain = 0.2, at = 0, curve = 'exp' }) {
  const c = ctx;
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2));
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  else g.gain.linearRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g).connect(sfxGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 噪声段：filter 决定"材质"（带通=拳拳到肉，高通=金属，低通=闷响） */
function noise({ dur = 0.12, gain = 0.2, at = 0, type = 'bandpass', freq = 1200, q = 1, sweepTo = null }) {
  const c = ctx;
  if (!c || !noiseBuf) return;
  const t0 = c.currentTime + at;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(sfxGain);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/* ------------------------------------------------------------------ *
 * 音效表
 * ------------------------------------------------------------------ */

const SFX = {
  /** 开机轻响：只在前几次手势解锁成功时播一次，用来确认"有声音" */
  boot() {
    tone({ type: 'sine', freq: 587.33, dur: 0.5, gain: 0.16 });
    tone({ type: 'sine', freq: 880, dur: 0.7, gain: 0.12, at: 0.12 });
    tone({ type: 'triangle', freq: 1174.66, dur: 0.5, gain: 0.05, at: 0.24 });
  },
  /** 普通命中：低频"噗" + 中频噪声，短促 */
  hit(strong = false) {
    const k = strong ? 1.35 : 1;
    tone({ type: 'sine', freq: 150 * k, freq2: 55, dur: 0.16, gain: 0.26 * k });
    noise({ dur: 0.1, gain: 0.2 * k, freq: 1400, q: 0.9, sweepTo: 400 });
    /** 高频"啪"：手机喇叭上低频几乎听不见，这层才是实实在在的击打感 */
    noise({ dur: 0.05, gain: 0.1 * k, type: 'highpass', freq: 3200, q: 0.7 });
  },
  /** 重击：同一套音色加重低频，让"大数字"听起来也更重 */
  hitHeavy() {
    SFX.hit(true);
  },
  /** 暴击：命中 + 金属亮音，明显更"脆" */
  crit() {
    SFX.hit(true);
    tone({ type: 'square', freq: 1760, freq2: 880, dur: 0.14, gain: 0.09, at: 0.01 });
    noise({ dur: 0.18, gain: 0.12, type: 'highpass', freq: 2600, q: 0.7 });
  },
  /** 玩家挨打：更闷、更低（听感上"吃亏"） */
  hurt() {
    tone({ type: 'sine', freq: 110, freq2: 45, dur: 0.22, gain: 0.3 });
    tone({ type: 'sawtooth', freq: 220, freq2: 90, dur: 0.16, gain: 0.08 });
    noise({ dur: 0.16, gain: 0.16, type: 'lowpass', freq: 700, q: 0.6 });
  },
  /** 护甲/格挡：金属"锵" */
  block() {
    tone({ type: 'triangle', freq: 1318, freq2: 1180, dur: 0.12, gain: 0.12 });
    noise({ dur: 0.08, gain: 0.12, type: 'highpass', freq: 3000, q: 0.8 });
  },
  /** 治疗/回血：柔和上行两声 */
  heal() {
    tone({ type: 'sine', freq: 659, dur: 0.16, gain: 0.13 });
    tone({ type: 'sine', freq: 988, dur: 0.22, gain: 0.1, at: 0.09 });
  },
  /** 中毒：带通下扫的"咕嘟" */
  poison() {
    noise({ dur: 0.3, gain: 0.13, type: 'bandpass', freq: 900, q: 6, sweepTo: 220 });
  },
  /** 闪避：短促风声 */
  dodge() {
    noise({ dur: 0.16, gain: 0.13, type: 'highpass', freq: 1800, q: 0.6, sweepTo: 5200 });
  },
  /** 金币/拾取：两声清脆 */
  coin() {
    tone({ type: 'triangle', freq: 1046, dur: 0.1, gain: 0.11 });
    tone({ type: 'triangle', freq: 1568, dur: 0.16, gain: 0.09, at: 0.07 });
  },
  /** 出牌（非伤害牌）：轻提示 */
  play() {
    tone({ type: 'triangle', freq: 523, freq2: 784, dur: 0.12, gain: 0.09 });
  },
  /** UI 点击：极轻的一下，不抢戏 */
  click() {
    tone({ type: 'square', freq: 420, freq2: 320, dur: 0.05, gain: 0.055 });
  },
  /** 胜利：大三和弦上行 */
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ type: 'triangle', freq: f, dur: 0.5, gain: 0.1, at: i * 0.1 }));
  },
  /** 失败：小三和弦下行 */
  lose() {
    [392, 311.13, 261.63, 196].forEach((f, i) =>
      tone({ type: 'sine', freq: f, dur: 0.7, gain: 0.12, at: i * 0.14 }));
  },
};

export function sfx(name) {
  if (muted) return;
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') {
    /** 还没解锁：顺手再试一次 resume（调用点多半就在手势里），但不排队旧音效 */
    c.resume().catch(() => {});
    return;
  }
  const fn = SFX[name];
  if (fn) {
    try { fn(); } catch { /* 音频失败绝不能影响游戏 */ }
  }
}

/* ------------------------------------------------------------------ *
 * 战斗事件 → 音效
 * ------------------------------------------------------------------ */

/**
 * 由 spawnFloats 统一调用（战斗反馈的唯一漏斗）。
 * 一次出牌可能产生多个事件，这里做**同类归并**：
 * 一张三段攻击牌不应该叠三次"噗"，只播一次但按总伤害加重。
 */
export function playEvents(events = []) {
  if (muted || !events.length) return;
  let damageToEnemy = 0;
  let damageToPlayer = 0;
  let crit = false;
  let block = false;
  let heal = 0;
  let poison = false;
  let dodge = false;

  for (const ev of events) {
    if (!ev) continue;
    if (ev.type === 'crit') crit = true;
    else if (ev.type === 'damage') {
      if (ev.target === 'enemy') damageToEnemy += ev.value || 0;
      else damageToPlayer += ev.value || 0;
      if (ev.absorbed > 0) block = true;
    } else if (ev.type === 'heal') heal += ev.value || 0;
    else if (ev.type === 'poison' || ev.type === 'poisonTick') poison = true;
    else if (ev.type === 'dodge') dodge = true;
  }

  if (crit && damageToEnemy > 0) sfx('crit');
  else if (damageToEnemy >= 25) sfx('hitHeavy');
  else if (damageToEnemy > 0) sfx('hit');
  if (damageToPlayer > 0) sfx('hurt');
  if (block) sfx('block');
  if (heal > 0) sfx('heal');
  if (poison) sfx('poison');
  if (dodge) sfx('dodge');
}

/* ------------------------------------------------------------------ *
 * 背景音乐：A 小调四和弦循环 + 稀疏拨弦
 * ------------------------------------------------------------------ */

/** 和弦垫（Hz）：Am → F → C → G，塔里的低沉氛围 */
const CHORDS = [
  [110.0, 130.81, 164.81],
  [87.31, 110.0, 130.81],
  [130.81, 164.81, 196.0],
  [98.0, 123.47, 146.83],
];
/** A 小调五声音阶，拨弦只从这里取音，确保永远不撞和弦 */
const PENTA = [440.0, 523.25, 587.33, 659.25, 783.99];
const CHORD_DUR = 5.2;
const LOOKAHEAD = 1.2;
const TICK_MS = 250;

function pad(chord, at) {
  const c = ctx;
  if (!c) return;
  const t0 = c.currentTime + at;
  /**
   * v3.32：整体抬高一个八度（基频 87~130Hz → 174~261Hz）。
   *
   * 原来的写法是"和弦垫 + 低八度铺底（chord/2 = 43~65Hz）"，
   * 用户听感是"沉闷的嘟、还带着震动"—— 那层 sub 就是元凶：
   * 40~60Hz 在手机和普通耳塞上放出来只剩持续的低频轰鸣，听不出音高，
   * 而且和 pad 的基频叠成拍频，就成了"嗡嗡震"。
   * 现在低频层整个不要了，pad 上移到中音区，厚度靠两条轻微失谐的副本补。
   */
  for (const f of chord) {
    for (const cents of [-4, 4]) {
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = f * 2;
      osc.detune.value = cents;
      /** 慢起慢落的长音：不做包络会"咔嚓"一声 */
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.032, t0 + 1.4);
      g.gain.linearRampToValueAtTime(0.026, t0 + CHORD_DUR - 1.6);
      g.gain.linearRampToValueAtTime(0.0001, t0 + CHORD_DUR);
      osc.connect(g).connect(musicGain);
      osc.start(t0);
      osc.stop(t0 + CHORD_DUR + 0.05);
    }
  }

  /**
   * 高八度泛音（很轻）：87~130Hz 的手机外放基本等于没有，
   * 这条 ~700Hz 的弱音才是"能听见 BGM"的关键。
   */
  const air = c.createOscillator();
  const ag = c.createGain();
  air.type = 'triangle';
  air.frequency.value = chord[0] * 4;
  ag.gain.setValueAtTime(0.0001, t0);
  ag.gain.linearRampToValueAtTime(0.01, t0 + 2);
  ag.gain.linearRampToValueAtTime(0.0001, t0 + CHORD_DUR);
  air.connect(ag).connect(musicGain);
  air.start(t0);
  air.stop(t0 + CHORD_DUR + 0.05);
}

function pluck(freq, at) {
  const c = ctx;
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
  osc.connect(g).connect(musicGain);
  osc.start(t0);
  osc.stop(t0 + 2.5);
}

/**
 * lookahead 调度：每 TICK_MS 看一眼未来 LOOKAHEAD 秒，到点才排。
 * v3.30 的写法是每 1000ms 无条件 pad() 一次，5.2 秒的和弦会让 5 个副本
 * 同时响着（音量 5 倍、和声糊）—— 这里用 while 保证同一时刻只有一个和弦。
 */
function scheduleChord() {
  const c = ctx;
  if (!c) return;
  const now = c.currentTime;
  /** 被挂起过很久（手机锁屏回来）时重新对齐，别把错过的和弦一口气补出来 */
  if (nextChordAt < now - CHORD_DUR) nextChordAt = now + 0.1;
  let guard = 0;
  while (nextChordAt < now + LOOKAHEAD && guard++ < 3) {
    const at = Math.max(0, nextChordAt - now);
    pad(CHORDS[chordIndex % CHORDS.length], at);
    /* 拨弦：每小节 1~2 个，随机取音 —— 太密会变成"游戏机音"，太稀又听不出旋律 */
    const n = 1 + (Math.random() < 0.45 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const note = PENTA[Math.floor(Math.random() * PENTA.length)];
      pluck(note, at + 0.6 + Math.random() * (CHORD_DUR - 2));
    }
    chordIndex++;
    nextChordAt += CHORD_DUR;
  }
}

/** 合成器兜底：只在文件 BGM 不可用（加载失败 / 3 秒没起来）时启用 */
function startSynth() {
  const c = ctx;
  if (!c || synthOn) return;
  synthOn = true;
  bgmSource = 'synth';
  nextChordAt = c.currentTime + 0.25;
  scheduleChord();
  musicTimer = setInterval(scheduleChord, TICK_MS);
}

export function startMusic() {
  if (muted) return;
  const c = ensure();
  if (!c || c.state !== 'running') return;
  if (started) return;
  started = true;

  /* v3.61 主力：WebAudio 缓冲循环。
   * 缓冲已经在内存 → 立即起；还没加载 → 加载完再起（这期间宁可静音一拍，
   * 也不要先放合成器再切歌，那会听到一次明显的"换台"）。
   * 只有加载失败才落到合成器兜底。 */
  if (bgmBuf) {
    startBgmLoop();
    return;
  }
  if (bgmFailed) {
    startSynth();
    return;
  }
  loadBgm().then((buf) => {
    if (!started) return;          // 加载途中被 stopMusic
    if (buf) startBgmLoop();
    else startSynth();
  });
}

export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  if (bgmTimer) clearInterval(bgmTimer);
  bgmTimer = null;
  for (const n of bgmNodes) {
    try { n.stop(); } catch { /* 已停 */ }
  }
  bgmNodes = [];
  synthOn = false;
  started = false;
  bgmSource = 'none';
}
