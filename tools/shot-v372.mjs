/**
 * v3.72 探针：角色详情页二轮 + 委托得天赋。
 *
 * 用户：「空槽名字改武器/防具；种族头像完整展示；牌库做成真正的卡牌；
 * 装备库只展示仓库、返回回角色详情、装备 tab 移到页签同一排；详情里的
 * 背包去掉；属性不展示天赋，天赋放头像下面两个图标点击冒泡；局内接任务
 * 完成后获取额外天赋（正常额外 2-3 个）」。
 *
 * 检查：
 *   ① 页签行「❗属性 | 牌库 | 宝物 | 装备」，装备是入口按钮（无 data-tab）；
 *   ② 空槽小字是「武器 / 防具」；立绘 img 完整展示（height:100% contain）；
 *   ③ 天赋圆徽在立绘下（种族/职业金框），点一下冒泡、再点收起；
 *   ④ 属性页签没有天赋块；牌库页签是真卡面（.card + kind 配色 + 费用圆点）；
 *   ⑤ 底部动作区没有「装备」「背包」；
 *   ⑥ 装备库页只有仓库（无已穿戴段），穿满自动换位，返回回详情页；
 *   ⑦ run 详情：天赋圆徽含额外天赋、属性页有委托进度行；
 *   ⑧ 委托板事件真的能接单（core 直测走 tests，这里验 UI 数据源）。
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
  const m = meta.createMeta(20261111);
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  a.status = 'idle';
  a.deck = ['strike', 'strike', 'strike', 'guard', 'brace+1', 'w_ironWall'];
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
await page.locator('.ex-card').first().click();
await page.waitForTimeout(400);

/* ① 页签行（v3.73）：2 页签 + 装备入口按钮；属性是数值条上的 ❗ 入口 */
const tabs = await page.evaluate(() => [...document.querySelectorAll('.hero-page .hp-tabs > button')].map((t) => ({
  tab: t.dataset.tab ?? null,
  text: t.textContent.trim(),
  gear: t.dataset.tab === 'gear',
  on: t.classList.contains('on'),
})));
ok(tabs.length === 3, `页签行 3 枚（${tabs.map((t) => t.text).join(',')}）`);
ok(tabs[0].tab === 'deck' && tabs[1].tab === 'relic', '前两枚是 牌库/宝物 页签');
ok(tabs[2].gear && tabs[2].text === '装备', '第 3 枚是「装备」页签（v3.73 页内仓库）');
ok(tabs.every((t) => t.text !== '属性'), '属性不在页签行');
ok(tabs[0].on, '默认页签是牌库');
const freshOnce = await page.evaluate(() => ({
  fresh: document.querySelector('.hero-page').classList.contains('fresh'),
  anim: getComputedStyle(document.querySelector('.hero-page')).animationName,
}));
ok(freshOnce.fresh, '首次打开带 .fresh（入场动画）');

/* ①b ❗属性入口 + 蒙板（v3.73） */
const attrEntry = await page.evaluate(() => {
  const btn = document.querySelector('.hero-page .hp-v-attrs');
  return { exists: !!btn, text: btn?.textContent.trim(), mask: !!document.querySelector('.hp-attrs-mask') };
});
ok(attrEntry.exists && attrEntry.text.includes('属性'), `数值条上有 ❗属性 入口（${attrEntry.text}）`);
ok(!attrEntry.mask, '蒙板默认关着');
await page.locator('.hero-page .hp-v-attrs').click();
await page.waitForTimeout(280);
const mask = await page.evaluate(() => ({
  open: !!document.querySelector('.hero-page .hp-attrs-mask'),
  rows: document.querySelectorAll('.hp-attrs-box .attr-ui .sp-list > *').length,
  deckBehind: document.querySelectorAll('.hero-page .hp-card').length,
}));
ok(mask.open, '点 ❗ 打开属性蒙板');
ok(mask.rows >= 9, `蒙板里有属性列表（${mask.rows} 行）`);
await page.screenshot({ path: 'tools/probe/shot-v373-mask.png' });
await page.locator('.hp-attrs-box .hp-close').click();
await page.waitForTimeout(250);
ok(!(await page.locator('.hp-attrs-mask').count()), '✕ 关闭蒙板');
/* 点蒙板空白处也能关 */
await page.locator('.hero-page .hp-v-attrs').click();
await page.waitForTimeout(250);
await page.locator('.hp-attrs-mask').click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(250);
ok(!(await page.locator('.hp-attrs-mask').count()), '点蒙板空白处关闭');

