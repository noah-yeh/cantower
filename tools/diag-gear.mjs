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
  const eq = await import('/src/core/equipment.js');
  const m = meta.createMeta(20261111);
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  a.status = 'idle'; a.veteran = true; a.arenaLeft = 3;
  m.roster = [a];
  const x = eq.addEquipment(m, 'ironSword');
  const y = eq.addEquipment(m, 'leatherArmor');
  const z = eq.addEquipment(m, 'woodShield');
  eq.equipItem(m, a.id, x.id);
  eq.equipItem(m, a.id, y.id);
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="open-arena"]').first().click();
await page.waitForTimeout(350);
await page.locator('.ex-card').first().click();
await page.waitForTimeout(400);
await page.locator('.hero-page .hp-tab[data-tab="gear"]').click();
await page.waitForTimeout(400);
const geo = await page.evaluate(() => {
  const btn = document.querySelector('.hero-page [data-action="equip-item"]');
  if (!btn) return { none: true };
  const r = btn.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const at = document.elementFromPoint(cx, cy);
  return {
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    center: { cx: Math.round(cx), cy: Math.round(cy) },
    atPoint: at ? `${at.className?.toString?.().slice(0, 50)}|${at.tagName}` : null,
    btnText: btn.textContent.trim(),
    rowRect: (() => { const rr = btn.closest('.eq-row').getBoundingClientRect(); return { y: Math.round(rr.y), h: Math.round(rr.height) }; })(),
    bodyScroll: document.querySelector('.hp-body').scrollTop,
  };
});
console.log(JSON.stringify(geo, null, 1));
await page.screenshot({ path: 'tools/probe/diag-gear.png' });
await browser.close();
