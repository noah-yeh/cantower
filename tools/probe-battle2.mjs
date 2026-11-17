/**
 * 临时探针：战斗页的暂停条是否可见 + 二次出发是否覆盖在跑的探险。
 * 用法：node tools/probe-battle2.mjs
 */
import { chromium } from 'playwright-core';

const OUT = 'tools/.probe-exp';
const URL = 'http://127.0.0.1:4182/';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
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

// 出发第一位，然后连续翻格直到触发战斗（优先打敌人格）
let battle = false;
for (let i = 0; i < 40 && !battle; i++) {
  const cell = page.locator('.dcell.k-enemy.pending').first();
  if (await cell.count()) {
    await cell.click().catch(() => {});
    await page.waitForTimeout(250);
    if (await page.locator('.hand').count()) battle = true;
    continue;
  }
  const any = page.locator('.dcell.reach').first();
  if (await any.count()) { await any.click().catch(() => {}); await page.waitForTimeout(250); }
}
console.log('进了战斗页:', battle);
await page.screenshot({ path: `${OUT}-5-battle.png`, fullPage: true });

// 暂停按钮的可见性（DOM 有 ≠ 看得见）
const pauseInfo = await page.evaluate(() => {
  const b = document.querySelector('[data-action="pause"]');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const vh = window.innerHeight;
  const midHit = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, vh - 2));
  return {
    rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) },
    viewportH: vh,
    visible: r.bottom <= vh && r.top >= 0 && r.height > 0,
    coveredBy: midHit ? (midHit.closest('[data-action]')?.dataset.action || midHit.className) : 'outside',
  };
});
console.log('战斗页暂停条:', JSON.stringify(pauseInfo));

// 暂停回大厅，再进冒险页，直接点第二个人的出发 → 会发生什么
const pause = page.locator('[data-action="pause"]').first();
if (await pause.count()) { await pause.click().catch(() => {}); await page.waitForTimeout(400); }
await page.locator('[data-action="open-expedition"]').first().click().catch(() => {});
await page.waitForTimeout(300);
const second = page.locator('[data-action="explore"]').first();
if (await second.count()) {
  await second.click();
  await page.waitForTimeout(500);
}
await page.screenshot({ path: `${OUT}-6-second-run.png` });
console.log('二次出发后:', await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('ruin-spire/hall') || '{}');
  return {
    metaRun: m.run,
    statuses: m.roster?.map((c) => ({ name: c.name, status: c.status, lives: c.lives })),
    runChar: JSON.parse(localStorage.getItem('ruin-spire/run') || '{}')?.characterId ?? null,
    screen: document.querySelector('.hall-title')?.textContent || 'in-run',
    flash: document.querySelector('.flash')?.textContent,
  };
}));

await browser.close();
