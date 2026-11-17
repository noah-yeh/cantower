/**
 * v3.90 探针 —— 商城 + 命数之种 + 种族图鉴化
 *
 * 检查：
 *   1. 大厅工具行有「商城」入口（原广告位收拢）
 *   2. 商城页四张卡：广告金币 / 碎片宝箱 / 古币宝箱 / 装备宝箱
 *   3. 看广告 +30 金（商城内）；看广告开碎片箱（商城内，次数记账）
 *   4. 古币宝箱：扣 50 金、碎片入账；装备宝箱：扣 80 金、装备进库
 *   5. 种族页：头像换切图（rc-face）、无宝箱按钮，解锁/升级仍可用
 *   6. 图鉴「种族」页签：4 张切图大图，解锁状态角标正确
 *   7. 命数之种：详情页按钮 → +1 命数、种子扣减、到顶按钮消失
 *   8. 老档迁移：lifeSeeds 保留
 */

import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:4182/';
let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('OK  ' + msg); }
  else { fail++; console.log('ERR ' + msg); }
};

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });

const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);

/* ---------------------------------------------------------------- 1. 大厅入口 */
const entry = await page.evaluate(() => {
  const b = document.querySelector('[data-action="open-shop"]');
  return b ? b.textContent.replace(/\s+/g, ' ').trim() : null;
});
ok(entry && entry.includes('商城'), `大厅有「商城」入口（${entry}）`);
ok(entry && /广告/.test(entry), `入口角标还挂着广告提示（${entry}）`);
ok(!await page.evaluate(() => document.querySelector('[data-action="watch-ad"]')),
  '大厅本体不再有 watch-ad 按钮（搬进商城了）');

/* ---------------------------------------------------------------- 2. 商城页结构 */
await page.locator('[data-action="open-shop"]').click();
await sleep(400);
const mall = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.mall-card')];
  const titles = cards.map((c) => c.querySelector('.rb-txt b')?.textContent || '');
  return {
    cards: cards.length,
    titles,
    goldSub: cards[0]?.querySelector('.rb-left')?.textContent.replace(/\s+/g, ''),
    boxSub: cards[1]?.querySelector('.rb-left')?.textContent.replace(/\s+/g, ''),
    goldBtn: [...document.querySelectorAll('[data-action="watch-ad"]')].length,
    boxBtn: !!document.querySelector('[data-action="race-box"]'),
    coinBtn: document.querySelector('[data-action="gold-chest"]')?.textContent.replace(/\s+/g, ''),
    equipBtn: document.querySelector('[data-action="equip-chest"]')?.textContent.replace(/\s+/g, ''),
  };
});
ok(mall.cards === 4, `四张商城卡（实际 ${mall.cards}）`);
ok(mall.titles.join('/') === '广告金币/碎片宝箱/古币宝箱/装备宝箱', `卡名正确（${mall.titles.join('/')}）`);
ok(/5/.test(mall.goldSub || ''), `金币广告显示今日 5 次（${mall.goldSub}）`);
ok(/5/.test(mall.boxSub || ''), `碎片宝箱显示今日 5 次（${mall.boxSub}）`);
ok(mall.goldBtn === 1, '金币广告按钮在商城里');
ok(mall.boxBtn, '碎片宝箱按钮在商城里');
ok(/50/.test(mall.coinBtn || ''), `古币宝箱标价 50（${mall.coinBtn}）`);
ok(/80/.test(mall.equipBtn || ''), `装备宝箱标价 80（${mall.equipBtn}）`);

/* ---------------------------------------------------------------- 3. 看广告 +30 金 */
const goldBefore = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  return loadMeta(Date.now()).gold;
});
await page.locator('[data-action="watch-ad"]').click();
await sleep(600);
const adSlot = await page.evaluate(() => document.querySelector('.ad-overlay')?.dataset.slot || null);
ok(adSlot === 'hall_gold', `金币广告位是 hall_gold（实际 ${adSlot}）`);
await sleep(3200);
const goldAfter = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  return { gold: loadMeta(Date.now()).gold, used: loadMeta(Date.now()).ads?.used };
});
ok(goldAfter.gold === goldBefore + 30, `看完 +30 金（${goldBefore} → ${goldAfter.gold}）`);
ok(goldAfter.used === 1, `金币位记账 1（实际 ${goldAfter.used}）`);

