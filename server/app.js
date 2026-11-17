/**
 * 残塔云端后端 · HTTP 层。
 *
 * 只做四件事，多一件都不做：
 *   1. 账号：换一个 playerId + token（无密码，设备级身份；TapTap 登录以后接在同一个 playerId 上）
 *   2. 存档：整包上传 / 整包拉取，靠单调 rev 防两台设备互相覆盖
 *   3. 镜像：上传自己的角色快照，按段位分取相邻的 N 个对手
 *   4. 守卫：CORS、请求体上限、基础限流、错误一律给可读文案
 *
 * 刻意不做的：不做实时对战、不做服务端战斗校验。残塔的竞技场是**异步镜像战**——
 * 战斗本来就在客户端确定性推演，服务端只负责"把别人真实的存档发给你"。
 * 上服务端校验得把整套 core 搬到 Node 里跑，收益远不如先让镜像成真。
 */

import { createHash, randomBytes } from 'node:crypto';

const MAX_BODY = 512 * 1024;
const MAX_SAVE = 400 * 1024;
const MAX_GHOST = 200 * 1024;
const MAX_GHOSTS_PER_QUERY = 10;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const newId = (prefix) => prefix + randomBytes(9).toString('base64url').replace(/[-_]/g, '').slice(0, 14);

function json(res, code, body, cors) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...cors,
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      /**
       * 超限后**不 destroy socket**：直接砍连接的话客户端看到的是 ECONNRESET，
       * 而不是我们准备好的 413 文案。这里改为丢弃后续分片、等 end 再拒，
       * 客户端能拿到可读的错误。
       */
      if (tooLarge) return;
      size += c.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) reject(Object.assign(new Error('请求体过大'), { code: 'too_large' }));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function parseJson(raw) {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 'bad_json' });
  }
}

/** 存档只收 { version, meta } 这种浅结构，字段由客户端定义；服务端不做业务校验 */
function checkSave(body) {
  const rev = Number(body.rev);
  if (!Number.isInteger(rev) || rev < 1) return { err: 'rev 必须是 ≥1 的整数' };
  if (!body.payload || typeof body.payload !== 'object') return { err: 'payload 必须是对象' };
  const text = JSON.stringify(body.payload);
  if (Buffer.byteLength(text) > MAX_SAVE) return { err: '存档超过 400KB' };
  return { rev, text };
}

/**
 * 镜像快照的最小校验。
 * 真正决定"这个快照能不能用来打"的是客户端 matchOpponents（要求有 deck），
 * 这里只挡住明显不是角色对象的东西，避免脏数据把榜单打穿。
 */
function checkGhost(body) {
  const s = body.snapshot;
  if (!s || typeof s !== 'object') return { err: 'snapshot 必须是对象' };
  if (!s.classId || !s.name || !Array.isArray(s.deck)) return { err: 'snapshot 缺少 classId / name / deck' };
  const text = JSON.stringify(s);
  if (Buffer.byteLength(text) > MAX_GHOST) return { err: '镜像快照超过 200KB' };
  return {
    score: Math.max(0, Math.round(Number(body.score ?? s.arenaScore) || 800)),
    name: String(s.name).slice(0, 32),
    classId: String(s.classId).slice(0, 16),
    raceId: String(s.raceId || '').slice(0, 16),
    level: Math.max(1, Math.round(Number(s.level) || 1)),
    text,
  };
}

