import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4185/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 640 } })).newPage();
page.on('pageerror', (e) => console.log('PAGE-ERR:', e.message.slice(0, 200)));

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
console.log('in battle:', await page.locator('.hand .card').count());

// 点「属性」
const statsBtn = page.locator('[data-action="open-run-stats"]');
console.log('属性按钮可见:', await statsBtn.isVisible(), await statsBtn.boundingBox());
await statsBtn.click();
await page.waitForTimeout(300);
console.log('点属性后 .stats-panel:', await page.locator('.stats-panel').count(),
  '| box:', await page.locator('.stats-panel').first().boundingBox(),
  '| 文本:', (await page.locator('.stats-panel').first().innerText().catch(() => '无')).replace(/\s+/g, ' ').slice(0, 80));

// 关掉
await page.evaluate(() => document.querySelector('.sp-close')?.click());
await page.waitForTimeout(200);

// 点「记录」
const logBtn = page.locator('[data-action="open-log"]');
console.log('记录按钮可见:', await logBtn.isVisible(), await logBtn.boundingBox());
await logBtn.click();
await page.waitForTimeout(300);
console.log('点记录后 .log-overlay:', await page.locator('.log-overlay').count(),
  '| box:', await page.locator('.log-overlay').first().boundingBox(),
  '| 文本:', (await page.locator('.log-overlay').first().innerText().catch(() => '无')).replace(/\s+/g, ' ').slice(0, 120));

await browser.close();
