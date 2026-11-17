import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4185/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });

async function enterBattle(page) {
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
    const m = meta.createMeta(20261108);
    const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
    ch.veteran = false; ch.status = 'idle'; ch.lives = 3;
    m.roster = [ch];
    save.saveMeta(m);
    const run = runMod.createRun({ character: ch, seed: 42 });
    run.relics = ['boneCharm', 'quiver', 'ironBracer+3', 'cloverCharm'];
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
    if (await page.locator('.hand .card').count()) return;
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
}

for (const [w, h, name] of [[390, 640, 'v342-battle-640'], [390, 560, 'v342-battle-560']]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })).newPage();
  await enterBattle(page);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.hand .card')].find((x) => !x.className.includes('disabled'));
    c?.click();
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `tools/shots/${name}.png` });
  await page.close();
}

/** 牌库面板 + 属性面板 */
const page = await (await browser.newContext({ viewport: { width: 390, height: 640 }, deviceScaleFactor: 2 })).newPage();
await enterBattle(page);
await page.locator('[data-action="open-foe-deck"]').click();
await page.waitForTimeout(350);
await page.screenshot({ path: 'tools/shots/v342-foedeck.png' });
await page.evaluate(() => document.querySelector('[data-action="close-foe-deck"]')?.click());
await page.waitForTimeout(200);
await page.locator('[data-action="open-run-stats"]').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'tools/shots/v342-stats.png' });
await page.close();
await browser.close();
console.log('shots ok');
