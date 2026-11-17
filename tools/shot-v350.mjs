/**
 * v3.50 探针：法师「法术循环」回能必须可见。
 * 现象（用户）：0 费牌打完能量 +1、1 费不消耗、2 费只扣 1
 *   —— 其实是每 2 张牌回 1 点，恰好落在他打的那几张上。
 * 断言：第 2 张出牌后出现「法术循环 +1 能量」飘字；记录里带「能量 +1」。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4187/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();

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
  const ch = roster.createCharacter({ classId: 'mage', raceId: 'stone', seed: 5 });
  ch.veteran = false; ch.status = 'idle'; ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);
  const run = runMod.createRun({ character: ch, seed: 42 });
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
await page.waitForTimeout(250);

const orb = () => page.evaluate(() => document.querySelector('.energy-orb')?.textContent?.trim());
const floats = () => page.evaluate(() => [...document.querySelectorAll('.float')].map((e) => e.textContent.trim()));

console.log('回合初能量', await orb());
for (let n = 1; n <= 2; n++) {
  const before = await orb();
  await page.evaluate(() => {
    const c = [...document.querySelectorAll('.hand .card')].find((x) => !x.className.includes('disabled'));
    c?.click();
  });
  await page.waitForTimeout(620);
  const f = await floats();
  console.log(`第 ${n} 张：${before} -> ${await orb()}　飘字 ${JSON.stringify(f)}`);
  if (f.some((t) => t.includes('法术循环'))) {
    await page.screenshot({ path: 'tools/shots/v350-loop.png' });
  }
}

// 记录里也要留痕
await page.locator('[data-action="open-log"]').first().click();
await page.waitForTimeout(320);
const rows = await page.evaluate(() => [...document.querySelectorAll('.log-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
console.log('记录:', JSON.stringify(rows.slice(0, 4)));
console.log(rows.some((r) => r.includes('能量 +1')) ? 'OK  记录含回能明细' : 'ERR 记录缺回能明细');
await page.screenshot({ path: 'tools/shots/v350-log.png' });

await browser.close();
console.log('probe ok');
