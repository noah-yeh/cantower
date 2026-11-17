/** v3.44 截图：战场信息行 / 敌人浮层 / 英雄面板 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4185/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 600 }, deviceScaleFactor: 2 })).newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(350);
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const enemies = await import('/src/core/enemies.js');
  const rngMod = await import('/src/core/rng.js');
  const m = meta.createMeta(20261109);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.veteran = false; ch.status = 'idle'; ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);
  const run = runMod.createRun({ character: ch, seed: 42 });
  run.relics = ['boneCharm', 'quiver', 'ironBracer+3'];
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[idx] = {
    kind: 'enemy', revealed: true, done: false,
    data: { tier: 'normal', enemy: enemies.makeEnemy(run.floor, new rngMod.Rng(7), 'normal') },
  };
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(450);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);
for (let step = 0; step < 40; step++) {
  if (await page.locator('.hand .card').count()) break;
  const t = await page.evaluate(() => {
    if (document.querySelector('.dcell.pending.k-enemy')) return 'enemy';
    if (document.querySelector('.dcell.pending')) return 'pending';
    if (document.querySelector('.dcell.reach')) return 'reach';
    return null;
  });
  if (!t) break;
  await page.evaluate((k) => {
    const el = k === 'enemy' ? document.querySelector('.dcell.pending.k-enemy')
      : k === 'pending' ? document.querySelector('.dcell.pending')
        : document.querySelector('.dcell.reach');
    el?.click();
  }, t);
  await page.waitForTimeout(300);
}
await page.evaluate(() => {
  const card = [...document.querySelectorAll('.hand .card')].find((c) => !c.className.includes('disabled'));
  card?.click();
});
await page.waitForTimeout(800);
await page.screenshot({ path: 'tools/shots/v344-battle.png' });

/* 敌人浮层 */
await page.locator('.enemy-zone .face-btn').click();
await page.waitForTimeout(350);
await page.screenshot({ path: 'tools/shots/v344-foe.png' });
await page.evaluate(() => document.querySelector('[data-action="close-foe-deck"]')?.click());
await page.waitForTimeout(200);

/* 英雄面板 */
await page.locator('.player-zone .face-btn').click();
await page.waitForTimeout(350);
await page.screenshot({ path: 'tools/shots/v344-hero.png' });

await browser.close();
console.log('shots ok');
