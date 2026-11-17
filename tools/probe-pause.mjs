/**
 * 临时探针：验证「暂停 · 回大厅」——不扣命、进度保留、刷新后仍在大厅、继续探险回原屏。
 * 用法：node tools/probe-pause.mjs
 */
import { chromium } from 'playwright-core';

const OUT = 'tools/.probe-pause';
const URL = 'http://127.0.0.1:4182/';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

for (let i = 0; i < 2; i++) {
  const btn = page.locator('[data-action="recruit"]').first();
  if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(300); }
}

const exp = page.locator('[data-action="explore"]').first();
await exp.click();
await page.waitForTimeout(400);

// 停在地图页就够了（迷宫页底部就有暂停条）
const pause = page.locator('[data-action="pause"]').first();
console.log('地图页暂停按钮:', await pause.count(), await pause.innerText().catch(() => ''));
const livesBefore = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('ruin-spire/hall') || '{}');
  return m.roster?.map((c) => ({ name: c.name, lives: c.lives, status: c.status }));
});
await page.screenshot({ path: `${OUT}-1-dungeon.png` });

await pause.click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}-2-hall.png` });
console.log('暂停后屏:', await page.evaluate(() => document.querySelector('.hall-title')?.textContent || document.querySelector('.topbar')?.textContent.trim().slice(0, 40)));

const info = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('ruin-spire/hall') || '{}');
  return {
    metaRun: m.run,
    roster: m.roster?.map((c) => ({ name: c.name, lives: c.lives, status: c.status })),
    runSaved: !!localStorage.getItem('ruin-spire/run'),
    pausedTag: document.querySelector('.paused-tag')?.textContent,
    flash: document.querySelector('.flash')?.textContent,
    resumeBtn: document.querySelector('[data-action="resume"]') ? '有' : '无',
  };
});
console.log('暂停后:', JSON.stringify(info));

// 刷新：应该还停在大厅，而不是被拽回塔里
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}-3-reload.png` });
console.log('刷新后:', await page.evaluate(() => ({
  hall: !!document.querySelector('.hall-title'),
  dungeon: !!document.querySelector('.dmap'),
  battle: !!document.querySelector('.hand'),
  pausedTag: document.querySelector('.paused-tag')?.textContent,
})));

// 继续探险 → 回到地图
const resume = page.locator('[data-action="resume"]').first();
await resume.click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}-4-resume.png` });
console.log('继续探险后:', await page.evaluate(() => ({
  dungeon: !!document.querySelector('.dmap'),
  battle: !!document.querySelector('.hand'),
  paused: JSON.parse(localStorage.getItem('ruin-spire/hall') || '{}').run?.paused ?? null,
  lives: JSON.parse(localStorage.getItem('ruin-spire/hall') || '{}').roster?.map((c) => c.lives),
})));

await browser.close();
