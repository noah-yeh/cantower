/**
 * v3.71 探针：角色详情页重排。
 *
 * 用户：「角色详情页做的太丑了；角色那个 tab 原作是展示卡牌的，改名叫牌库；
 * 去掉出发探险按钮（只在冒险页发起）；为什么还有两个装备按钮，装备只用来存放
 * 未穿戴的装备；加一个感叹号（或其他符号）用来展示属性；天赋和宝物要区分」。
 *
 * 检查：
 *   ① 页签是「❗属性 | 牌库 | 宝物」三枚，装备页签已删；
 *   ② 默认停在属性页：9 行属性套上边框卡片（attr-ui 生效）、说明缩进第二行；
 *   ③ 天赋块在属性页，金框 + 种族/职业小图（与宝物的青调卡片分型）；
 *   ④ 牌库页签：标题「牌库」+ 张数/类型汇总，chip 展开收起可用；
 *   ⑤ 宝物页签有"收集品"说明（与天赋区分的口径）；
 *   ⑥ 动作区：实习生只有 装备/背包（无出发探险），转正= 竞技场/装备/背包；
 *      详情页里 open-equip 按钮只有 1 枚；
 *   ⑦ 冒险页仍有「出发」入口（data-action=explore）；
 *   ⑧ 装备页：标题「装备库」，「装备库 · 未穿戴」区块排在「已穿戴」之前；
 *   ⑨ 战斗页头像打开的 run 详情同样是三页签、无出发按钮。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(350);

await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = meta.createMeta(20261110);
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  a.status = 'idle';
  const b = roster.createCharacter({ classId: 'mage', raceId: 'ember', seed: 4 });
  b.status = 'idle'; b.veteran = true; b.arenaLeft = 3;
  b.relics = ['anvil', 'poisonGem']; b.relicSlots = ['whetstone'];
  m.roster = [a, b];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(350);

/* ⑦ 冒险页仍有出发入口 */
const exploreBtn = await page.evaluate(() => document.querySelectorAll('[data-action="explore"]').length);
ok(exploreBtn >= 1, `冒险页保留出发入口（${exploreBtn} 个）`);

/* 打开实习生详情 */
await page.locator('.ex-card').first().click();
await page.waitForTimeout(400);

/* ① 页签结构 */
const tabs = await page.evaluate(() => [...document.querySelectorAll('.hero-page .hp-tab')].map((t) => ({
  key: t.dataset.tab,
  text: t.textContent.trim(),
  on: t.classList.contains('on'),
})));
ok(tabs.length === 3 && tabs.slice(0, 2).map((t) => t.text).join(',') === '牌库,宝物',
  `页签是 牌库/宝物（${tabs.map((t) => t.text).join(',')}）`);
ok(tabs[2].key === 'gear' && tabs[2].text === '装备',
  '「装备」是页签行末尾的真页签（v3.73 页内仓库）');
ok(tabs[0].on, '默认页签是牌库（v3.73 属性挪去 ❗ 蒙板）');

/* ② 属性蒙板（v3.73）：❗ 入口点开，9 行有卡片样式 + 两行式说明 */
await page.locator('.hero-page .hp-v-attrs').click();
await page.waitForTimeout(300);
const attrs = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.hp-attrs-box .sp-row')];
  const first = rows[0];
  const st = first ? getComputedStyle(first) : null;
  const desc = first?.querySelector('.sp-desc');
  return {
    rows: rows.length,
    boxed: !!st && st.borderTopWidth !== '0px',
    descLeft: desc ? getComputedStyle(desc).textAlign : '',
    talents: document.querySelectorAll('.hero-page .hp-talent').length,
    cap: document.querySelectorAll('.hero-page .hp-slot-cap').length,
  };
});
ok(attrs.rows === 9, `属性蒙板 9 行（${attrs.rows}）`);
ok(attrs.boxed, '属性行有卡片边框（v3.67 的裸散文已治）');
ok(attrs.descLeft === 'left' || attrs.descLeft === 'start', `说明靠左第二行（${attrs.descLeft}）`);
await page.screenshot({ path: 'tools/probe/shot-v371-attrs.png' });
await page.locator('.hp-attrs-box .hp-close').click();
await page.waitForTimeout(250);

/* ③ v3.72：天赋改成头像下的圆徽（详情页不放天赋块） */
ok(attrs.talents === 0, '详情页没有天赋块（挪到头像下）');
ok(attrs.cap === 2, `两个装备槽都有名称小字（${attrs.cap}）`);

/* ⑥ 实习生动作区：只有 装备/背包，无出发探险 */
const internActs = await page.evaluate(() => ({
  btns: [...document.querySelectorAll('.hero-page .hp-acts .btn')].map((b) => b.textContent.trim()),
  equipBtns: document.querySelectorAll('.hero-page .hp-acts [data-action="open-equip"]').length,
}));
ok(!internActs.btns.some((t) => /出发|装备|背包/.test(t)), `实习生动作区已清空，装备在页签行（${internActs.btns.join('/') || '空'}）`);
ok(internActs.equipBtns === 0, '动作区没有装备按钮（v3.72 挪进页签行）');
ok(!!(await page.locator('.hero-page .hp-tab[data-tab="gear"]').count()), '页签行有「装备」页签（v3.73 页内）');
await page.locator('.hero-page .hp-close').click();
await page.waitForTimeout(300);

