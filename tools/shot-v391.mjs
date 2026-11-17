/**
 * v3.91 探针 —— 图鉴卡牌按类型分组 + 宝石牌
 *
 * 用户三处要求：
 *   ① 「图鉴卡牌不需要全部，就按照各种类型区分就行」→ 删「全部」页签，分类内按牌型分组
 *   ② 「格挡牌应该在通用里面的，不需要放到各职业里面」→ 职业页不再出现通用牌
 *   ③ 「再增加一些宝石牌，宝石牌使用后可以装备在状态栏在本场战斗生效」
 *
 * 检查：
 *   A. 图鉴：无「全部」chip；默认停在通用；通用页有「宝石牌」小节且 5 张；
 *      格挡在通用页只出现 1 次；战士页没有格挡卡面，但起始卡组行写着「格挡 ×2（通用）」
 *   B. 战斗：打出琥珀宝石 → 状态栏出现宝石 chip（带颜色）+ 能量 orb 变化；
 *      结束回合后能量上限 +1；宝石卡进消耗堆
 *   C. 卡面：宝石卡带 kind-gem 与配色 class，文案是「镶嵌…本场战斗生效」
 */
import { chromium } from 'playwright-core';

const BASE = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('OK  ' + msg); } else { fail++; console.log('ERR ' + msg); }
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

/* ================================================================ A. 图鉴 */
await page.locator('[data-action="open-codex"]').click();
await sleep(400);

const chips = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('.cx-chip')].map((c) => c.textContent.trim()),
  on: document.querySelector('.cx-chip.on')?.textContent.trim(),
}));
ok(!chips.labels.includes('全部'), `没有「全部」页签（${chips.labels.join('/')}）`);
ok(chips.labels[0] === '通用', '第一个分类是通用');
ok(chips.on === '通用', `默认停在通用（${chips.on}）`);

const gen = await page.evaluate(() => {
  const heads = [...document.querySelectorAll('.cx-scroll .sec-head span:first-child')].map((s) => s.textContent.trim());
  const cards = [...document.querySelectorAll('.cx-scroll .cx-card')];
  return {
    heads,
    total: cards.length,
    gems: cards.filter((c) => c.classList.contains('kind-gem')).length,
    gemNames: cards.filter((c) => c.classList.contains('kind-gem')).map((c) => c.querySelector('.cx-title b')?.textContent.trim()),
    guard: cards.filter((c) => c.querySelector('.cx-title b')?.textContent.trim() === '格挡').length,
    topCount: document.querySelector('.top-count')?.textContent.trim(),
  };
});
ok(gen.heads.includes('宝石牌'), `通用页按牌型分组，有「宝石牌」小节（${gen.heads.join('/')}）`);
ok(gen.gems === 5, `宝石 5 张（实际 ${gen.gems}）`);
ok(gen.gemNames.join('').includes('琥珀宝石'), `宝石名正确（${gen.gemNames.join('/')}）`);
ok(gen.guard === 1, `格挡在通用页只出现 1 次（实际 ${gen.guard}）`);
console.log('   通用页:', JSON.stringify(gen));

/* 战士页：不重复通用牌 */
await page.locator('[data-action="codex-class"][data-cls="warrior"]').click();
await sleep(350);
const war = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.cx-scroll .cx-card')];
  const names = cards.map((c) => c.querySelector('.cx-title b')?.textContent.trim());
  const core = [...document.querySelectorAll('.cx-talent-line')]
    .map((r) => r.textContent.replace(/\s+/g, ' ').trim())
    .find((t) => t.startsWith('起始卡组')) || '';
  return {
    names,
    guard: names.filter((n) => n === '格挡').length,
    generic: names.filter((n) => ['快刺', '凝神', '重击', '绷带', '破防', '魔力宝石'].includes(n)).length,
    core,
    total: cards.length,
  };
});
ok(war.guard === 0, `战士页没有格挡卡面（实际 ${war.guard}）`);
ok(war.generic === 0, `战士页没有其它通用牌（实际 ${war.generic}）`);
ok(/格挡 ×2（通用）/.test(war.core), `起始卡组行标出通用牌（${war.core}）`);
ok(war.total > 10, `战士专属牌仍完整（${war.total} 张）`);
await page.screenshot({ path: 'tools/probe/v391-codex-warrior.png' });

