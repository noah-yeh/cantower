/**
 * v3.49 浮层探针：战斗记录 / 敌人牌库改成「蒙板 + 居中卡片」，不再挤下方。
 *
 * 断言：
 *  1. overlay 是 position:fixed 且铺满视口（top 0 / 高=视口高）；
 *  2. 卡片在视口内居中；
 *  3. 打开浮层前后 `.tray` 位置不变（不再顶牌区）；
 *  4. 点卡片不关闭、点蒙板关闭。
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
await page.waitForTimeout(700);

const baseTray = await page.evaluate(() => Math.round(document.querySelector('.tray').getBoundingClientRect().top));
const ok = (v) => (v ? 'OK ' : 'ERR');

async function probe(label, openFn, shot) {
  await openFn();
  await page.waitForTimeout(320);
  const m = await page.evaluate(() => {
    const o = document.querySelector('.log-overlay');
    if (!o) return null;
    const s = document.querySelector('.log-sheet');
    const ob = o.getBoundingClientRect();
    const sb = s.getBoundingClientRect();
    return {
      pos: getComputedStyle(o).position,
      z: getComputedStyle(o).zIndex,
      overlay: { top: Math.round(ob.top), bottom: Math.round(ob.bottom), w: Math.round(ob.width) },
      sheet: { top: Math.round(sb.top), bottom: Math.round(sb.bottom), h: Math.round(sb.height), cx: Math.round((sb.left + sb.right) / 2) },
      tray: Math.round(document.querySelector('.tray').getBoundingClientRect().top),
      vw: innerWidth, vh: innerHeight,
    };
  });
  console.log(`\n== ${label} ==`);
  console.log(JSON.stringify(m));
  console.log(ok(m && m.pos === 'fixed'), `蒙板 fixed（实际 ${m?.pos}）`);
  console.log(ok(m && m.overlay.top === 0 && m.overlay.bottom === m.vh), `蒙板铺满视口 ${m?.overlay.top}~${m?.overlay.bottom} / vh ${m?.vh}`);
  console.log(ok(m && m.sheet.top > 0 && m.sheet.bottom < m.vh), `卡片完整在视口内 ${m?.sheet.top}~${m?.sheet.bottom}`);
  console.log(ok(m && Math.abs(m.sheet.cx - m.vw / 2) <= 2), `卡片水平居中 cx ${m?.sheet.cx} / ${m?.vw / 2}`);
  console.log(ok(m && m.tray === baseTray), `牌区没被挤：tray ${baseTray} -> ${m?.tray}`);
  if (shot) await page.screenshot({ path: shot });

  // 点卡片不关闭
  await page.mouse.click(m.vw / 2, m.sheet.top + 20);
  await page.waitForTimeout(200);
  const stillOpen = await page.evaluate(() => !!document.querySelector('.log-overlay'));
  console.log(ok(stillOpen), '点卡片不关闭');
  // 点蒙板关闭
  await page.mouse.click(6, 6);
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => !document.querySelector('.log-overlay'));
  console.log(ok(closed), '点蒙板关闭');
}

await probe('战斗记录', () => page.locator('[data-action="open-log"]').first().click(), 'tools/shots/v349-log.png');
await probe('敌人牌库', () => page.locator('.enemy-zone .face-btn').click(), 'tools/shots/v349-foe.png');

await browser.close();
console.log('\nprobe ok');
