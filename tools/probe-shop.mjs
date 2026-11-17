/**
 * 探针 v3.34：行商/祭坛「离开可重进」+ 左上角小按钮
 *
 * 要证的四件事：
 *   1. 行商店里只有左上角「离开」小按钮，没有暂停按钮，也不再有两行通栏
 *   2. 离开 → 重进同一格：货架、卖出记录、刷新次数、金币原样
 *   3. 祭坛「返回」回地图后顶栏出现「↑ 祭坛」入口，重进候选不变
 *   4. 控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4183/';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

/** 造一个可探险的转正角色，并直接铺一层必有行商的地图 */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const dungeon = await import('/src/core/dungeon.js');
  const m = meta.createMeta(20261107);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.veteran = true;
  ch.status = 'idle';
  ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);

  /** 起一局并手工把一个格子改成行商，挂成"已暂停"以便续档 */
  const run = runMod.createRun({ character: ch, seed: 42 });
  run.gold = 500;
  const shopIdx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[shopIdx] = { kind: 'shop', revealed: true, done: false, data: null };
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

/** 大厅 → 继续探险 → 地图 */
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);
// 找行商格（两段式：第一下翻、第二下进；已 revealed 就直接触发）
const shopIdx = await page.evaluate(() => {
  const st = window.__rsState?.();
  return st ? st : null;
}).catch(() => null);

// 直接用状态拿格号更稳：从 localStorage 的 run 里找 shop 格
const cellIdx = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return run.floorMap.cells.findIndex((c) => c.kind === 'shop');
});
console.log('行商格:', cellIdx);

await page.evaluate((i) => document.querySelector(`[data-action="cell"][data-index="${i}"]`)?.click(), cellIdx);
await page.waitForTimeout(250);
await page.evaluate((i) => document.querySelector(`[data-action="cell"][data-index="${i}"]`)?.click(), cellIdx);
await page.waitForTimeout(400);

const shopUi = await page.evaluate(() => ({
  screen: document.querySelector('.overlay') ? 'shop' : 'other',
  backBtn: document.querySelector('.back-btn')?.textContent?.trim(),
  backPos: (() => {
    const b = document.querySelector('.back-btn');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })(),
  pauseBtn: !!document.querySelector('[data-action="pause"]'),
  wideLeave: !!document.querySelector('[data-action="leave-shop"].wide'),
  firstCardName: document.querySelector('.shop-item .rname')?.textContent?.trim(),
  gold: document.querySelector('.chip.gold b')?.textContent?.trim(),
}));
console.log('商店页:', JSON.stringify(shopUi));

/** 买第一件 + 刷新一次，制造"有状态"的货架 */
await page.locator('[data-action="buy-card"]').first().click();
await page.waitForTimeout(250);
await page.locator('[data-action="refresh-shop"]').first().click();
await page.waitForTimeout(250);

const before = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return { gold: run.gold, refreshes: run.shop?.refreshes ?? 0, deck: run.deck.length };
});

/** 离开 → 回地图 → 重进 */
await page.locator('[data-action="leave-shop"]').click();
await page.waitForTimeout(300);
const backOnMap = await page.evaluate(() => ({
  altarBtnWhenNoAltar: !!document.querySelector('[data-action="open-altar"]'),
  onMap: !!document.querySelector('.dmap'),
}));
console.log('离开后:', JSON.stringify(backOnMap));

await page.evaluate((i) => document.querySelector(`[data-action="cell"][data-index="${i}"]`)?.click(), cellIdx);
await page.waitForTimeout(400);

const after = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return {
    gold: run.gold,
    refreshes: run.shop?.refreshes ?? 0,
    deck: run.deck.length,
    firstCardSold: run.shop?.cards?.some((c) => c.sold) ?? null,
  };
});
console.log('重进后:', JSON.stringify(after));
console.log('状态保持:', before.gold === after.gold && before.refreshes === after.refreshes && before.deck === after.deck ? '✓' : '✗ 不一致!');

/** ---------------- 祭坛 ---------------- */
await page.locator('[data-action="leave-shop"]').click();
await page.waitForTimeout(250);

// 直接造一个待选祭坛：进祭坛再返回，验证入口与状态
await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const run = save.loadRun();
  runMod.enterUpgradeAltar(run);
  runMod.cancelUpgrade(run); // 玩家在祭坛里点了「返回」
  save.saveRun(run);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 「继续探险」只在暂停时出现；重载后也可能直接落在地图上，二者取其一
const needResume = await page.evaluate(() => !document.querySelector('.dmap'));
if (needResume) {
  await page.locator('[data-action="resume"]').first().click();
  await page.waitForTimeout(400);
}
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);

const altarEntry = await page.evaluate(() => ({
  altarBtn: document.querySelector('[data-action="open-altar"]')?.textContent?.trim() ?? null,
}));
console.log('顶栏祭坛入口:', JSON.stringify(altarEntry));

await page.locator('[data-action="open-altar"]').first().click();
await page.waitForTimeout(350);
const altarUi = await page.evaluate(() => ({
  backBtn: document.querySelector('.back-btn')?.textContent?.trim(),
  pause: !!document.querySelector('[data-action="pause"]'),
  targets: document.querySelectorAll('[data-action="pick-upgrade"]').length,
}));
console.log('祭坛页:', JSON.stringify(altarUi));

await page.locator('.back-btn').click();
await page.waitForTimeout(300);
const backAgain = await page.evaluate(() => ({
  onMap: !!document.querySelector('.dmap'),
  altarStill: !!document.querySelector('[data-action="open-altar"]'),
}));
console.log('返回后:', JSON.stringify(backAgain));

await page.locator('[data-action="open-altar"]').first().click();
await page.waitForTimeout(300);
const targetsAgain = await page.evaluate(() => document.querySelectorAll('[data-action="pick-upgrade"]').length);
console.log('重进祭坛候选数:', targetsAgain, targetsAgain === altarUi.targets ? '✓' : '✗');

console.log('页面错误:', errs.length ? errs : '无');
await browser.close();
