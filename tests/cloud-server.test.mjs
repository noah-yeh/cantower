/**
 * 云端后端（v3.94）
 *
 * 契约：
 *   1. 注册换到 playerId + token；没 token 的写操作一律 401
 *   2. 存档必须单调 rev：旧 rev 上来 409，并且**不覆盖**云端那份
 *   3. 镜像池按分数相邻取，公开可读
 *   4. 脏数据（缺 classId / 超大请求体）必须 4xx，不能落库
 *
 * 这一层用 memory file 驱动跑，不依赖 MySQL —— 生产换 mysql 驱动时接口不变。
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createApp } from '../server/app.js';
import { createFileStore } from '../server/store-file.js';

let server;
let base;

before(async () => {
  const store = createFileStore('', { memory: true });
  await store.init();
  server = createServer(createApp({ store, corsOrigin: '*', rateMax: 0 }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
});

const post = (path, body, token) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body ?? {}),
});
const put = (path, body, token) => fetch(base + path, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body ?? {}),
});
const get = (path, token) => fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });

async function newPlayer(nick) {
  const r = await post('/v1/player', { nick });
  assert.equal(r.status, 200);
  return r.json();
}

test('health 可用且带 store 类型', async () => {
  const r = await get('/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.store, 'file');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});

test('注册返回 playerId 与 token，且 token 每个玩家不同', async () => {
  const a = await newPlayer('甲');
  const b = await newPlayer('乙');
  assert.match(a.playerId, /^p_/);
  assert.ok(a.token.length >= 24);
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.playerId, b.playerId);
});

test('没 token 读写存档都是 401', async () => {
  assert.equal((await get('/v1/save')).status, 401);
  assert.equal((await put('/v1/save', { rev: 1, payload: {} })).status, 401);
  assert.equal((await post('/v1/ghost', { snapshot: {} })).status, 401);
});

test('新账号拉存档是 404 no_save', async () => {
  const p = await newPlayer('新人');
  const r = await get('/v1/save', p.token);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'no_save');
});

test('存档上传后能原样拉回', async () => {
  const p = await newPlayer('存档');
  const payload = { version: 9, gold: 1234, roster: [{ id: 'c1', name: '阿绫' }] };
  const up = await put('/v1/save', { rev: 1, payload }, p.token);
  assert.equal(up.status, 200);
  assert.equal((await up.json()).rev, 1);

  const back = await get('/v1/save', p.token);
  assert.equal(back.status, 200);
  const j = await back.json();
  assert.equal(j.rev, 1);
  assert.deepEqual(j.payload, payload);
});

test('旧 rev 上传被 409 挡住，云端那份保持不变', async () => {
  const p = await newPlayer('冲突');
  await put('/v1/save', { rev: 2, payload: { version: 9, gold: 100 } }, p.token);

  const stale = await put('/v1/save', { rev: 1, payload: { version: 9, gold: 1 } }, p.token);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).rev, 2);

  const same = await put('/v1/save', { rev: 2, payload: { version: 9, gold: 2 } }, p.token);
  assert.equal(same.status, 409, '同 rev 也应拒绝：rev 必须严格递增');

  const back = await (await get('/v1/save', p.token)).json();
  assert.equal(back.payload.gold, 100, '被拒的写入不能污染云端');
});

test('rev 必须是 ≥1 的整数，payload 必须是对象', async () => {
  const p = await newPlayer('校验');
  assert.equal((await put('/v1/save', { rev: 0, payload: {} }, p.token)).status, 400);
  assert.equal((await put('/v1/save', { rev: 1.5, payload: {} }, p.token)).status, 400);
  assert.equal((await put('/v1/save', { rev: 1, payload: 'x' }, p.token)).status, 400);
  assert.equal((await put('/v1/save', { rev: 1 }, p.token)).status, 400);
});

test('镜像上传后能按分数相邻取到，不需要登录', async () => {
  const mk = async (nick, score) => {
    const p = await newPlayer(nick);
    const r = await post('/v1/ghost', {
      score,
      snapshot: { id: `c_${nick}`, name: nick, classId: 'warrior', raceId: 'ember', level: 12, deck: ['strike'] },
    }, p.token);
    assert.equal(r.status, 200);
  };
  await mk('弱者', 700);
  await mk('对手', 1010);
  await mk('强者', 1450);

  const r = await get('/v1/ghosts?score=1000&n=2');
  assert.equal(r.status, 200);
  const rows = (await r.json()).ghosts;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => x.snapshot.name), ['对手', '弱者'], '按与目标分的距离排序');
  assert.ok(rows[0].snapshot.deck.length, '快照要原样还原成对象');
});

test('同一玩家重复上传镜像只留一条', async () => {
  const p = await newPlayer('频繁');
  const snap = { name: '频繁', classId: 'mage', raceId: 'moss', level: 5, deck: ['a'] };
  await post('/v1/ghost', { score: 900, snapshot: snap }, p.token);
  await post('/v1/ghost', { score: 1500, snapshot: snap }, p.token);

  const rows = (await (await get('/v1/ghosts?score=1500&n=50')).json()).ghosts;
  const mine = rows.filter((x) => x.snapshot.name === '频繁');
  assert.equal(mine.length, 1, '一个玩家只保留最新一条镜像');
  assert.equal(mine[0].score, 1500);
});

test('坏快照被 400 拒绝', async () => {
  const p = await newPlayer('坏数据');
  for (const snapshot of [null, {}, { name: 'x', classId: 'w' }, { name: 'x', classId: 'w', raceId: 'r', deck: 'no' }]) {
    const r = await post('/v1/ghost', { snapshot }, p.token);
    assert.equal(r.status, 400, `应当拒绝：${JSON.stringify(snapshot)}`);
  }
});

test('请求体超过上限给 413，且不影响后续请求', async () => {
  const p = await newPlayer('大包');
  const huge = { rev: 1, payload: { version: 9, blob: 'x'.repeat(600 * 1024) } };
  const r = await fetch(base + '/v1/save', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p.token}` },
    body: JSON.stringify(huge),
  });
  assert.equal(r.status, 413);
  assert.equal((await get('/health')).status, 200);
});

test('存档码换发新 token，旧 token 立即失效', async () => {
  const p = await newPlayer('换机');
  await put('/v1/save', { rev: 1, payload: { version: 9, gold: 7 } }, p.token);

  const r = await post('/v1/recover', { playerId: p.playerId });
  assert.equal(r.status, 200);
  const again = await r.json();
  assert.equal(again.playerId, p.playerId, '身份不变');
  assert.notEqual(again.token, p.token, 'token 要换新的');

  assert.equal((await get('/v1/save', p.token)).status, 401, '旧 token 必须失效');
  const back = await get('/v1/save', again.token);
  assert.equal(back.status, 200);
  assert.equal((await back.json()).payload.gold, 7, '存档跟着身份走');
});

test('存档码不存在 / 格式不对都被挡住', async () => {
  assert.equal((await post('/v1/recover', { playerId: 'p_nosuchplayer' })).status, 404);
  assert.equal((await post('/v1/recover', { playerId: '' })).status, 400);
  assert.equal((await post('/v1/recover', { playerId: '../../etc/passwd' })).status, 400);
});

test('未知路径 404，非法 JSON 400', async () => {
  assert.equal((await get('/v1/nope')).status, 404);
  const r = await fetch(base + '/v1/player', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{oops',
  });
  assert.equal(r.status, 400);
});
