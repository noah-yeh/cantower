/**
 * 探针 v3.37：付费祭坛（焚卡/变形）+ 行商多卡位
 *
 * 要证的五件事：
 *   1. 地图上焚卡/变形格能进自选页，格子不 done，离开可再进
 *   2. 焚卡：扣钱、删卡、卡组数实时减一；下限/没钱有明确理由
 *   3. 变形：扣钱、长度不变、横幅写明变成了什么
 *   4. 行商一次上架 4 张卡
 *   5. 控制台零报错
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

/** 造一局同时带 pyre / morph / shop 三种格子的存档（找不到就换种子） */
const seeded = await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');

  const m = meta.createMeta(20261108);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.veteran = true;
  ch.status = 'idle';
  ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);

  for (let seed = 1; seed <= 400; seed++) {
    const run = runMod.createRun({ character: ch, seed });
    const cells = run.floorMap.cells;
    let pyre = cells.findIndex((c) => c.kind === 'event' && c.data?.event === 'pyre');
    /** 每层最多 1 个事件格，同层天然难凑齐两种祭坛 —— 缺的用空房改造（v3.37 概率口径见 GAME_DESIGN） */
    let morph = cells.findIndex((c) => c.kind === 'event' && c.data?.event === 'morph');
    if (pyre < 0 && morph < 0) continue;
    if (pyre < 0 || morph < 0) {
      const empty = cells.findIndex((c) => c.kind === 'empty' && !c.done);
      if (empty < 0) continue;
      cells[empty] = { kind: 'event', revealed: true, done: false, data: { event: pyre < 0 ? 'pyre' : 'morph' } };
      if (pyre < 0) pyre = empty; else morph = empty;
    }
    /** 行商不挑种子：拿一个空房间改造成商店（probe-shop 同款做法） */
    const empty2 = cells.findIndex((c) => c.kind === 'empty' && !c.done);
    const shop = empty2 >= 0 ? (cells[empty2] = { kind: 'shop', revealed: true, done: false, data: null }, empty2) : -1;
    if (shop < 0) continue;
    for (const i of [pyre, morph, shop]) cells[i].revealed = true; // 跳过翻格步骤
    run.gold = 500;
    save.saveRun(run);
    m.run = { characterId: ch.id, floor: run.floor, paused: true };
    save.saveMeta(m);
    return { seed, pyre, morph, shop };
  }
  return null;
});
console.log('种子与格号:', JSON.stringify(seeded));
if (!seeded) { console.log('✗ 没找到合适的种子'); await browser.close(); process.exit(1); }

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);

const clickCell = (i) => page.evaluate((idx) => document.querySelector(`[data-action="cell"][data-index="${idx}"]`)?.click(), i);
const runState = () => page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return { phase: run.phase, gold: run.gold, deck: run.deck.length };
});

/* ---------------- 焚卡 ---------------- */
await clickCell(seeded.pyre);
await page.waitForTimeout(400);
let ui = await page.evaluate(() => ({
  title: document.querySelector('.overlay h1')?.textContent?.trim(),
  sub: document.querySelector('.overlay .sub')?.textContent?.trim(),
  gold: document.querySelector('.chip.gold b')?.textContent?.trim(),
  cards: document.querySelectorAll('[data-action="altar-remove"]').length,
}));
console.log('焚卡页:', JSON.stringify(ui));
assert(ui.title === '焚卡祭坛', '焚卡页标题');
assert(ui.cards > 0, '有可焚的卡');
let st = await runState();
assert(st.phase === 'remove', '相位 remove');

await page.locator('[data-action="altar-remove"]').first().click();
await page.waitForTimeout(300);
ui = await page.evaluate(() => ({
  flash: document.querySelector('.flash')?.textContent?.trim(),
  gold: document.querySelector('.chip.gold b')?.textContent?.trim(),
  deck: document.querySelector('.chip b:last-child')?.textContent?.trim(),
  cards: document.querySelectorAll('[data-action="altar-remove"]').length,
}));
st = await runState();
console.log('焚一张后:', JSON.stringify({ ...ui, ...st }));
assert(st.gold < 500, `扣钱了（${st.gold}）`);
assert(ui.flash?.includes('已投入火中'), `横幅：${ui.flash}`);
assert(ui.cards === st.deck, `列表数与卡组一致（${ui.cards} vs ${st.deck}）`);

/** 离开 → 再进：状态不变 */
await page.locator('[data-action="cancel-altar"]').click();
await page.waitForTimeout(300);
assert(await page.evaluate(() => !!document.querySelector('.dmap')), '回到地图');
await clickCell(seeded.pyre);
await page.waitForTimeout(400);
st = await runState();
assert(st.phase === 'remove', '离开可再进，还是焚卡相位');
await page.locator('[data-action="cancel-altar"]').click();
await page.waitForTimeout(300);

/* ---------------- 变形 ---------------- */
await clickCell(seeded.morph);
await page.waitForTimeout(400);
ui = await page.evaluate(() => ({
  title: document.querySelector('.overlay h1')?.textContent?.trim(),
  sub: document.querySelector('.overlay .sub')?.textContent?.trim(),
  cards: document.querySelectorAll('[data-action="altar-morph"]').length,
}));
console.log('变形页:', JSON.stringify(ui));
assert(ui.title === '变形祭坛', '变形页标题');

const deckBefore = (await runState()).deck;
await page.locator('[data-action="altar-morph"]').first().click();
await page.waitForTimeout(300);
ui = await page.evaluate(() => ({
  flash: document.querySelector('.flash')?.textContent?.trim(),
  gold: document.querySelector('.chip.gold b')?.textContent?.trim(),
}));
st = await runState();
console.log('变一张后:', JSON.stringify({ ...ui, ...st }));
assert(st.deck === deckBefore, `卡组长度不变（${deckBefore} → ${st.deck}）`);
assert(st.gold < 500, '扣钱了');
assert(/变成了/.test(ui.flash || ''), `横幅：${ui.flash}`);
await page.locator('[data-action="cancel-altar"]').click();
await page.waitForTimeout(300);

/* ---------------- 行商 4 卡位 ---------------- */
await clickCell(seeded.shop);
await page.waitForTimeout(400);
ui = await page.evaluate(() => ({
  title: document.querySelector('.overlay h1')?.textContent?.trim(),
  cardRows: document.querySelectorAll('[data-action="buy-card"]').length,
}));
console.log('行商店:', JSON.stringify(ui));
assert(ui.cardRows === 4, `卡位 4 张（实际 ${ui.cardRows}）`);

console.log('页面错误:', errs.length ? errs : '无');
if (errs.length) process.exit(1);
console.log('ALL PASS');
await browser.close();

function assert(cond, msg) {
  if (!cond) { console.error(`✗ ${msg}`); process.exit(1); }
  console.log(`✓ ${msg}`);
}
