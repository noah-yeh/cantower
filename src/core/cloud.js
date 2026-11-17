/**
 * 云端同步编排（v3.94）。
 *
 * 职责边界：
 *   net.js    发请求、收 JSON
 *   cloud.js  身份（playerId + token）、存档 rev 推进、镜像池合并
 *   调用方    决定什么时候同步、冲突怎么问玩家
 *
 * 三条设计约定：
 *  1. **没有登录墙**。第一次同步时静默注册一个设备身份，玩家什么都看不到。
 *     做成"先注册才能玩"会把一个单机游戏的所有乐趣挡在一张表单后面。
 *  2. **存档用单调 rev 而不是时间戳**。两台设备的系统时间可能差十几分钟，
 *     谁更新不能靠钟，只能靠一个只增不减的计数器。
 *  3. **镜像池只做替换，不做叠加**。云端返回的那批镜像带 `cg_` 前缀，
 *     每次同步先把上次那批摘掉再挂新的 —— 否则玩家打一天竞技场，
 *     池子里会堆满同一个人的十几个过期快照。
 */

import { createNet } from './net.js';
import { CLOUD_CONFIG } from './cloud-config.js';

const KEY = 'ruin-spire/cloud';
const CLOUD_PREFIX = 'cg_';

/** FNV-1a：只需要判断"内容变没变"，不需要密码学强度 */
function hashText(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36) + ':' + s.length.toString(36);
}

/**
 * 不参与指纹的字段（上传时仍然整包上）：
 *   tickets / ticketAt / ads —— 纯计时器，每次开局被 tick 改写，不代表进度
 *   ghosts —— 对手池。预置陪练每次启动都会重新生成一批，id 都不一样；
 *             把它算进指纹，等于每次开机都"存档变了"，rev 白涨一轮
 */
const VOLATILE_KEYS = ['tickets', 'ticketAt', 'ads', 'ghosts'];

function fingerprint(meta) {
  const view = {};
  for (const k of Object.keys(meta)) if (!VOLATILE_KEYS.includes(k)) view[k] = meta[k];
  return hashText(JSON.stringify(view));
}

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

function pickStorage(s) {
  if (s) return s;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* 隐私模式会直接抛 */
  }
  return memoryStorage();
}

/**
 * 云端镜像并进本地池子。纯函数，方便单测。
 * `cg_` 是云端镜像的保留前缀 —— 名字后缀「·镜像」是给玩家看的，前缀是给代码认的。
 */
export function mergeCloudGhosts(meta, rows, limit = 12) {
  if (!meta) return [];
  const mine = (meta.ghosts || []).filter((g) => g && !String(g.id || '').startsWith(CLOUD_PREFIX));
  const cloud = [];
  for (const row of rows || []) {
    const s = row && row.snapshot;
    if (!s || !s.classId || !s.raceId || !Array.isArray(s.deck) || !s.deck.length) continue;
    cloud.push({
      ...s,
      id: CLOUD_PREFIX + String(s.id || cloud.length),
      name: `${s.name || '无名者'}·镜像`,
      status: 'ghost',
      arenaScore: Math.max(0, Math.round(Number(row.score ?? s.arenaScore) || 800)),
    });
  }
  meta.ghosts = [...mine, ...cloud.slice(0, limit)];
  return meta.ghosts;
}

