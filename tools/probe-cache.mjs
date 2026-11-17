/**
 * 探针 v3.31c：SWR 缓存更新行为验证（不动磁盘，安全版）
 *
 * 前一版探针用"覆盖磁盘文件"模拟服务器换图，第一次运行崩在连接失败时
 * 已经把真图覆盖成了旧图 —— 教训：验证缓存行为不该碰真实资产。
 *
 * 这里改用 Cache API 直接做实验：
 *   1. 往**当前版本缓存**里塞一张假图（冒充旧缓存）
 *   2. fetch 该 URL → SWR 当拍应返回假图
 *   3. 等后台 reload 写回 → 缓存里必须是服务器真图
 *   4. 再 fetch → 必须是真图
 *
 * 第 3、4 步通过 = 「cache: 'reload' 绕过浏览器 HTTP 缓存」生效，
 * 也就是"服务器换图后客户端最多一拍就能拿到新图"的证明。
 */
import { chromium } from 'playwright-core';

const URL_PATH = 'assets/img/dungeon/chest.png';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  const rs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(rs.map((r) => r.unregister()));
  const ks = await caches.keys();
  await Promise.all(ks.map((k) => caches.delete(k)));
  localStorage.clear();
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

/** 服务器的真图基准（不经过缓存：cache: reload） */
const truth = await page.evaluate(async (f) => {
  const r = await fetch(f, { cache: 'reload' });
  const buf = new Uint8Array(await r.arrayBuffer());
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}, URL_PATH);
console.log('服务器真图基准:', truth.slice(0, 16));

const result = await page.evaluate(async (f) => {
  const out = {};
  const reg = await navigator.serviceWorker.getRegistration();
  out.swState = reg ? (reg.active?.state ?? 'none') : 'no-reg';
  out.controller = !!navigator.serviceWorker.controller;
  out.cacheNames = await caches.keys();
  /** 1. 往当前版本缓存塞假图，冒充"客户端拿着旧图" */
  const cache = await caches.open(out.cacheNames[0]);
  await cache.put(f, new Response('FAKE-OLD-IMAGE'));
  out.putOk = (await (await cache.match(f))?.text()) === 'FAKE-OLD-IMAGE';
  /** 2. SWR 当拍：应命中假图 */
  out.sameTick = await (await fetch(f)).text();
  /** 3. 等后台 reload 写回 */
  await new Promise((r) => setTimeout(r, 2500));
  const back = await cache.match(f);
  const buf = new Uint8Array(await (back ? back.arrayBuffer() : new ArrayBuffer(0)));
  const h = await crypto.subtle.digest('SHA-256', buf);
  out.cachedAfter = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  out.cachedLen = back ? Number(back.headers.get('content-length') ?? -1) : -1;
  /** 4. 再 fetch 一次 */
  out.nextTick = await (await fetch(f)).text();
  out.nextLen = out.nextTick.length;
  return out;
}, URL_PATH);

console.log('sw 状态:', result.swState, '· controller:', result.controller, '· caches:', JSON.stringify(result.cacheNames), '· put成功:', result.putOk);

console.log('SWR 当拍返回:', result.sameTick.slice(0, 20), result.sameTick === 'FAKE-OLD-IMAGE' ? '(旧缓存，符合 SWR)' : '(异常)');
console.log('一拍后缓存内容哈希:', result.cachedAfter.slice(0, 16), result.cachedAfter === truth ? '= 真图 ✓' : '≠ 真图 ✗');
console.log('下一拍 fetch:', result.nextTick.length > 1000 ? `真图字节(${result.nextTick.length}B)` : result.nextTick.slice(0, 20), result.nextTick === 'FAKE-OLD-IMAGE' ? '✗ 还是假图' : '✓ 不是假图');

const pass = result.cachedAfter === truth && result.nextTick !== 'FAKE-OLD-IMAGE';
console.log(pass ? '结论：缓存更新机制生效 ✓' : '结论：缓存更新机制失效 ✗');
await browser.close();
process.exit(pass ? 0 : 1);
