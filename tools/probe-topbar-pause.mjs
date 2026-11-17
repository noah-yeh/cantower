/**
 * 临时探针：塔内顶栏「⏸ 暂停」入口 —— 可见、可点、顶栏不溢出。
 * 用法：node tools/probe-topbar-pause.mjs
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

// 地图页顶栏
const check = () => page.evaluate(() => {
  const btn = document.querySelector('.topbar [data-action="pause"]');
  if (!btn) return { found: false };
  const r = btn.getBoundingClientRect();
  const tb = document.querySelector('.topbar').getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    found: true,
    rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width) },
    topbarOverflow: tb.right > window.innerWidth,
    clickable: hit ? (hit.closest('[data-action="pause"]') ? 'yes' : 'no') : 'no',
  };
});
console.log('地图页顶栏暂停:', JSON.stringify(await check()));
await page.screenshot({ path: `${OUT}-8-topbar-map.png` });

// 翻到战斗页再看
let battle = false;
for (let i = 0; i < 80 && !battle; i++) {
  const enemy = page.locator('.dcell.k-enemy.pending').first();
  const target = (await enemy.count()) ? enemy : page.locator('.dcell.reach').first();
  if (!(await target.count())) break;
  await target.click();
  await page.waitForTimeout(200);
  if (await page.locator('.hand').count()) { battle = true; break; }
}
console.log('进了战斗页:', battle);
if (battle) {
  console.log('战斗页顶栏暂停:', JSON.stringify(await check()));
  await page.screenshot({ path: `${OUT}-9-topbar-battle.png` });
  // 点顶栏暂停 → 应回大厅
  await page.locator('.topbar [data-action="pause"]').first().click();
  await page.waitForTimeout(400);
  console.log('点顶栏暂停后:', await page.evaluate(() => ({
    screen: document.querySelector('.hall-title')?.textContent,
    resumeRow: !!document.querySelector('[data-action="resume"]'),
  })));
}

await browser.close();
