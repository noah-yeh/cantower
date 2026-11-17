import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4185/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });

async function seed(page) {
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
    const ch = roster.createCharacter({ classId: 'hunter', raceId: 'stone', seed: 5 });
    ch.veteran = false; ch.status = 'idle'; ch.lives = 3;
    m.roster = [ch];
    save.saveMeta(m);
    const run = runMod.createRun({ character: ch, seed: 42 });
    run.relics = ['boneCharm', 'quiver'];
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
    if (await page.locator('.hand .card').count()) return true;
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
  return (await page.locator('.hand .card').count()) > 0;
}

for (const [w, h] of [[360, 640], [390, 640]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  const ok = await seed(page);
  if (!ok) { console.log(w, '没进战斗'); await page.close(); continue; }
  const info = await page.evaluate(() => {
    const tb = document.querySelector('.topbar');
    const r = tb.getBoundingClientRect();
    const items = [...tb.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().width > 0)
      .map((e) => {
        const b = e.getBoundingClientRect();
        return { tag: e.tagName.toLowerCase(), cls: e.className.toString().slice(0, 20), txt: e.textContent.trim().slice(0, 8), left: Math.round(b.left), right: Math.round(b.right) };
      });
    return {
      vw: innerWidth,
      tbW: Math.round(r.width),
      tbScrollW: tb.scrollWidth,
      over: tb.scrollWidth - tb.clientWidth,
      items,
    };
  });
  console.log(w + 'px:', JSON.stringify(info, null, 0));
  await page.close();
}
await browser.close();
