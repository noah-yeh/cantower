import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = meta.createMeta(20261116);
  m.gold = 4800; m.crystal = 260; m.recruits = 5;
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 11 });
  const b = roster.createCharacter({ classId: 'mage', raceId: 'ember', seed: 22 });
  a.veteran = true; a.name = '磐石·戈尔姆';
  b.veteran = true; b.name = '烬羽·薇拉';
  m.roster = [a, b];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('[data-action="open-roster"]').first().click();
await page.waitForTimeout(500);
console.log('roster screen:', await page.evaluate(() => document.body.dataset.screen));
console.log(await page.evaluate(() => ({
  screen: document.body.dataset.screen,
  actions: [...document.querySelectorAll('[data-action]')].map(e => e.dataset.action).slice(0, 30),
  gold: document.querySelector('.hall-top')?.textContent.slice(0, 80),
})));
await browser.close();
