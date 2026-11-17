import { chromium } from 'playwright-core';
const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const m = meta.createMeta(7);
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  a.status = 'exploring';
  m.roster = [a];
  const run = runMod.createRun({ character: a, seed: 5 });
  run.deck = ['w_chop', 'w_chop+1', 'guard', 'guard', 'brace', 'brace'];
  run.phase = 'map';
  save.saveRun(run);
  m.run = { characterId: a.id, floor: 1 };
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(450);
await page.locator('[data-action="maze-guide-ok"]').first().click().catch(() => {});
await page.waitForTimeout(200);
await page.locator('[data-action="open-hero"]').first().click();
await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  const btn = document.querySelector('.hp-forge-btn');
  const cards = [...document.querySelectorAll('.hp-deck-cards .hp-card .cname')].map((n) => n.textContent.replace(/\s+/g, ' ').trim());
  return { btn: btn?.textContent.replace(/\s+/g, '').trim(), off: btn?.classList.contains('off'), cards };
});
console.log('牌库:', JSON.stringify(info));
if (info.btn && !info.off) {
  await page.locator('.hp-forge-btn').click();
  await page.waitForTimeout(350);
  const list = await page.evaluate(() => [...document.querySelectorAll('.hp-forge-item')].map((it) => ({
    name: it.querySelector('.cname')?.textContent.replace(/\s+/g, ' ').trim(),
    sub: it.querySelector('.hp-forge-item-sub')?.textContent.trim(),
    key: it.dataset.key,
  })));
  console.log('可合成列表:', JSON.stringify(list));
  await page.screenshot({ path: 'tools/probe/check-forge.png' });
}
await browser.close();
