import { chromium } from 'playwright-core';
const URL = 'http://127.0.0.1:4182/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = meta.createMeta(20261111);
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  a.status = 'idle'; a.relics = ['anvil']; a.relicSlots = ['m_pastloop', 't_shell'];
  m.roster = [a]; save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(350);
await page.locator('.ex-card').first().click();
await page.waitForTimeout(450);

const snap = (tag) => page.evaluate((t) => {
  const doc = document.documentElement;
  const box = document.querySelector('.hp-box')?.getBoundingClientRect();
  const por = document.querySelector('.hp-portrait')?.getBoundingClientRect();
  const name = document.querySelector('.hp-name');
  const overlay = document.querySelector('.hero-page')?.getBoundingClientRect();
  return {
    tag: t,
    docScrollH: doc.scrollHeight, winH: innerHeight, docScrollW: doc.scrollWidth,
    bodyScrollH: document.body.scrollHeight,
    overlay: overlay ? { w: Math.round(overlay.width), h: Math.round(overlay.height), top: Math.round(overlay.top) } : null,
    box: box ? { w: Math.round(box.width), h: Math.round(box.height), top: Math.round(box.top) } : null,
    portraitH: por ? Math.round(por.height) : null,
    nameFont: name ? getComputedStyle(name).fontSize : null,
  };
}, tag);
console.log(JSON.stringify(await snap('deck(初始)'), null, 1));
await page.locator('.hp-tab[data-tab="relic"]').click();
await page.waitForTimeout(400);
console.log(JSON.stringify(await snap('relic'), null, 1));
await page.locator('.hp-tab[data-tab="deck"]').click();
await page.waitForTimeout(400);
console.log(JSON.stringify(await snap('deck(切回)'), null, 1));
await browser.close();
