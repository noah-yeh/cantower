/**
 * v3.87 探针：手牌保留 / 能量收紧 / 费用涨价 / 合成同级 / 行商入口改角色详情页。
 *
 * 用户四处反馈：
 *   ① 「卡牌消耗水晶都太少了，初始水晶都太高了」→ 0 费产出牌涨价、能量 5~8 → 4~6；
 *   ② 「回合结束不应该丢弃手牌的」→ 手牌保留，下回合只补抽到 5 张；
 *   ③ 「一张 0 级一张 1 级可以合成 2 级？应该同级才能合」→ 规则核对 + 提示改写；
 *   ④ 「行商里面的背包还是旧的页面，应该进入角色详情页」。
 *
 * 检查：
 *   ① 战斗：结束回合后手牌**还在**（不是空的），新回合补抽到 5 张、能量回满到角色上限；
 *   ② 手牌里 0 费产出牌（快刺/架势）费用显示 1，能量球 = 角色能量（4~6）；
 *   ③ 详情页牌库里这些卡的价格点也是 1；
 *   ④ 行商右上「角色」→ 打开角色详情页（不是旧背包），关掉回行商；
 *   ⑤ 合成：同名不同级不给合，列表里只出现同级成对的卡。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(250);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

/** 造一趟第 2 层的探险：卡组里塞快刺/架势/格挡（含同 id 不同级），能量钉到 5 */
const cellIdx = await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const dungeon = await import('/src/core/dungeon.js');
  const m = meta.createMeta(20261112);
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  a.status = 'exploring';
  m.roster = [a];
  const run = runMod.createRun({ character: a, seed: 777 });
  run.floor = 2;
  run.player.energy = 5;
  run.deck = ['jab', 'brace', 'guard', 'guard+1', 'guard+1', 'heavy', 'mend', 'bomb'];
  dungeon.makeFloorMap(run);
  const cells = run.floorMap.cells;
  const i = cells.findIndex((c) => c.kind === 'enemy' || c.kind === 'elite');
  cells[i].revealed = true;
  run.phase = 'map';
  save.saveRun(run);
  m.run = { characterId: a.id, floor: run.floor };
  save.saveMeta(m);
  return i;
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(450);
await page.locator('[data-action="maze-guide-ok"]').first().click().catch(() => {});
await page.waitForTimeout(200);
await page.evaluate((i) => document.querySelectorAll('.dcell')[i]?.click(), cellIdx);
await page.waitForTimeout(800);

/* ---- ① 战斗开局：手牌 5 张、能量 = 角色 5 ---- */
const start = await page.evaluate(() => ({
  inBattle: !!document.querySelector('.hand'),
  cards: [...document.querySelectorAll('.hand .card')].map((c) => ({
    name: c.querySelector('.cname')?.textContent.replace(/\s+/g, ' ').trim(),
    cost: c.querySelector('.ccost')?.textContent.trim(),
  })),
  orb: document.querySelector('.energy-orb')?.textContent.replace(/\s+/g, ' ').trim(),
}));
console.log('开局:', JSON.stringify(start));
ok(start.inBattle, '进入战斗');
ok(start.cards.length === 5, `开局 5 张手牌（${start.cards.length}）`);
ok(/5/.test(start.orb || ''), `能量球 = 角色能量（${start.orb}）`);

/* ---- ② 结束回合：手牌不丢，新回合补抽到 5 ---- */
await page.evaluate(() => document.querySelector('[data-action="end-turn"]')?.click());
/** 等敌人回合走完（结束回合按钮重新可用、手牌区不再 dim） */
let waited = 0;
while (waited < 9000) {
  const back = await page.evaluate(() => {
    const btn = document.querySelector('[data-action="end-turn"]');
    const hand = document.querySelector('.hand');
    return !!btn && !btn.classList.contains('disabled') && !hand?.classList.contains('dim');
  });
  if (back) break;
  await page.waitForTimeout(200);
  waited += 200;
}
const after = await page.evaluate(() => ({
  cards: [...document.querySelectorAll('.hand .card')].map((c) => c.querySelector('.cname')?.textContent.replace(/\s+/g, ' ').trim()),
  orb: document.querySelector('.energy-orb')?.textContent.replace(/\s+/g, ' ').trim(),
  dim: document.querySelector('.hand')?.classList.contains('dim'),
}));
console.log('新回合:', JSON.stringify(after));
ok(!after.dim && after.cards.length > 0, `回合结束后手牌保留（${after.cards.length} 张）`);
ok(after.cards.length === 5, `新回合补抽到 5 张（${after.cards.length}）`);
ok(after.cards.join(',').includes(start.cards[0]?.name || '***'), '留着的老牌还在手里');
ok(/5/.test(after.orb || ''), `能量回满到 5（${after.orb}）`);
await page.screenshot({ path: 'tools/probe/v387-battle.png' });

/* ---- ③ 费用点：快刺/架势 现在是 1 费 ---- */
const costs = await page.evaluate(async () => {
  const C = await import('/src/core/cards.js');
  return { jab: C.CARDS.jab.cost, brace: C.CARDS.brace.cost, smoke: C.CARDS.smoke.cost, aim: C.CARDS.h_aim.cost };
});
console.log('费用:', JSON.stringify(costs));
ok(costs.jab === 1 && costs.brace === 1 && costs.smoke === 1 && costs.aim === 1,
  `0 费产出牌已涨价（快刺 ${costs.jab} / 架势 ${costs.brace} / 烟雾弹 ${costs.smoke} / 瞄准 ${costs.aim}）`);