export function createApp({ store, now = () => Date.now(), corsOrigin = '*', rateMax = RATE_MAX }) {
  const cors = {
    'access-control-allow-origin': corsOrigin,
    'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
  };

  /** 极简滑动窗口限流：单进程内存，够挡住脚本刷接口；多实例时按实例各算各的 */
  const hits = new Map();
  function limited(ip) {
    if (!rateMax) return false;
    const t = now();
    const arr = (hits.get(ip) || []).filter((x) => t - x < RATE_WINDOW_MS);
    arr.push(t);
    hits.set(ip, arr);
    if (hits.size > 5000) hits.clear();
    return arr.length > rateMax;
  }

  async function auth(req) {
    const h = String(req.headers.authorization || '');
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (!m) return null;
    const p = await store.playerByTokenHash(sha256(m[1].trim()));
    return p || null;
  }

  return async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return json(res, 429, { error: 'too_many_requests', message: '请求太频繁，稍后再试' }, cors);

    try {
      if (req.method === 'GET' && (path === '/health' || path === '/')) {
        return json(res, 200, { ok: true, service: 'canta-cloud', store: store.kind, at: now() }, cors);
      }

      if (req.method === 'POST' && path === '/v1/player') {
        const body = parseJson(await readBody(req));
        const token = randomBytes(24).toString('base64url');
        const rec = {
          id: newId('p_'),
          tokenHash: sha256(token),
          nick: body.nick ? String(body.nick).slice(0, 24) : null,
          at: now(),
        };
        await store.createPlayer(rec);
        return json(res, 200, { playerId: rec.id, token, nick: rec.nick }, cors);
      }

      /**
       * 换设备：用存档码（= playerId）换一个新 token。
       *
       * 为什么不做密码：这是个单机游戏，让玩家为同步存档去注册一个密码，
       * 流失远大于收益。playerId 是 84 位随机串，当凭据猜不出来。
       * 换发新 token 时**旧 token 立即失效** —— 存档码被前一台设备留着也不再有写权限，
       * 相当于一次"转移所有权"。代价是旧设备要重新用存档码接回来。
       */
      if (req.method === 'POST' && path === '/v1/recover') {
        const body = parseJson(await readBody(req));
        const code = String(body.playerId || '').trim();
        if (!/^p_[A-Za-z0-9_-]{4,28}$/.test(code)) {
          return json(res, 400, { error: 'bad_request', message: '存档码格式不对' }, cors);
        }
        if (limited(`recover:${ip}`)) {
          return json(res, 429, { error: 'too_many_requests', message: '试得太频繁了，过一会儿再来' }, cors);
        }
        const p = await store.playerById(code);
        if (!p) return json(res, 404, { error: 'not_found', message: '没有这个存档码' }, cors);
        const token = randomBytes(24).toString('base64url');
        await store.rotateToken(p.id, sha256(token));
        return json(res, 200, { playerId: p.id, token, nick: p.nick }, cors);
      }

      if (path === '/v1/save') {
        const me = await auth(req);
        if (!me) return json(res, 401, { error: 'unauthorized', message: '请先登录' }, cors);

        if (req.method === 'GET') {
          const s = await store.getSave(me.id);
          if (!s) return json(res, 404, { error: 'no_save', message: '云端还没有存档' }, cors);
          return json(res, 200, { rev: s.rev, payload: JSON.parse(s.payload), at: s.at }, cors);
        }

        if (req.method === 'PUT') {
          const body = parseJson(await readBody(req));
          const ok = checkSave(body);
          if (ok.err) return json(res, 400, { error: 'bad_request', message: ok.err }, cors);

          const cur = await store.getSave(me.id);
          /**
           * 冲突用 409 + 当前 rev 回给客户端，而不是"后到的赢"。
           * 后到赢会让玩家在两台设备上各玩一会儿就丢一边的进度；
           * 409 让客户端自己决定是覆盖还是先拉下来看看。
           */
          if (cur && ok.rev <= cur.rev) {
            return json(res, 409, { error: 'rev_conflict', rev: cur.rev, at: cur.at, message: '云端已有更新的存档' }, cors);
          }
          await store.putSave(me.id, ok.rev, ok.text, now());
          return json(res, 200, { ok: true, rev: ok.rev }, cors);
        }
        return json(res, 405, { error: 'method_not_allowed' }, cors);
      }

      if (req.method === 'POST' && path === '/v1/ghost') {
        const me = await auth(req);
        if (!me) return json(res, 401, { error: 'unauthorized', message: '请先登录' }, cors);
        const body = parseJson(await readBody(req));
        const ok = checkGhost(body);
        if (ok.err) return json(res, 400, { error: 'bad_request', message: ok.err }, cors);
        await store.upsertGhost({
          playerId: me.id,
          score: ok.score,
          name: ok.name,
          classId: ok.classId,
          raceId: ok.raceId,
          level: ok.level,
          snapshot: ok.text,
          at: now(),
        });
        return json(res, 200, { ok: true, score: ok.score }, cors);
      }

      if (req.method === 'GET' && path === '/v1/ghosts') {
        /** 镜像池是公开榜单（和排行榜同性质），不要求登录 —— 让新玩家第一次进来就有对手可打 */
        const score = Math.max(0, Math.round(Number(url.searchParams.get('score')) || 800));
        const n = Math.min(MAX_GHOSTS_PER_QUERY, Math.max(1, Math.round(Number(url.searchParams.get('n')) || 3)));
        const rows = await store.listGhostsNear(score, n);
        return json(res, 200, {
          ghosts: rows.map((g) => ({
            score: g.score,
            level: g.level,
            at: g.at,
            snapshot: JSON.parse(g.snapshot),
          })),
        }, cors);
      }

      return json(res, 404, { error: 'not_found', message: '没有这个接口' }, cors);
    } catch (e) {
      const code = e?.code === 'too_large' ? 413 : e?.code === 'bad_json' ? 400 : 500;
      const msg = code === 500 ? '服务端出错了' : e.message;
      return json(res, code, { error: code === 413 ? 'too_large' : 'bad_request', message: msg }, cors);
    }
  };
}
