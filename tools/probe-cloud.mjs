/**
 * 探针 v3.94：云端同步接入
 *
 * 要证的六件事（都是"真跑一遍"而不是看代码）：
 *   1. 配了 baseUrl 后，首次进大厅会自动注册身份并上传存档
 *   2. 服务器确实收到了这份存档（带 token 能拉回来）
 *   3. 刷新页面不会重复注册，身份和 rev 都不变
 *   4. 改存档后强制推一次，rev 递增
 *   5. 换设备（全新 context + ?code=存档码）能把身份和存档接回来
 *   6. 全程控制台零报错
 *
 * 前提：静态服务 + 云服务都在跑
 *   node tools/serve.mjs            (默认 4182)
 *   node server/index.js            (默认 4188)
 * 可用 PROBE_URL / CLOUD_URL 覆盖。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const CLOUD = process.env.CLOUD_URL || 'http://127.0.0.1:4188';

const fails = [];
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`  ok   ${label}${extra ? ' — ' + extra : ''}`);
  else { console.log(`  FAIL ${label}${extra ? ' — ' + extra : ''}`); fails.push(label); }
};

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });

async function newPlayerPage(init = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((cfg) => { window.__CANTA_CLOUD__ = cfg; }, { baseUrl: CLOUD, ...init });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  return { ctx, page, errs };
}

async function waitFor(page, fn, arg, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(200);
  }
}

console.log('1) 首次进大厅：自动注册 + 上传存档');
const a = await newPlayerPage();
await a.page.goto(URL, { waitUntil: 'networkidle' });
await a.page.evaluate(() => localStorage.clear());
await a.page.reload({ waitUntil: 'networkidle' });

const rec = await waitFor(a.page, () => {
  const raw = localStorage.getItem('ruin-spire/cloud');
  if (!raw) return null;
  const v = JSON.parse(raw);
  return v.token && v.playerId && v.rev > 0 ? v : null;
});
ok(!!rec, '本地拿到身份（playerId + token + rev）', rec ? `${rec.playerId} rev=${rec.rev}` : '超时');
if (!rec) { await browser.close(); process.exit(1); }

console.log('2) 服务器确实收到了这份存档');
const got = await (await fetch(`${CLOUD}/v1/save`, { headers: { authorization: `Bearer ${rec.token}` } })).json();
ok(got && got.payload && Number(got.payload.version) > 0, '带 token 能拉回存档', got?.payload ? `version=${got.payload.version} rev=${got.rev}` : JSON.stringify(got));
ok(got?.rev === rec.rev, '云端 rev 与本地一致', `本地 ${rec.rev} / 云端 ${got?.rev}`);

console.log('3) 刷新页面：不重复注册');
await a.page.reload({ waitUntil: 'networkidle' });
const rec2 = await waitFor(a.page, () => {
  const raw = localStorage.getItem('ruin-spire/cloud');
  return raw ? JSON.parse(raw) : null;
});
ok(rec2 && rec2.playerId === rec.playerId, 'playerId 不变', rec2?.playerId);
ok(rec2 && rec2.rev === rec.rev, '内容没变不重复上传（rev 不涨）', `rev=${rec2?.rev}`);

console.log('4) 改存档后强制推一次：rev 递增');
const pushed = await a.page.evaluate(async (baseUrl) => {
  const { createCloud } = await import('/src/core/cloud.js');
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const c = createCloud({ config: { baseUrl } });
  const meta = loadMeta();
  meta.gold = 31337;
  saveMeta(meta);
  return c.push(meta, { force: true });
}, CLOUD);
ok(pushed?.ok && pushed.rev === rec.rev + 1, 'rev 递增', JSON.stringify(pushed));

console.log('5) 换设备：用存档码接回来');
const b = await newPlayerPage();
await b.page.goto(`${URL}${URL.includes('?') ? '&' : '?'}code=${rec.playerId}`, { waitUntil: 'networkidle' });
const restored = await waitFor(b.page, async () => {
  const { loadMeta } = await import('/src/core/save.js');
  try {
    const m = loadMeta();
    return m && m.gold === 31337 ? { gold: m.gold } : null;
  } catch { return null; }
}, null, 10000);
ok(!!restored, '新设备拉到云端存档', restored ? `gold=${restored.gold}` : '超时');

const recB = await b.page.evaluate(() => {
  const raw = localStorage.getItem('ruin-spire/cloud');
  return raw ? JSON.parse(raw) : null;
});
ok(recB && recB.playerId === rec.playerId, '身份接回来了', recB?.playerId);

console.log('6) 控制台零报错');
ok(a.errs.length === 0, '设备 A 无 pageerror', a.errs.join(' | '));
ok(b.errs.length === 0, '设备 B 无 pageerror', b.errs.join(' | '));

await browser.close();
console.log(fails.length ? `\nFAILED ${fails.length}: ${fails.join(', ')}` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