/* ---------------------------------------------------------------- 4. 碎片宝箱广告 */
const shardsBefore = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  return Object.fromEntries(Object.entries(m.races).map(([k, v]) => [k, v.shards]));
});
await page.locator('[data-action="race-box"]').click();
await sleep(600);
const boxSlot = await page.evaluate(() => document.querySelector('.ad-overlay')?.dataset.slot || null);
ok(boxSlot === 'shard_box', `碎片广告位是 shard_box（实际 ${boxSlot}）`);
await sleep(3200);
const boxed = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  return {
    races: Object.fromEntries(Object.entries(m.races).map(([k, v]) => [k, v.shards])),
    boxUsed: m.ads?.boxUsed,
  };
});
const gained = Object.keys(boxed.races).some((k) => boxed.races[k] > (shardsBefore[k] ?? 0));
ok(gained, `碎片增加了（${JSON.stringify(shardsBefore)} → ${JSON.stringify(boxed.races)}）`);
ok(boxed.boxUsed === 1, `宝箱次数记 1（实际 ${boxed.boxUsed}）`);

/* ---------------------------------------------------------------- 5. 古币宝箱 + 装备宝箱 */
await page.evaluate(async () => {
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  m.gold = 1000;
  saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(300);
await page.locator('[data-action="open-shop"]').click();
await sleep(400);

await page.locator('[data-action="gold-chest"]').click();
await sleep(450);
const coin = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  return {
    gold: m.gold,
    shards: Object.fromEntries(Object.entries(m.races).map(([k, v]) => [k, v.shards])),
    flash: document.querySelector('.flash')?.textContent || '',
  };
});
ok(coin.gold === 950, `古币宝箱扣 50 金（1000 → ${coin.gold}）`);
const shardGain = Object.keys(coin.shards).some((k) => coin.shards[k] > (boxed.races[k] ?? 0));
ok(shardGain, `碎片入账了（${JSON.stringify(coin.shards)}）`);
ok(/古币宝箱/.test(coin.flash), `有结果提示（${coin.flash}）`);

await page.locator('[data-action="equip-chest"]').click();
await sleep(450);
const equip = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  return { gold: m.gold, n: m.equipment.length, flash: document.querySelector('.flash')?.textContent || '' };
});
ok(equip.gold === 870, `装备宝箱扣 80 金（950 → ${equip.gold}）`);
ok(equip.n >= 1, `装备进了库（${equip.n} 件）`);
ok(/装备宝箱开出/.test(equip.flash), `有开箱提示（${equip.flash}）`);

/* ---------------------------------------------------------------- 6. 种族页签（v3.95 并入图鉴） */
await page.locator('[data-action="back-hall"]').click();
await sleep(350);
const hallTools = await page.evaluate(() => ({
  hasRaces: !!document.querySelector('[data-action="open-races"]'),
  n: document.querySelectorAll('.hall-tools .ht').length,
}));
ok(!hallTools.hasRaces, '大厅撤掉种族独立入口（v3.95）');
ok(hallTools.n === 5, `大厅次级入口回到 5 格（实际 ${hallTools.n}）`);

