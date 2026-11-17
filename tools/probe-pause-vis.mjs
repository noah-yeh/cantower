/**
 * 临时探针：检查塔内暂停条在视口内的位置（不滚动能不能看到）。
 * 用法：node tools/probe-pause-vis.mjs
 */
import { chromium } from 'playwright-core';

const OUT = 'tools/.probe-exp';
const URL = 'http://127.0.0.1:4182/';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

for (let i = 0; i < 2; i++) {
  const r = page.locator('[data-action="recruit"]').first();
  if (await r.count()) { await r.click().catch(() => {}); await page.waitForTimeout(250); }
  const h = page.locator('[data-action="hire"]').first();
  if (await h.count()) { await h.click().catch(() => {}); await page.waitForTimeout(250); }
}

await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="explore"]').first().click();
await page.waitForTimeout(500);

// 翻格直到进战斗
let battle = false;
for (let i = 0; i < 80 && !battle; i++) {
  const enemy = page.locator('.dcell.k-enemy.pending').first();
  const target = (await enemy.count()) ? enemy : page.locator('.dcell.reach').first();
  if (!(await target.count())) break;
  await target.click();
  await page.waitForTimeout(200);
  if (await page.locator('.hand').count()) { battle = true; break; }
  if (i % 10 === 9) {
    console.log(`step ${i}:`, await page.evaluate(() => ({
      screen: document.querySelector('.hall-title')?.textContent || 'in-run',
      hasMap: !!document.querySelector('.dmap'),
      note: document.querySelector('.dnote')?.innerText.slice(0, 30),
      reach: document.querySelectorAll('.dcell.reach').length,
      pendingEnemy: document.querySelectorAll('.dcell.k-enemy.pending').length,
    })));
  }
}
console.log('进了战斗页:', battle);

const info = await page.evaluate(() => {
  const b = document.querySelector('[data-action="pause"]');
  const tray = document.querySelector('.dtray');
  const body = document.body;
  const probe = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, window.innerHeight - 2));
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0,
      clickable: hit ? (hit.closest('[data-action="pause"]') ? 'yes' : `no(${hit.className?.slice?.(0, 30) || hit.tagName})`) : 'offscreen',
    };
  };
  return {
    viewportH: window.innerHeight,
    scrollY: window.scrollY,
    bodyScrollH: body.scrollHeight,
    pause: probe(b),
    tray: probe(tray),
  };
});
console.log('地图页(390x844):', JSON.stringify(info, null, 1));
await page.screenshot({ path: `${OUT}-7-viewport-map.png` }); // 只截视口，模拟用户所见

await browser.close();
