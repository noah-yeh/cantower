/**
 * 临时探针：复现「点继续显示战斗已结束」。
 * 三条路径各测一次：地图页暂停→继续、战斗页暂停→继续、战斗页暂停→刷新→继续。
 * 用法：node tools/probe-resume-bug.mjs
 */
import { chromium } from 'playwright-core';

const OUT = 'tools/.probe-res';
const URL = 'http://127.0.0.1:4182/';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

async function boot() {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  for (let i = 0; i < 1; i++) {
    const r = page.locator('[data-action="recruit"]').first();
    if (await r.count()) { await r.click().catch(() => {}); await page.waitForTimeout(250); }
    const h = page.locator('[data-action="hire"]').first();
    if (await h.count()) { await h.click().catch(() => {}); await page.waitForTimeout(250); }
  }
  await page.locator('[data-action="open-expedition"]').first().click();
  await page.locator('[data-action="explore"]').first().click();
  await page.waitForTimeout(400);
}

const snap = () => page.evaluate(() => {
  const run = JSON.parse(localStorage.getItem('ruin-spire/run') || 'null');
  return {
    screen: document.querySelector('.hall-title')?.textContent || (document.querySelector('.hand') ? 'battle' : document.querySelector('.dmap') ? 'dungeon' : 'other'),
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 80),
    phase: run?.phase ?? null,
    hasBattle: !!run?.battle,
  };
});

// A. 地图页暂停 → 继续
await boot();
console.log('A 开局:', JSON.stringify(await snap()));
await page.locator('[data-action="pause"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(400);
console.log('A 继续后:', JSON.stringify(await snap()));
await page.screenshot({ path: `${OUT}-a.png` });

// B. 打到战斗页 → 暂停 → 继续
let battle = false;
for (let i = 0; i < 80 && !battle; i++) {
  const enemy = page.locator('.dcell.k-enemy.pending').first();
  const target = (await enemy.count()) ? enemy : page.locator('.dcell.reach').first();
  if (!(await target.count())) break;
  await target.click(); await page.waitForTimeout(180);
  if (await page.locator('.hand').count()) battle = true;
}
console.log('B 进战斗:', battle, JSON.stringify(await snap()));
if (battle) {
  await page.locator('.topbar [data-action="pause"]').first().click();
  await page.waitForTimeout(300);
  console.log('B 暂停后:', JSON.stringify(await snap()));
  await page.locator('[data-action="resume"]').first().click();
  await page.waitForTimeout(400);
  console.log('B 继续后:', JSON.stringify(await snap()));
  await page.screenshot({ path: `${OUT}-b.png` });

  // C. 再暂停 → 刷新 → 继续
  await page.locator('[data-action="pause"]').first().click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  console.log('C 刷新后:', JSON.stringify(await snap()));
  const r2 = page.locator('[data-action="resume"]').first();
  if (await r2.count()) { await r2.click(); await page.waitForTimeout(400); }
  console.log('C 继续后:', JSON.stringify(await snap()));
  await page.screenshot({ path: `${OUT}-c.png` });
}

await browser.close();
