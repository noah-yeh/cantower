/**
 * 云端同步层（v3.94）
 *
 * 契约：
 *   1. 没配 baseUrl 时整层停用，一个请求都不许发
 *   2. rev 单调递增；内容没变不上传；409 时采纳云端 rev 但不覆盖
 *   3. 云端镜像带 `cg_` 前缀，每次同步替换上一批，不会累积
 *   4. 任何失败都返回结果对象，不抛异常
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCloud, mergeCloudGhosts } from '../src/core/cloud.js';

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => m,
  };
}

/** 只实现 createNet 用到的三个成员：ok / status / json() */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    const rec = { path, method: init.method || 'GET', body, auth: init.headers?.authorization || '' };
    calls.push(rec);
    const out = handler(rec) || {};
    return {
      ok: (out.status ?? 200) < 400,
      status: out.status ?? 200,
      json: async () => out.data ?? null,
    };
  };
  fn.calls = calls;
  return fn;
}

const baseMeta = (over = {}) => ({
  version: 9,
  playerName: '阿绫',
  gold: 100,
  roster: [{ id: 'c1', name: '阿绫' }],
  ghosts: [],
  ...over,
});

test('没配 baseUrl：整层停用，一个请求都不发', async () => {
  const f = fakeFetch(() => { throw new Error('不该有请求'); });
  const c = createCloud({ config: { baseUrl: '' }, storage: memStorage(), fetchImpl: f });

  assert.equal(c.enabled, false);
  assert.equal((await c.push(baseMeta())).code, 'disabled');
  assert.equal((await c.pull()).code, 'disabled');
  assert.equal((await c.syncGhosts(baseMeta(), 800)).code, 'disabled');
  assert.equal(f.calls.length, 0);
});

test('第一次 push 自动注册，然后带 token 上传 rev1', async () => {
  const f = fakeFetch((c) => {
    if (c.path === '/v1/player') return { data: { playerId: 'p_1', token: 'T1', nick: '阿绫' } };
    if (c.path === '/v1/save') return { data: { ok: true, rev: c.body.rev } };
    return {};
  });
  const store = memStorage();
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: store, fetchImpl: f });

  const r = await c.push(baseMeta());
  assert.equal(r.ok, true);
  assert.equal(r.rev, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].path, '/v1/player');
  assert.equal(f.calls[1].auth, 'Bearer T1', '注册后要用新 token 上传');
  assert.equal(c.identity().playerId, 'p_1');
  assert.match(String(store.getItem('ruin-spire/cloud')), /p_1/, '身份要落本地存储');
});

test('内容没变时重复 push 直接跳过，不打网络', async () => {
  const f = fakeFetch((c) => {
    if (c.path === '/v1/player') return { data: { playerId: 'p_1', token: 'T1' } };
    return { data: { rev: c.body.rev } };
  });
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: memStorage(), fetchImpl: f });

  await c.push(baseMeta());
  const before = f.calls.length;
  const r2 = await c.push(baseMeta());
  assert.equal(r2.skipped, true);
  assert.equal(f.calls.length, before, '内容相同不该再发请求');

  const r3 = await c.push(baseMeta({ gold: 200 }));
  assert.equal(r3.ok, true);
  assert.equal(r3.rev, 2, '内容变了 rev 要 +1');
});

test('只有计时器字段变化时不触发上传（否则每次启动都白推一次）', async () => {
  const f = fakeFetch((c) => {
    if (c.path === '/v1/player') return { data: { playerId: 'p_1', token: 'T1' } };
    return { data: { rev: c.body.rev } };
  });
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: memStorage(), fetchImpl: f });

  await c.push(baseMeta({ tickets: 2, ticketAt: 1000, ads: { day: '2026-01-01', used: 0 } }));
  const n = f.calls.length;
  const r = await c.push(baseMeta({ tickets: 2, ticketAt: 9999, ads: { day: '2026-01-02', used: 3 } }));
  assert.equal(r.skipped, true, '名额冷却/广告计数变了不算存档变了');
  assert.equal(f.calls.length, n);

  const r2 = await c.push(baseMeta({ gold: 1, tickets: 2, ticketAt: 9999 }));
  assert.equal(r2.ok, true);
  assert.equal(r2.rev, 2, '真的进度变了才 push');
});