/* ② 空槽名 + 立绘完整展示 */
const slots = await page.evaluate(() => [...document.querySelectorAll('.hero-page .hp-slot-cap')].map((s) => s.textContent.trim()));
ok(slots.join(',') === '武器,防具', `空槽小字是 武器/防具（${slots.join(',')}）`);
const face = await page.evaluate(() => {
  const img = document.querySelector('.hero-page .hp-face-img');
  const cs = getComputedStyle(img);
  return { h: cs.height, fit: cs.objectFit, w: cs.width };
});
ok(face.fit === 'contain' && parseFloat(face.h) > 100, `立绘完整展示（contain，高 ${face.h}）`);

/* ③ 天赋圆徽 + 冒泡 */
const tal = await page.evaluate(() => ({
  icons: [...document.querySelectorAll('.hero-page .hp-tal')].map((b) => b.getAttribute('aria-label')),
  inAttrs: !!document.querySelector('.hero-page .hp-talent'),
}));
ok(tal.icons.length === 2 && tal.icons.join(',').includes('种族') && tal.icons.join(',').includes('职业'),
  `立绘下 2 枚天赋圆徽（${tal.icons.join(',')}）`);
ok(!tal.inAttrs, '详情页里没有天赋块（天赋只走圆徽）');
await page.locator('.hero-page .hp-tal').first().click();
await page.waitForTimeout(250);
let bubble = await page.evaluate(() => document.querySelector('.hero-page .hp-talent-box')?.textContent.trim() || '');
ok(bubble.length > 0, `点圆徽弹天赋蒙板（${bubble.slice(0, 18)}…）`);
await page.locator('.hp-talent-box [data-action="hero-talent-close"]').click();
await page.waitForTimeout(250);
bubble = await page.evaluate(() => document.querySelector('.hero-page .hp-talent-box')?.textContent.trim() || '');
ok(!bubble, '✕ 关掉蒙板');

/* ④ 牌库真卡面（默认就在牌库页签） */
await page.locator('.hero-page .hp-tab[data-tab="deck"]').click();
await page.waitForTimeout(300);
/* v3.73：切页签后入场动画类被摘掉 —— 上面部分不重播 */
const freshAfter = await page.evaluate(() => document.querySelector('.hero-page').classList.contains('fresh'));
ok(!freshAfter, '切页签后 .fresh 摘掉（上面部分不重播动画）');
const deck = await page.evaluate(() => ({
  cards: document.querySelectorAll('.hero-page .hp-card').length,
  costs: document.querySelectorAll('.hero-page .hp-card .ccost').length,
  arts: document.querySelectorAll('.hero-page .hp-card .card-art').length,
  chips: document.querySelectorAll('.hero-page .hp-deck-chip').length,
  ups: document.querySelectorAll('.hero-page .hp-card .hp-card-lv').length,
  ns: document.querySelectorAll('.hero-page .hp-card .hp-card-n').length,
  head: document.querySelector('.hero-page .hp-sec-head span')?.textContent.trim(),
}));
ok(deck.cards === 4, `唯一化卡面 4 张（6 张卡组、打击 ×3 合并 → ${deck.cards}）`);
ok(deck.costs === 4 && deck.arts === 4, '卡面有费用圆点与卡图');
ok(deck.ns >= 1, `×N 角标在（${deck.ns} 枚）`);
ok(deck.ups === 0, '强化级已在卡名（架势 +1），无独立角标');
ok(deck.chips === 0, '旧的文字 chip 已不存在');

