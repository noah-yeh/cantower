import { chromium } from 'playwright-core';
const URL = 'http://127.0.0.1:4182/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2 })).newPage();
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
await page.locator('.hp-tab[data-tab="relic"]').click();
await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  const box = document.querySelector('.hp-box');
  const cs = getComputedStyle(box);
  const overlay = getComputedStyle(document.querySelector('.hero-page'));
  const kids = [...box.querySelectorAll('.hp-body *')].slice(0, 40).map((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { cls: el.className?.toString().slice(0, 40), w: Math.round(r.width), disp: s.display, ws: s.width };
  }).filter((k) => k.w > 340);
  return {
    boxW: cs.width, boxMaxW: cs.maxWidth, boxAlign: cs.alignSelf, boxMM: cs.margin,
    ovAlign: overlay.alignItems, ovDisp: overlay.display,
    kids,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