test('409 冲突：采纳云端 rev，但不把本地那份写上去', async () => {
  const f = fakeFetch((c) => {
    if (c.path === '/v1/player') return { data: { playerId: 'p_1', token: 'T1' } };
    if (c.body.rev === 1) return { status: 409, data: { error: 'rev_conflict', rev: 7 } };
    return { data: { rev: c.body.rev } };
  });
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: memStorage(), fetchImpl: f });

  const r = await c.push(baseMeta());
  assert.equal(r.ok, false);
  assert.equal(r.code, 'rev_conflict');
  assert.equal(r.remoteRev, 7);
  assert.equal(c.status().rev, 7, '本地基线要跟上云端 rev');

  const again = await c.push(baseMeta({ gold: 999 }));
  assert.equal(again.ok, true);
  assert.equal(again.rev, 8);
});

test('pull：第一次 404 当"云端没存档"，有存档时把 rev 拉齐', async () => {
  const payload = baseMeta({ gold: 555 });
  let pulls = 0;
  const f = fakeFetch((c) => {
    if (c.path === '/v1/player') return { data: { playerId: 'p_1', token: 'T1' } };
    if (c.path !== '/v1/save') return {};
    pulls++;
    if (pulls === 1) return { status: 404, data: { error: 'no_save' } };
    return { data: { rev: 4, payload, at: 1 } };
  });
  const store = memStorage();
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: store, fetchImpl: f });
  await c.signIn('阿绫');

  const empty = await c.pull();
  assert.equal(empty.ok, true);
  assert.equal(empty.empty, true);

  const got = await c.pull();
  assert.equal(got.ok, true);
  assert.equal(got.rev, 4);
  assert.equal(got.payload.gold, 555);
  assert.equal(c.status().rev, 4);
});

test('mergeCloudGhosts：替换上一批镜像、保留本地幽灵、过滤非法快照', () => {
  const meta = baseMeta({
    ghosts: [
      { id: 'g_local', name: '老人·旧影', classId: 'warrior', raceId: 'ember', deck: ['a'] },
      { id: 'cg_old', name: '上一批·镜像', classId: 'mage', raceId: 'moss', deck: ['b'] },
    ],
  });
  const rows = [
    { score: 900, snapshot: { id: 'c_new', name: '新人', classId: 'hunter', raceId: 'shade', deck: ['c'] } },
    { score: 1100, snapshot: { id: 'c_bad', name: '坏档' } },
    { score: 1200, snapshot: { name: '无职业', classId: 'warrior', raceId: 'ember', deck: [] } },
  ];
  mergeCloudGhosts(meta, rows);

  const ids = meta.ghosts.map((g) => g.id);
  assert.ok(ids.includes('g_local'), '本地快照不能被云端覆盖掉');
  assert.ok(!ids.includes('cg_old'), '上一批镜像要清掉');
  assert.equal(meta.ghosts.filter((g) => g.id.startsWith('cg_')).length, 1, '非法快照要丢掉');
  const cloud = meta.ghosts.find((g) => g.id === 'cg_c_new');
  assert.equal(cloud.name, '新人·镜像');
  assert.equal(cloud.arenaScore, 900);
  assert.equal(cloud.status, 'ghost');
});

