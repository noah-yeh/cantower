/**
 * 商店实机截图（TapTap 物料）。
 *
 * 播种一个观感良好的存档 → 依次进入 6 个界面 → 1080×1920 JPEG。
 * 用 540×960 视口 + deviceScaleFactor 2，字体渲染和真机一致。
 *
 *   node tools/store-shots.mjs
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'store', 'shots');
mkdirSync(OUT, { recursive: true });

const URL = 'http://127.0.0.1:4182/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const ctx = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
  recordVideo: undefined,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const sleep = (ms) => page.waitForTimeout(ms);

/** 播种：两个像样的转正角色 + 一枚实习生，金币水晶拉满 */
async function seed() {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(300);
  await page.evaluate(async () => {
    const meta = await import('/src/core/meta.js');
    const roster = await import('/src/core/roster.js');
    const save = await import('/src/core/save.js');
    const m = meta.createMeta(20261116);
    m.gold = 4800; m.crystal = 260; m.recruits = 5;
    const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 11 });
    const b = roster.createCharacter({ classId: 'mage', raceId: 'ember', seed: 22 });
    a.veteran = true; a.name = '磐石·戈尔姆';
    b.veteran = true; b.name = '烬羽·薇拉';
    a.record = { exploreCount: 3, bestFloor: 17 };
    b.record = { exploreCount: 2, bestFloor: 12 };
    for (const ch of [a, b]) {
      ch.level = 8; ch.exp = 0; ch.maxHp += 30; ch.atk += 6;
      ch.talents = { list: ['blade', 'ironbody'], openKey: null };
    }
    m.roster = [a, b];
    save.saveMeta(m);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(500);
}

const shot = (name) => page.screenshot({
  path: resolve(OUT, `${name}.jpg`), type: 'jpeg', quality: 90,
});

/* ---------------------------------------------------------------- 大厅 */
await seed();
await shot('01-大厅');
console.log('01-大厅 ok');

/* ---------------------------------------------------------------- 角色详情 */
await page.locator('[data-action="open-roster"]').first().click();
await sleep(600);
/* 默认停在「实习」页签，两个种子角色都是转正 —— 先切过去再点卡 */
const hasCard = await page.evaluate(() => !!document.querySelector('[data-action="open-char"]'));
if (!hasCard) {
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('[data-action="roster-tab"]')]
      .find((b) => b.textContent.includes('转正') || b.textContent.includes('正式'));
    (t || document.querySelectorAll('[data-action="roster-tab"]')[1])?.click();
  });
  await sleep(400);
}
await page.locator('[data-action="open-char"]').first().click();
await sleep(700);
await shot('02-角色详情');
console.log('02-角色详情 ok');
await page.locator('.hero-page [data-action="close-hero-page"]').last().click();
await sleep(400);

/* ---------------------------------------------------------------- 开局进塔 */
await page.evaluate(async () => {
  const roster = await import('/src/core/roster.js');
  const runMod = await import('/src/core/run.js');
  const dungeon = await import('/src/core/dungeon.js');
  const save = await import('/src/core/save.js');
  const m = save.loadMeta();
  const a = m.roster[0];
  a.status = 'exploring';
  const run = runMod.createRun({ character: a, seed: 777 });
  run.floor = 3;
  run.gold = 320;
  run.materials = 8;
  run.deck = ['jab', 'jab+1', 'brace', 'guard+1', 'heavy', 'smoke', 't_fungus', 'h_quickdraw', 'bomb', 'w_chop+1'];
  dungeon.makeFloorMap(run);
  /* 入口固定左下角 (2,0)=idx6，邻居是 idx3(正上) 与 idx7(正右)。
   * 把邻居改成行商 / 委托板并直接置 revealed —— 一点就触发，不赌随机地图。 */
  const cells = run.floorMap.cells;
  cells[3] = { kind: 'shop', revealed: true, done: false, data: null };
  /* herald 是「事件」的一种：kind 是 event，事件 id 放在 data.event */
  cells[7] = { kind: 'event', revealed: true, done: false, data: { event: 'herald' } };
  /* 已刷出的敌格直接 revealed，避免"够不着" */
  const enemyIdx = cells.findIndex((c) => c.kind === 'enemy' || c.kind === 'elite');
  if (enemyIdx >= 0) cells[enemyIdx].revealed = true;
  save.saveRun(run);
  m.run = { characterId: a.id, floor: run.floor };
  save.saveMeta(m);
});
console.log('seeded map');

await page.reload({ waitUntil: 'networkidle' });
await sleep(400);
/* 有进行中的 run 时重载直接落在迷宫页，只需关掉引导弹窗 */
await page.locator('[data-action="maze-guide-ok"]').first().click().catch(() => {});
await sleep(300);

/* ---------------------------------------------------------------- 迷宫 */
await shot('03-迷宫');
console.log('03-迷宫 ok');

/* ---------------------------------------------------------------- 委托板 */
await page.evaluate(() => document.querySelectorAll('.dcell')[7]?.click());
await sleep(450);
await page.evaluate(() => document.querySelectorAll('.dcell')[7]?.click());
await sleep(900);
console.log('after herald:', await page.evaluate(() =>
  [...document.querySelectorAll('[data-action]')].map((e) => e.dataset.action).filter((a) => a.includes('quest')).join(',') || '(无 quest 动作)'));
if (await page.evaluate(() => !!document.querySelector('[data-action="quest-decline"], [class*="quest"]'))) {
  await shot('06-委托板');
  console.log('06-委托板 ok');
  await page.evaluate(() => document.querySelector('[data-action="quest-decline"]')?.click());
  await sleep(400);
} else console.log('!! 委托板没触发');

/* ---------------------------------------------------------------- 行商 */
await page.evaluate(() => document.querySelectorAll('.dcell')[3]?.click());
await sleep(900);
if (await page.evaluate(() => !!document.querySelector('[data-action="buy-card"], [data-action="shop-refresh"]'))) {
  await shot('05-行商');
  console.log('05-行商 ok');
  await page.evaluate(() => document.querySelector('[data-action="leave-shop"]')?.click());
  await sleep(500);
  console.log('back on map:', await page.evaluate(() => !!document.querySelector('.dcell')));
} else console.log('!! 行商没触发');

/* ---------------------------------------------------------------- 战斗 */
/* 敌格 idx 在播种时记不下 —— 重读存档 */
const enemyIdx = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return run.floorMap.cells.findIndex((c) => (c.kind === 'enemy' || c.kind === 'elite') && !c.done);
});
console.log('enemyIdx =', enemyIdx);
await page.evaluate((i) => document.querySelectorAll('.dcell')[i]?.click(), enemyIdx);
await sleep(450);
await page.evaluate((i) => document.querySelectorAll('.dcell')[i]?.click(), enemyIdx);
await sleep(1500);
console.log('actions now:', await page.evaluate(() => [...document.querySelectorAll('[data-action]')].map((e) => e.dataset.action).slice(0, 25).join(',')));
const inBattle = await page.evaluate(() => !!document.querySelector('.hand'));
if (inBattle) {
  /* 打一张牌让画面有内容 */
  await page.evaluate(() => document.querySelectorAll('.hand .card')[0]?.click());
  await sleep(700);
  await shot('04-战斗');
  console.log('04-战斗 ok');
} else console.log('!! 战斗没进');

await browser.close();
console.log('DONE');
