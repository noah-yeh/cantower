/**
 * 临时探针：冒险入口的真实路径（招募 → 冒险页 → 出发 → 塔内返回 → 再开一局）。
 * 用法：node tools/probe-expedition.mjs
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

// 招 2 个人
for (let i = 0; i < 2; i++) {
  const r = page.locator('[data-action="recruit"]').first();
  if (await r.count()) { await r.click().catch(() => {}); await page.waitForTimeout(250); }
  const h = page.locator('[data-action="hire"]').first();
  if (await h.count()) { await h.click().catch(() => {}); await page.waitForTimeout(250); }
}

console.log('大厅人数:', await page.evaluate(() => JSON.parse(localStorage.getItem('ruin-spire/hall') || '{}').roster?.length));

// 进冒险页
await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}-1-expedition.png` });
console.log('冒险页:', await page.evaluate(() => ({
  title: document.querySelector('.hall-title')?.textContent,
  cards: [...document.querySelectorAll('.ex-card')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
})));

// 出发（第一个人）
await page.locator('[data-action="explore"]').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}-2-dungeon.png`, fullPage: true });
console.log('进塔后:', await page.evaluate(() => ({
  screen: document.querySelector('.hall-title')?.textContent || 'dungeon/battle',
  hasMap: !!document.querySelector('.dmap'),
  pauseBtn: !!document.querySelector('[data-action="pause"]'),
  backBtn: !!document.querySelector('[data-action="back-hall"]'),
  run: JSON.parse(localStorage.getItem('ruin-spire/hall') || '{}').run,
})));

// 暂停回大厅
const pause = page.locator('[data-action="pause"]').first();
if (await pause.count()) {
  await pause.click();
  await page.waitForTimeout(400);
}
await page.screenshot({ path: `${OUT}-3-after-pause.png` });
console.log('暂停后:', await page.evaluate(() => ({
  screen: document.querySelector('.hall-title')?.textContent,
  resumeRow: document.querySelector('[data-action="resume"]')?.innerText.replace(/\s+/g, ' ').trim(),
  flash: document.querySelector('.flash')?.textContent,
})));

// 再进冒险页：另一个人还能不能出发？
await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}-4-expedition-again.png` });
console.log('二次冒险页:', await page.evaluate(() => ({
  note: document.querySelector('.ex-note')?.textContent,
  cards: [...document.querySelectorAll('.ex-card')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
  startBtns: [...document.querySelectorAll('[data-action="explore"]')].map((b) => b.dataset.id),
})));

await browser.close();