export function createCloud({ config = CLOUD_CONFIG, storage, fetchImpl, now = () => Date.now() } = {}) {
  const store = pickStorage(storage);
  const enabled = !!(config && config.baseUrl);
  const net = createNet({ baseUrl: config?.baseUrl || '', fetchImpl, timeoutMs: config?.timeoutMs });

  function read() {
    try {
      const raw = store.getItem(KEY);
      if (!raw) return { playerId: '', token: '', nick: '', rev: 0, hash: '', at: 0, error: '' };
      const v = JSON.parse(raw);
      return {
        playerId: String(v.playerId || ''),
        token: String(v.token || ''),
        nick: String(v.nick || ''),
        rev: Math.max(0, Number(v.rev) || 0),
        hash: String(v.hash || ''),
        at: Number(v.at) || 0,
        error: String(v.error || ''),
      };
    } catch {
      return { playerId: '', token: '', nick: '', rev: 0, hash: '', at: 0, error: '' };
    }
  }

  let rec = read();
  if (rec.token) net.setToken(rec.token);

  function write(patch) {
    rec = { ...rec, ...patch };
    try {
      store.setItem(KEY, JSON.stringify(rec));
    } catch {
      /* 存满就只保留内存态，下次同步会重新注册 —— 不至于崩 */
    }
  }

  function identity() {
    return rec.token ? { playerId: rec.playerId, nick: rec.nick } : null;
  }

  /**
   * 注册设备身份。已经注册过就直接返回，不会重复建号。
   * 昵称只用于云端榜单显示；玩家没设就用一个中性的默认值。
   */
  async function signIn(nick) {
    if (!enabled) return { ok: false, code: 'disabled', message: '没有配置云端地址' };
    if (rec.token) return { ok: true, identity: identity() };
    const r = await net.createPlayer(nick || '塔下无名');
    if (!r.ok) return { ok: false, code: r.code, message: r.message || '注册失败' };
    net.setToken(r.data.token);
    write({ playerId: r.data.playerId, token: r.data.token, nick: r.data.nick || '', rev: 0, hash: '', at: now(), error: '' });
    return { ok: true, identity: identity() };
  }

  /**
   * 换设备：用存档码接回原来的身份。
   *
   * 服务端会换发新 token 并让旧 token 失效（转移所有权），所以回来之后
   * 本地的 rev 基线要作废重来 —— 下一次 pull 会从云端把真实 rev 拉齐。
   */
  async function recover(code) {
    if (!enabled) return { ok: false, code: 'disabled', message: '没有配置云端地址' };
    const id = String(code || '').trim();
    if (!id) return { ok: false, code: 'bad_code', message: '存档码是空的' };
    if (rec.token && rec.playerId === id) return { ok: true, identity: identity() };

    const r = await net.recover(id);
    if (!r.ok) {
      write({ error: r.code || 'recover_failed' });
      return { ok: false, code: r.code, message: r.message || '接不回来' };
    }
    net.setToken(r.data.token);
    write({
      playerId: r.data.playerId,
      token: r.data.token,
      nick: r.data.nick || '',
      rev: 0,
      hash: '',
      at: now(),
      error: '',
    });
    return { ok: true, identity: identity() };
  }

  /**
   * 退出登录 = 丢掉设备身份。**没有密码可以找回**，
   * 所以 UI 上必须先说清楚"这个账号此后无法再登录回来"，再去调它。
   */
  function signOut() {
    net.setToken('');
    write({ playerId: '', token: '', nick: '', rev: 0, hash: '', at: 0, error: '' });
  }

  async function pull() {
    if (!enabled) return { ok: false, code: 'disabled' };
    if (!identity()) return { ok: false, code: 'no_identity' };
    const r = await net.pullSave();
    if (r.ok) {
      const rev = Number(r.data.rev) || 0;
      /** 拉到云端 rev 比本地记录新，就跟上 —— 否则下次上传会被自己的旧 rev 顶掉 */
      if (rev > rec.rev) write({ rev, hash: fingerprint(r.data.payload), at: now() });
      return { ok: true, rev, payload: r.data.payload, at: r.data.at };
    }
    if (r.status === 404) return { ok: true, empty: true };
    write({ error: r.code || 'pull_failed' });
    return { ok: false, code: r.code, message: r.message };
  }

  /**
   * 上传存档。内容没变（hash 相同）就跳过，避免大厅每次 tick 都打一次网络。
   * 409 时把云端 rev 采纳为本地基线，并**不覆盖云端** —— 冲突要玩家自己决定。
   */
  async function push(meta, { force = false } = {}) {
    if (!enabled) return { ok: false, code: 'disabled' };
    if (!meta) return { ok: false, code: 'no_meta' };

    const h = fingerprint(meta);
    if (!force && h === rec.hash) return { ok: true, skipped: true, rev: rec.rev };

    if (!identity()) {
      const s = await signIn(meta.playerName || '塔下无名');
      if (!s.ok) {
        write({ error: s.code || 'signin_failed' });
        return { ok: false, code: s.code };
      }
    }

    const rev = rec.rev + 1;
    const r = await net.pushSave(rev, meta);
    if (r.ok) {
      write({ rev, hash: h, at: now(), error: '' });
      return { ok: true, rev };
    }
    if (r.code === 'rev_conflict') {
      write({ rev: Number(r.data?.rev) || rec.rev, error: 'rev_conflict' });
      return { ok: false, code: 'rev_conflict', remoteRev: Number(r.data?.rev) || 0 };
    }
    write({ error: r.code || 'push_failed' });
    return { ok: false, code: r.code, message: r.message };
  }

  /** 把一个角色快照发到云端镜像池（分数作为匹配依据） */
  async function publishGhost(ch, score) {
    if (!enabled || !ch) return { ok: false, code: 'disabled' };
    if (!identity()) return { ok: false, code: 'no_identity' };
    const snap = JSON.parse(JSON.stringify(ch));
    const r = await net.pushGhost({
      score: Math.max(0, Math.round(Number(score ?? ch.arenaScore) || 800)),
      snapshot: snap,
    });
    return r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message };
  }

  /** 拉云端镜像并替换上一批（`cg_` 前缀） */
  async function syncGhosts(meta, score, n = 6) {
    if (!enabled || !meta) return { ok: false, code: 'disabled' };
    const r = await net.fetchGhosts(score, n);
    if (!r.ok) return { ok: false, code: r.code, message: r.message };
    const rows = (r.data && r.data.ghosts) || [];
    mergeCloudGhosts(meta, rows, Math.max(1, n));
    return { ok: true, count: rows.length };
  }

  function status() {
    return {
      enabled,
      baseUrl: net.baseUrl,
      signedIn: !!rec.token,
      playerId: rec.playerId,
      rev: rec.rev,
      at: rec.at,
      error: rec.error,
    };
  }

  return { enabled, identity, signIn, recover, signOut, pull, push, publishGhost, syncGhosts, status, mergeCloudGhosts };
}