test('syncGhosts 连续同步两次不会累积镜像', async () => {
  const f = fakeFetch((c) => {
    if (c.path.startsWith('/v1/ghosts')) {
      return { data: { ghosts: [{ score: 1000, snapshot: { id: 'c_x', name: 'X', classId: 'warrior', raceId: 'ember', deck: ['a'] } }] } };
    }
    return {};
  });
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: memStorage(), fetchImpl: f });
  const meta = baseMeta();

  await c.syncGhosts(meta, 1000);
  await c.syncGhosts(meta, 1000);
  assert.equal(meta.ghosts.filter((g) => g.id.startsWith('cg_')).length, 1);
  assert.match(f.calls[0].path, /score=1000/, '要按玩家分数取相邻对手');
});

test('没登录时上传镜像 / 同步镜像返回 no_identity，不崩', async () => {
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: memStorage(), fetchImpl: fakeFetch(() => ({})) });
  assert.equal((await c.publishGhost({ classId: 'warrior' }, 800)).code, 'no_identity');
  const g = await c.syncGhosts(baseMeta(), 800);
  assert.equal(g.ok, true, '镜像池是公开的，未登录也能看');
});

test('publishGhost 用角色段位分开传', async () => {
  const f = fakeFetch((c) => {
    if (c.path === '/v1/player') return { data: { playerId: 'p_1', token: 'T1' } };
    return { data: { ok: true } };
  });
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: memStorage(), fetchImpl: f });
  await c.signIn('阿绫');
  const r = await c.publishGhost({ id: 'c1', name: '阿绫', classId: 'warrior', raceId: 'ember', deck: ['a'], arenaScore: 1234 });
  assert.equal(r.ok, true);
  const call = f.calls.find((x) => x.path === '/v1/ghost');
  assert.equal(call.body.score, 1234);
  assert.equal(call.body.snapshot.name, '阿绫');
});

test('网络失败返回 network，并记在 status 上', async () => {
  const boom = async () => { throw new Error('offline'); };
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: memStorage(), fetchImpl: boom });
  const r = await c.push(baseMeta());
  assert.equal(r.ok, false);
  assert.equal(c.status().error, 'network');
});

test('存档码换设备：身份接回来，rev 基线作废重拉', async () => {
  const payload = baseMeta({ gold: 888 });
  const f = fakeFetch((c) => {
    if (c.path === '/v1/recover') return { data: { playerId: 'p_old', token: 'T2', nick: '老号' } };
    if (c.path === '/v1/save') return { data: { rev: 12, payload, at: 1 } };
    return {};
  });
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: memStorage(), fetchImpl: f });

  const r = await c.recover('p_old');
  assert.equal(r.ok, true);
  assert.equal(c.identity().playerId, 'p_old');
  assert.equal(c.status().rev, 0, 'rev 基线先清零，等 pull 拉齐');

  const got = await c.pull();
  assert.equal(got.payload.gold, 888);
  assert.equal(c.status().rev, 12);

  const up = await c.push(baseMeta({ gold: 999 }));
  assert.equal(up.rev, 13, '接回来之后继续按云端 rev 递增');
});

test('存档码接不上时返回失败而不是抛异常', async () => {
  const f = fakeFetch(() => ({ status: 404, data: { error: 'not_found', message: '没有这个存档码' } }));
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: memStorage(), fetchImpl: f });
  const r = await c.recover('p_nope');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not_found');
  assert.equal(c.identity(), null);
});

test('signOut 清掉身份，之后 push 会重新注册', async () => {
  let n = 0;
  const f = fakeFetch((c) => {
    if (c.path === '/v1/player') { n++; return { data: { playerId: `p_${n}`, token: `T${n}` } }; }
    return { data: { rev: c.body.rev } };
  });
  const c = createCloud({ config: { baseUrl: 'https://api.test' }, storage: memStorage(), fetchImpl: f });
  await c.push(baseMeta());
  assert.equal(c.identity().playerId, 'p_1');
  c.signOut();
  assert.equal(c.identity(), null);
  await c.push(baseMeta({ gold: 1 }));
  assert.equal(c.identity().playerId, 'p_2');
});