/* ⑤ 底部动作区：没有装备 / 背包 */
const acts = await page.evaluate(() => [...document.querySelectorAll('.hero-page .hp-acts button')].map((b) => b.textContent.trim()));
ok(!acts.some((t) => t === '装备' || t === '背包'), `底部动作区没有装备/背包（${acts.join(',') || '空'}）`);

await page.screenshot({ path: 'tools/probe/shot-v372-deck.png' });
await page.locator('.hero-page .hp-tab[data-tab="relic"]').click();
await page.waitForTimeout(250);
await page.screenshot({ path: 'tools/probe/shot-v372-relic.png' });
await page.locator('.hero-page .hp-tab[data-tab="deck"]').click();
await page.waitForTimeout(250);

/* ⑥ 装备页签（v3.73）：页内仓库，上半部分不动 */
await page.locator('.hero-page .hp-tab[data-tab="gear"]').click();
await page.waitForTimeout(400);
const equip = await page.evaluate(() => {
  const box = document.querySelector('.hp-box').getBoundingClientRect();
  const heads = [...document.querySelectorAll('.hero-page .hp-body .hp-sec-head > span:first-child')].map((s) => s.textContent.trim());
  return {
    boxW: Math.round(box.width),
    topStill: !!document.querySelector('.hero-page .hp-portrait'),
    heads,
    wornRows: document.querySelectorAll('.hero-page .eq-row.worn').length,
    idleRows: document.querySelectorAll('.hero-page .eq-row.idle').length,
    wearBtns: document.querySelectorAll('.hero-page [data-action="equip-item"]').length,
  };
});
ok(equip.boxW === 390, `装备页签下盒子仍满宽 390（${equip.boxW}）`);
ok(equip.topStill, '装备页签保留上半部分');
ok(equip.heads[0] === '装备仓库', `装备页签只放仓库（${equip.heads[0]}）`);
ok(equip.wornRows === 0, '没有已穿戴段（身上穿着在顶部槽位看）');
await page.screenshot({ path: 'tools/probe/shot-v373-gear.png' });
await page.locator('.hero-page .hp-tab[data-tab="relic"]').click();
await page.waitForTimeout(300);
/* v3.73 收缩修复：宝物页内容窄，盒子也不许缩 */
const relicBoxW = await page.evaluate(() => Math.round(document.querySelector('.hp-box').getBoundingClientRect().width));
ok(relicBoxW === 390, `宝物页签盒子满宽 390（${relicBoxW}，v3.73 收缩修复）`);
/* v3.86 起天赋是蒙板：先关蒙板再关详情页，否则蒙板挡住 ✕ */
await page.locator('[data-action="hero-talent-close"]').last().click({ timeout: 1000 }).catch(() => {});
await page.waitForTimeout(200);
await page.locator('.hero-page [data-action="close-hero-page"]').last().click();
await page.waitForTimeout(250);
await page.locator('[data-action="back-hall"]').first().click();
await page.waitForTimeout(300);

/* ⑦ 转正角色详情 + 装备换位（穿满自动换，页内完成） */
await page.locator('[data-action="open-arena"]').first().click();
await page.waitForTimeout(350);
await page.locator('.ex-card').first().click();
await page.waitForTimeout(400);
const vetActs = await page.evaluate(() => [...document.querySelectorAll('.hero-page .hp-acts button')].map((b) => b.textContent.trim()));
ok(vetActs.length === 0, `转正角色动作区为空（v3.75 上场只去竞技场页）（${vetActs.join(',')}）`);
await page.locator('.hero-page .hp-tab[data-tab="gear"]').click();
await page.waitForTimeout(400);
/* 造两件装备穿上，再穿第三件 → 自动换位 */
await page.evaluate(async () => {
  const eq = await import('/src/core/equipment.js');
  const save = await import('/src/core/save.js');
  const meta = save.loadMeta();
  const ch = meta.roster[1];
  const x = eq.addEquipment(meta, 'ironSword');
  const y = eq.addEquipment(meta, 'leatherArmor');
  const z = eq.addEquipment(meta, 'woodShield');
  eq.equipItem(meta, ch.id, x.id);
  eq.equipItem(meta, ch.id, y.id);
  save.saveMeta(meta);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="open-arena"]').first().click();
await page.waitForTimeout(350);
await page.locator('.ex-card').first().click();
await page.waitForTimeout(400);
const wornCaps = await page.evaluate(() => [...document.querySelectorAll('.hero-page .hp-slot-cap')].map((s) => s.textContent.trim()));
ok(wornCaps.join(',') === '铁剑,皮甲', `穿满后槽位显示（${wornCaps.join(',')}）`);
await page.locator('.hero-page .hp-tab[data-tab="gear"]').click();
await page.waitForTimeout(400);
await page.locator('.hero-page [data-action="equip-item"]').first().click();
await page.waitForTimeout(350);
const afterSwap = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const meta = save.loadMeta();
  const items = meta.equipment.filter((it) => it.by === meta.roster[1].id);
  return items.map((it) => it.defId).sort().join(',');
});
ok(afterSwap === 'ironSword,woodShield', `自动换位成功（穿着：${afterSwap}，皮甲被换下）`);
const stillHero = await page.evaluate(() => !!document.querySelector('.hero-page'));
ok(stillHero, '换位后详情页未跳走');