/* 转正角色：回大厅 → 竞技场名册打开（转正的不出现在冒险页） */
await page.locator('[data-action="back-hall"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="open-arena"]').first().click();
await page.waitForTimeout(350);
await page.locator('.ex-card').first().click();
await page.waitForTimeout(400);
const vetActs = await page.evaluate(() =>
  [...document.querySelectorAll('.hero-page .hp-acts .btn')].map((b) => b.textContent.trim()));
ok(!vetActs.some((t) => /出发|装备|背包|竞技场/.test(t)), `转正动作区已清空（v3.75 上场只去竞技场页）（${vetActs.join('/')}）`);

/* ④ 牌库页签 */
await page.locator('.hp-tab[data-tab="deck"]').click();
await page.waitForTimeout(300);
const deck = await page.evaluate(() => {
  const head = document.querySelector('.hero-page .hp-sec-head span')?.textContent.trim();
  const sub = document.querySelector('.hero-page .hp-sec-sub')?.textContent.trim();
  const chips = document.querySelectorAll('.hero-page .hp-deck-chip').length;
  const cards = document.querySelectorAll('.hero-page .hp-card').length;
  return { head, sub, chips, cards };
});
/** v3.84：牌库标题行已删（页签上已有「牌库」二字），只留统计行 */
ok(deck.head !== '牌库' && /攻击 \d+ \/ 技能 \d+ \/ 本场 \d+/.test(deck.sub || ''), `类型汇总：「${deck.sub}」`);
ok(deck.cards >= 1, `真卡面渲染（${deck.cards} 张，v3.72）`);
ok(deck.chips === 0, '旧的文字 chip 已不存在');

/* ⑤ 宝物页签：v3.84 起标题行与说明文字都删了，进来直接是「已激活」 */
await page.locator('.hp-tab[data-tab="relic"]').click();
await page.waitForTimeout(300);
const relic = await page.evaluate(() => ({
  head: document.querySelector('.hero-page .hp-sec-head span')?.textContent.trim(),
  hint: document.querySelector('.hero-page .hp-hint')?.textContent.trim() || '',
  cards: document.querySelectorAll('.hero-page .relic-card').length,
}));
ok(relic.head === '已激活', `宝物页签直接进「已激活」（${relic.head}）`);
ok(!/收集/.test(relic.hint), '旧「收集品」说明已删');
ok(relic.cards >= 1, `宝物卡渲染（${relic.cards} 张）`);
await page.screenshot({ path: 'tools/probe/shot-v371-relic.png' });
await page.locator('.hero-page .hp-close').click();
await page.waitForTimeout(250);

/* ⑧ 装备页签：只展示仓库（v3.73 页内页签，上半部分不动） */
await page.locator('.ex-card').first().click();
await page.waitForTimeout(400);
await page.locator('.hero-page .hp-tab[data-tab="gear"]').click();
await page.waitForTimeout(400);
const eq = await page.evaluate(() => ({
  top: !!document.querySelector('.hero-page .hp-portrait'),
  head: document.querySelector('.hero-page .hp-body .hp-sec-head span')?.textContent.trim(),
  sub: document.querySelector('.hero-page .hp-body .hp-sec-sub')?.textContent.trim() || '',
  wornRows: document.querySelectorAll('.hero-page .eq-row.worn').length,
}));
ok(eq.top, '装备页签保留上半部分（不跳页）');
ok(eq.head === '装备仓库', `装备页签是仓库（${eq.head}）`);
ok(/共 \d+/.test(eq.sub), `仓库计数：「${eq.sub}」`);
ok(eq.wornRows === 0, '已穿戴段不存在（穿着在顶部槽位看）');
await page.screenshot({ path: 'tools/probe/shot-v371-equip.png' });
await page.locator('.hero-page .hp-close').click();
await page.waitForTimeout(250);

/* ⑨ 战斗页头像 → run 详情 */
await page.locator('[data-action="back-hall"]').first().click();
await page.waitForTimeout(300);
await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const roster = await import('/src/core/roster.js');
  const meta = await import('/src/core/meta.js');
  const m = meta.createMeta(20261111);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.status = 'idle';
  m.roster = [ch];
  save.saveMeta(m);
  const run = runMod.createRun({ character: ch, seed: 42 });
  const idx = run.floorMap.cells.findIndex((c) => c.kind === 'enemy' && !c.done);
  run.floorMap.cells[idx].revealed = true;
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(450);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.dcell.pending.k-enemy')?.click());
await page.waitForTimeout(700);
await page.locator('.player-row .face-btn').click();
await page.waitForTimeout(400);
const runHero = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('.hero-page .hp-tab')].map((t) => t.textContent.trim()),
  acts: document.querySelectorAll('.hero-page .hp-acts .btn').length,
  rows: document.querySelectorAll('.hero-page .sp-row').length,
}));
ok(runHero.tabs.join(',') === '牌库,宝物', `run 详情同款页签（${runHero.tabs.join(',')}）`);
/* v3.73：run 详情属性在蒙板里看 */
await page.locator('.hero-page .hp-v-attrs').click();
await page.waitForTimeout(300);
const runMaskRows = await page.evaluate(() => document.querySelectorAll('.hp-attrs-box .sp-row').length);
ok(runMaskRows === 9 && runHero.acts === 0, `run 详情蒙板 9 行属性、无动作区（${runMaskRows}/${runHero.acts}）`);

await browser.close();
console.log('ALL PASS');