await page.locator('[data-action="open-codex"]').click();
await sleep(350);
await page.locator('[data-action="codex-tab"][data-tab="races"]').click();
await sleep(400);
const racesPage = await page.evaluate(() => ({
  cards: document.querySelectorAll('.race-card').length,
  faces: document.querySelectorAll('.race-card .rc-face').length,
  noBox: !document.querySelector('[data-action="race-box"]'),
  unlockBtns: document.querySelectorAll('[data-action="race-unlock"]').length,
  upBtns: document.querySelectorAll('[data-action="race-levelup"]').length,
  hintHasMall: (document.querySelector('.cx-scroll')?.textContent || '').includes('商城'),
}));
ok(racesPage.cards === 4, `图鉴种族页签 4 张卡（实际 ${racesPage.cards}）`);
ok(racesPage.faces === 4, `4 张种族切图头像（实际 ${racesPage.faces}）`);
ok(racesPage.noBox, '这里不再有宝箱按钮（宝箱在商城）');
ok(racesPage.unlockBtns + racesPage.upBtns === 4, `每张卡都有养成按钮（解锁 ${racesPage.unlockBtns} + 升级 ${racesPage.upBtns}）`);
ok(racesPage.hintHasMall, '提示指向商城');

/* ---------------------------------------------------------------- 8. 命数之种 */
await page.evaluate(async () => {
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  m.lifeSeeds = 2;
  const ch = m.roster[0];
  ch.lives = ch.maxLives - 1; // 缺 1 命，按钮该亮
  saveMeta(m);
});
await page.goto(BASE, { waitUntil: 'networkidle' });
await sleep(300);
await page.locator('[data-action="open-roster"]').click();
await sleep(400);
/** 新档只有初始转正角色，营地默认停在实习 tab —— 先切到「转正」再点人 */
await page.evaluate(() => {
  [...document.querySelectorAll('[data-action="roster-tab"]')]
    .find((b) => b.textContent.includes('转正'))?.click();
});
await sleep(350);
await page.evaluate(() => {
  document.querySelector("[data-action=open-char]")?.click();
});
await sleep(400);
const seedBtn = await page.evaluate(() => document.querySelector('[data-action="use-seed"]')?.textContent.replace(/\s+/g, '') || null);
ok(seedBtn && /命数之种/.test(seedBtn), `详情页有命数之种按钮（${seedBtn}）`);

if (seedBtn) {
  await page.locator('[data-action="use-seed"]').click();
  await sleep(450);
  const seeded = await page.evaluate(async () => {
    const { loadMeta } = await import('/src/core/save.js');
    const m = loadMeta(Date.now());
    return { seeds: m.lifeSeeds, lives: m.roster[0].lives, max: m.roster[0].maxLives };
  });
  ok(seeded.seeds === 1, `种子扣到 1（实际 ${seeded.seeds}）`);
  ok(seeded.lives === seeded.max, `命数补回种族上限（${seeded.lives}/${seeded.max}）`);

  /** 种满到顶 → 按钮消失 */
  await page.evaluate(async () => {
    const { loadMeta, saveMeta } = await import('/src/core/save.js');
    const m = loadMeta(Date.now());
    m.lifeSeeds = 5;
    m.roster[0].lives = m.roster[0].maxLives + 2;
    saveMeta(m);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(300);
  await page.locator('[data-action="open-roster"]').click();
  await sleep(350);
  await page.evaluate(() => {
    [...document.querySelectorAll('[data-action="roster-tab"]')]
      .find((b) => b.textContent.includes('转正'))?.click();
  });
  await sleep(350);
  await page.evaluate(() => {
    document.querySelector("[data-action=open-char]")?.click();
  });
  await sleep(400);
  const capped = await page.evaluate(() => !document.querySelector('[data-action="use-seed"]'));
  ok(capped, '命数到顶后按钮消失');
}

/* ---------------------------------------------------------------- 9. 老档迁移 lifeSeeds */
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('ruin-spire/hall', JSON.stringify({
    version: 8, seed: 7, gold: 500, lifeSeeds: 9,
    roster: [], ghosts: [], graveyard: [], counter: 1, log: [],
  }));
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);
const migratedSeeds = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  return loadMeta(Date.now()).lifeSeeds;
});
ok(migratedSeeds === 9, `老档 lifeSeeds 保留（实际 ${migratedSeeds}）`);

console.log(`\n—— 结果 ——  通过 ${pass} / 失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