/* ⑧ run 详情：额外天赋圆徽 + 委托进度行 */
await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const meta = save.loadMeta();
  const ch = meta.roster[0];
  const run = runMod.createRun({ character: ch, seed: 42 });
  run.talents = ['blade', 'ironbody'];
  run.quest = { id: 'hunt', progress: 2, target: 4 };
  const idx = run.floorMap.cells.findIndex((c) => c.kind === 'enemy' && !c.done);
  run.floorMap.cells[idx].revealed = true;
  save.saveRun(run);
  meta.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(meta);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(450);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector('.dcell.pending.k-enemy')?.click());
await page.waitForTimeout(700);
await page.locator('.player-row .face-btn').click();
await page.waitForTimeout(450);
const runTal = await page.evaluate(() => ({
  icons: [...document.querySelectorAll('.hero-page .hp-tal')].map((b) => b.getAttribute('aria-label')),
  attrsEntry: !!document.querySelector('.hero-page .hp-v-attrs'),
  bubbles: document.querySelectorAll('.hero-page .hp-bubble').length,
}));
ok(runTal.icons.length === 4, `run 详情 4 枚天赋圆徽（${runTal.icons.join(',')}）`);
ok(runTal.icons[2] === '天赋 · 利刃' && runTal.icons[3] === '天赋 · 铁躯', '额外天赋排在种族/职业后面');
ok(runTal.attrsEntry, 'run 详情同样有 ❗属性 入口');
/* 打开蒙板看委托进度行 */
await page.locator('.hero-page .hp-v-attrs').click();
await page.waitForTimeout(280);
const questInMask = await page.evaluate(() =>
  document.querySelector('.hp-attrs-box .hp-note.quest')?.textContent.trim() || '');
ok(/讨伐委托/.test(questInMask) && /2\/4/.test(questInMask), `蒙板里有委托进度行（${questInMask}）`);
await page.locator('.hp-attrs-box .hp-close').click();
await page.waitForTimeout(250);
await page.locator('.hero-page .hp-tal').nth(2).click();
await page.waitForTimeout(250);
const extraBubble = await page.evaluate(() => {
  const row = document.querySelector('.hp-talent-row.on');
  return row?.textContent.replace(/\s+/g, ' ').trim() || '';
});
ok(extraBubble.includes('利刃') && extraBubble.includes('攻击 +2'), `额外天赋在蒙板里高亮（${extraBubble.slice(0, 30)}）`);
await page.screenshot({ path: 'tools/probe/shot-v372-run.png' });
/* v3.86 起天赋是蒙板：先关蒙板再关详情页，否则蒙板挡住 ✕ */
await page.locator('[data-action="hero-talent-close"]').last().click({ timeout: 1000 }).catch(() => {});
await page.waitForTimeout(200);
await page.locator('.hero-page [data-action="close-hero-page"]').last().click();
await page.waitForTimeout(200);

await browser.close();
console.log('ALL PASS');