/* ================================================================ B. 战斗 */
const cellIdx = await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const dungeon = await import('/src/core/dungeon.js');

  const m = meta.createMeta(20261117);
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  a.status = 'exploring';
  m.roster = [a];
  const run = runMod.createRun({ character: a, seed: 777 });
  run.floor = 2;
  run.player.energy = 5;
  /** 起手 5 张正好是这两颗宝石 + 三张普通牌 */
  run.deck = ['gem_topaz', 'gem_ruby', 'jab', 'guard', 'focus'];
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
await page.goto(BASE, { waitUntil: 'networkidle' });
await sleep(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await sleep(450);
await page.locator('[data-action="maze-guide-ok"]').first().click().catch(() => {});
await sleep(200);
await page.evaluate((i) => document.querySelectorAll('.dcell')[i]?.click(), cellIdx);
await sleep(800);
/** 两段式迷雾：第一下只翻格，第二下才进战斗 */
await page.evaluate((i) => document.querySelectorAll('.dcell')[i]?.click(), cellIdx);
await sleep(900);

const hand0 = await page.evaluate(() => ({
  names: [...document.querySelectorAll('.hand .card')].map((c) => c.querySelector('.cname')?.textContent.replace(/\s+/g, ' ').trim()),
  orb: document.querySelector('.energy-orb')?.textContent.replace(/\s+/g, ' ').trim(),
}));
console.log('   开局手牌:', JSON.stringify(hand0));
ok(hand0.names.some((n) => n && n.includes('琥珀宝石')), '手牌里有琥珀宝石');

/** 宝石卡面：kind-gem + 配色 + 文案 */
const gemFace = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.hand .card')].find((c) => c.classList.contains('kind-gem'));
  return el ? {
    cls: el.className,
    text: el.querySelector('.ctext')?.textContent.replace(/\s+/g, ' ').trim(),
  } : null;
});
ok(gemFace && /kind-gem/.test(gemFace.cls) && / g-(ruby|sapphire|emerald|topaz|amethyst)/.test(gemFace.cls),
  `宝石卡面带 kind-gem + 配色 class（${gemFace?.cls}）`);
ok(gemFace && /镶嵌/.test(gemFace.text) && /本场战斗生效/.test(gemFace.text), `宝石卡面文案（${gemFace?.text}）`);

/** 打出琥珀宝石 */
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.hand .card')].find((c) => c.classList.contains('g-topaz'));
  el?.click();
});
await sleep(500);
const afterGem = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.chip.gem')].map((c) => ({
    text: c.textContent.replace(/\s+/g, ' ').trim(),
    cls: c.className,
  })),
  orb: document.querySelector('.energy-orb')?.textContent.replace(/\s+/g, ' ').trim(),
  pile: document.querySelector('.pileinfo')?.textContent.replace(/\s+/g, ' ').trim(),
}));
console.log('   镶完:', JSON.stringify(afterGem));
ok(afterGem.chips.length === 1, `状态栏出现 1 枚宝石 chip（${afterGem.chips.length}）`);
ok(afterGem.chips[0]?.text.includes('琥珀宝石'), `chip 是琥珀宝石（${afterGem.chips[0]?.text}）`);
ok(/g-topaz/.test(afterGem.chips[0]?.cls || ''), `chip 带同一套配色（${afterGem.chips[0]?.cls}）`);
ok(/耗 1/.test(afterGem.pile || ''), `宝石进消耗堆（${afterGem.pile}）`);
await page.screenshot({ path: 'tools/probe/v391-battle-gem.png' });

/** 结束回合：能量上限 5 → 6 */
await page.evaluate(() => document.querySelector('[data-action="end-turn"]')?.click());
let waited = 0;
while (waited < 9000) {
  const back = await page.evaluate(() => {
    const btn = document.querySelector('[data-action="end-turn"]');
    return !!btn && !btn.classList.contains('disabled');
  });
  if (back) break;
  await sleep(200);
  waited += 200;
}
const nextTurn = await page.evaluate(() => ({
  orb: document.querySelector('.energy-orb')?.textContent.replace(/\s+/g, ' ').trim(),
  chip: !!document.querySelector('.chip.gem'),
}));
ok(/6/.test(nextTurn.orb || ''), `下回合能量上限 5+1=6（${nextTurn.orb}）`);
ok(nextTurn.chip, '宝石 chip 跨回合仍在（本场持久）');

/**
 * 提示气泡：点 chip 能看到效果。
 * 注意要在**同一次 evaluate 里**读结果 —— 浮层是挂在 #app 里的纯 DOM，
 * 任何一次 render() 都会把它抹掉（设计如此：点别处就关），
 * 战场那边还有排队中的动画定时器，跨 evaluate 读容易被它抢掉。
 */
const tip = await page.evaluate(() => {
  document.querySelector('.chip.gem')?.click();
  return {
    open: !!document.querySelector('.tip-overlay'),
    name: document.querySelector('.tip-name')?.textContent || '',
    text: document.querySelector('.tip-text')?.textContent || '',
  };
});
ok(tip.open && tip.name.includes('琥珀宝石') && tip.text.includes('每回合能量 +1'),
  `点宝石 chip 能看到镶嵌效果说明（${tip.name} · ${tip.text}）`);
await page.screenshot({ path: 'tools/probe/v391-gem-tip.png' });

console.log(`\n${pass} 通过 / ${fail} 失败`);
await browser.close();
process.exit(fail ? 1 : 0);