/* ---- ④ 详情页牌库：同名不同级不给合，只合同级成对的 ---- */
await page.locator('[data-action="open-hero"]').last().click();
await page.waitForTimeout(450);
const deck = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.hero-page .hp-deck-cards .hp-card')].map((c) => ({
    name: c.querySelector('.cname')?.textContent.replace(/\s+/g, ' ').trim(),
    cost: c.querySelector('.ccost')?.textContent.trim(),
  }));
  const btn = document.querySelector('.hp-forge-btn');
  return { cards, forge: btn?.textContent.replace(/\s+/g, '').trim(), off: btn?.classList.contains('off') };
});
console.log('牌库:', JSON.stringify(deck));
ok(deck.cards.some((c) => /快刺/.test(c.name) && c.cost === '1'), '牌库里 快刺 标 1 费');
ok(deck.cards.some((c) => /架势/.test(c.name) && c.cost === '1'), '牌库里 架势 标 1 费');
await page.locator('.hp-forge-btn').click();
await page.waitForTimeout(350);
const list = await page.evaluate(() => [...document.querySelectorAll('.hp-forge-item')].map((it) => ({
  key: it.dataset.key,
  name: it.querySelector('.cname')?.textContent.replace(/\s+/g, ' ').trim(),
})));
console.log('可合成:', JSON.stringify(list));
ok(list.length === 1 && list[0].key === 'guard+1', `只有同级成对的格挡+1 能合（${list.map((l) => l.name).join('/')}）`);
ok(!list.some((l) => l.key === 'guard'), '一张 +0 一张 +1 的格挡不在列表里');
await page.screenshot({ path: 'tools/probe/v387-forge-list.png' });

await page.locator('.hp-forge-item').first().click();
await page.waitForTimeout(300);
const detail = await page.evaluate(() => ({
  hint: document.querySelector('.hp-forge-box .hp-hint, .hp-attrs-box .hp-hint')?.textContent.replace(/\s+/g, ' ').trim() || '',
  caps: [...document.querySelectorAll('.hp-forge-cap')].map((c) => c.textContent.trim()),
  names: [...document.querySelectorAll('.hp-forge-col .cname')].map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
}));
console.log('合成对比:', JSON.stringify(detail));
ok(/同级/.test(detail.hint) && /不同等级/.test(detail.hint), `提示写明必须同级：「${detail.hint.slice(0, 40)}…」`);
ok(detail.names[0].includes('+1') && detail.names[1].includes('+2'), `对比是 +1 → +2（${detail.names.join(' → ')}）`);
await page.locator('.hp-forge-box [data-action="hero-forge-close"], .hp-attrs-box [data-action="hero-forge-close"]').first().click().catch(() => {});
await page.locator('.hero-page [data-action="close-hero-page"]').first().click();
await page.waitForTimeout(400);

/* ---- ⑤ 行商右上入口 → 角色详情页 ---- */
const shopReady = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  run.phase = 'shop';
  run.gold = 300;
  run.shop = { kind: 'card', refreshes: 0, relics: [], cards: [{ id: 'jab', price: 80, sold: false }] };
  save.saveRun(run);
  return true;
});
ok(shopReady, '切到行商');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(500);
const nav = await page.evaluate(() => ({
  label: document.querySelector('.back-btn.right')?.textContent.trim(),
  action: document.querySelector('.back-btn.right')?.dataset.action,
  shop: !!document.querySelector('.overlay.shop'),
}));
console.log('行商入口:', JSON.stringify(nav));
ok(nav.shop && nav.label === '角色' && nav.action === 'open-hero', `右上按钮是「角色」并走 open-hero（${nav.label}/${nav.action}）`);
await page.locator('.back-btn.right').click();
await page.waitForTimeout(450);
const heroFromShop = await page.evaluate(() => ({
  hero: !!document.querySelector('.hero-page .hp-box'),
  tabs: [...document.querySelectorAll('.hero-page .hp-tab')].map((b) => b.textContent.trim()),
}));
console.log('行商→详情:', JSON.stringify(heroFromShop));
ok(heroFromShop.hero, '行商里点「角色」打开的是角色详情页');
ok(heroFromShop.tabs.includes('牌库') && heroFromShop.tabs.includes('宝物'), `详情页有牌库/宝物页签（${heroFromShop.tabs.join('/')}）`);
await page.screenshot({ path: 'tools/probe/v387-shop-hero.png' });
await page.locator('.hero-page [data-action="close-hero-page"]').first().click();
await page.waitForTimeout(400);
const backToShop = await page.evaluate(() => ({
  shop: !!document.querySelector('.overlay.shop'),
  gold: document.querySelector('.purse .chip.gold b')?.textContent.trim(),
}));
ok(backToShop.shop && backToShop.gold === '300', `关掉详情页回到同一台摊子（古币 ${backToShop.gold}）`);

await browser.close();
console.log('PROBE DONE');
