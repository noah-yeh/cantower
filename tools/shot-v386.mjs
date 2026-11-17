/**
 * v3.86 探针：天赋改蒙板 + 委托页列出天赋效果 + 委托板扩到前 8 层。
 *
 * 用户：「角色详情页点击天赋应该是弹出蒙板提示框，不要往下挤；另外现在委托版的
 * 天赋查看不了是什么效果呀，可以再增加一些天赋池，扩展到前8层都有机会遇到」。
 *
 * 检查：
 *   ① 点天赋圆徽 → 天赋蒙板出现，且**页面不位移**（数值条 / 页签位置不变）；
 *   ② 蒙板里把全部天赋列全、点的那枚高亮、每条都写着效果数值；
 *   ③ ✕ 关掉蒙板后回到原样；
 *   ④ 委托页候选天赋逐条写出效果（5 条，带图标 + 数值）；
 *   ⑤ 375×600 矮屏：委托页与天赋蒙板都不溢出；
 *   ⑥ 前 8 层会出委托板、第 9 层起不出（core 抽样）。
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

/** 造一趟带两枚额外天赋的探险（天赋圆徽要多于种族/职业两枚才看得出蒙板是"列全"） */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const dungeon = await import('/src/core/dungeon.js');
  const T = await import('/src/core/talents.js');
  const m = meta.createMeta(20261112);
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  a.status = 'exploring';
  m.roster = [a];
  const run = runMod.createRun({ character: a, seed: 777 });
  run.floor = 3;
  dungeon.makeFloorMap(run);
  /** 两枚真实申请过的天赋：数值也真加到 player 上，跟玩家看到的对得上 */
  run.talents = ['valor', 'mend'];
  run.talents.forEach((id) => T.EXTRA_TALENTS[id].apply(run.player));
  run.phase = 'map';
  save.saveRun(run);
  m.run = { characterId: a.id, floor: run.floor };
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(450);
await page.locator('[data-action="maze-guide-ok"]').first().click().catch(() => {});
await page.waitForTimeout(250);

/* ---- ① 打开角色详情，点天赋 ---- */
await page.locator('[data-action="open-hero"]').first().click();
await page.waitForTimeout(400);
const before = await page.evaluate(() => {
  const v = document.querySelector('.hp-vitals')?.getBoundingClientRect();
  const t = document.querySelector('.hp-tabs')?.getBoundingClientRect();
  return { vitals: Math.round(v?.top ?? -1), tabs: Math.round(t?.top ?? -1), icons: document.querySelectorAll('.hp-tal').length };
});
console.log('点之前:', JSON.stringify(before));
await page.locator('.hp-tal.extra').first().click();
await page.waitForTimeout(350);
const maskOpen = await page.evaluate(() => {
  const box = document.querySelector('.hp-talent-box');
  const v = document.querySelector('.hp-vitals')?.getBoundingClientRect();
  const t = document.querySelector('.hp-tabs')?.getBoundingClientRect();
  const rows = [...(box?.querySelectorAll('.hp-talent-row') || [])];
  return {
    open: !!box,
    vitals: Math.round(v?.top ?? -1),
    tabs: Math.round(t?.top ?? -1),
    rows: rows.length,
    onCount: rows.filter((r) => r.classList.contains('on')).length,
    onName: rows.find((r) => r.classList.contains('on'))?.querySelector('b')?.textContent.trim() || '',
    items: rows.map((r) => ({
      name: r.querySelector('b')?.textContent.trim(),
      text: r.querySelector('.hp-talent-txt span')?.textContent.replace(/\s+/g, ' ').trim(),
    })),
  };
});
console.log('天赋蒙板:', JSON.stringify(maskOpen));
ok(maskOpen.open, '点天赋弹出蒙板');
ok(maskOpen.vitals === before.vitals && maskOpen.tabs === before.tabs,
  `页面没有往下挤（数值条 ${before.vitals}→${maskOpen.vitals} / 页签 ${before.tabs}→${maskOpen.tabs}）`);
ok(maskOpen.rows === before.icons, `蒙板把所有天赋列全（${maskOpen.rows} 条 / ${before.icons} 枚圆徽）`);
ok(maskOpen.onCount === 1 && /勇武|愈合/.test(maskOpen.onName), `点的那枚高亮：${maskOpen.onName}`);
ok(maskOpen.items.every((i) => i.name && /[0-9]/.test(i.text || '')), '每条都写着效果数值：'
  + maskOpen.items.map((i) => `${i.name}=${i.text}`).join(' / '));
await page.screenshot({ path: 'tools/probe/v386-talent-mask.png' });

/* ---- ② ✕ 关掉 ---- */
await page.locator('.hp-talent-box [data-action="hero-talent-close"]').first().click();
await page.waitForTimeout(300);
const closed = await page.evaluate(() => ({
  mask: !!document.querySelector('.hp-talent-box'),
  vitals: Math.round(document.querySelector('.hp-vitals')?.getBoundingClientRect().top ?? -1),
}));
ok(!closed.mask, '✕ 关掉蒙板');
ok(closed.vitals === before.vitals, `关掉后页面回原位（${closed.vitals}）`);

/* ---- ③ 矮屏下蒙板 ---- */
await page.setViewportSize({ width: 375, height: 600 });
await page.waitForTimeout(350);
await page.locator('.hp-tal.extra').first().click();
await page.waitForTimeout(300);
const smallMask = await page.evaluate(() => {
  const box = document.querySelector('.hp-talent-box');
  if (!box) return { open: false };
  const r = box.getBoundingClientRect();
  return {
    open: true,
    scrolls: box.scrollHeight - box.clientHeight,
    top: Math.round(r.top),
    bottom: Math.round(r.bottom),
    viewH: window.innerHeight,
    closeVisible: !!box.querySelector('[data-action="hero-talent-close"]'),
  };
});
console.log('矮屏蒙板:', JSON.stringify(smallMask));
ok(smallMask.open && smallMask.top >= 0 && smallMask.bottom <= smallMask.viewH && smallMask.closeVisible,
  `375×600 蒙板完整在视口内（${smallMask.top}~${smallMask.bottom}/${smallMask.viewH}）`);
await page.screenshot({ path: 'tools/probe/v386-talent-small.png' });
await page.locator('.hp-talent-box [data-action="hero-talent-close"]').first().click().catch(() => {});
await page.locator('[data-action="close-hero-page"]').first().click().catch(() => {});
await page.waitForTimeout(300);

/* ---- ④ 委托页：候选天赋带效果 ---- */
await page.setViewportSize({ width: 390, height: 800 });
const cellIdx = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  const cell = run.floorMap.cells.find((c) => !c.done && c.kind === 'empty')
    || run.floorMap.cells.find((c) => !c.done);
  cell.kind = 'event';
  cell.data = { event: 'herald' };
  cell.revealed = true;
  run.phase = 'map';
  run.quest = null;
  run.questsTaken = 0;
  save.saveRun(run);
  return run.floorMap.cells.indexOf(cell);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(450);
await page.evaluate((i) => document.querySelectorAll('.dcell')[i]?.click(), cellIdx);
await page.waitForTimeout(500);

const quest = await page.evaluate(() => {
  const p = document.querySelector('.quest-page');
  const rows = [...(p?.querySelectorAll('.qo-pool-row') || [])];
  const card = p?.querySelector('.quest-offer');
  return {
    open: !!p,
    name: p?.querySelector('.qo-name')?.textContent.trim(),
    cap: p?.querySelector('.qo-pool-cap')?.textContent.replace(/\s+/g, '').trim(),
    rows: rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    overflow: p ? p.scrollHeight - p.clientHeight : -1,
    cardOverflow: card ? card.scrollHeight - card.clientHeight : -1,
    hint: p?.querySelector('.hint')?.textContent.trim() || '',
  };
});
console.log('委托页天赋池:', JSON.stringify(quest));
ok(quest.open, '委托页正常打开');
ok(quest.rows.length === 5, `候选天赋 5 条（${quest.rows.length}）`);
ok(quest.rows.every((t) => /[0-9]/.test(t)), '每条都带效果数值：' + quest.rows.join(' | '));
ok(/随机一枚/.test(quest.cap || ''), `说明行：${quest.cap}`);
ok(quest.overflow <= 1 && quest.cardOverflow <= 1, `委托页与卡片都不溢出（${quest.overflow} / ${quest.cardOverflow}）`);
ok(/前 8 层/.test(quest.hint), `提示写清楼层上限：${quest.hint}`);
await page.screenshot({ path: 'tools/probe/v386-quest.png' });

/* ---- ⑤ 矮屏委托页 ---- */
await page.setViewportSize({ width: 375, height: 600 });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(450);
await page.evaluate((i) => document.querySelectorAll('.dcell')[i]?.click(), cellIdx);
await page.waitForTimeout(500);
const smallQuest = await page.evaluate(() => {
  const p = document.querySelector('.quest-page');
  if (!p) return { open: false };
  const acts = p.querySelector('.qo-acts')?.getBoundingClientRect();
  return {
    open: true,
    overflow: p.scrollHeight - p.clientHeight,
    actsBottom: Math.round(acts?.bottom ?? -1),
    viewH: window.innerHeight,
  };
});
console.log('矮屏委托页:', JSON.stringify(smallQuest));
ok(smallQuest.open && smallQuest.overflow <= 1 && smallQuest.actsBottom <= smallQuest.viewH,
  `375×600 委托页不滚动、按钮在视口内（${smallQuest.actsBottom}/${smallQuest.viewH}）`);
await page.screenshot({ path: 'tools/probe/v386-quest-small.png' });

/* ---- ⑥ 前 8 层 / 第 9 层 ---- */
const floorRule = await page.evaluate(async () => {
  const dungeon = await import('/src/core/dungeon.js');
  const runMod = await import('/src/core/run.js');
  const roster = await import('/src/core/roster.js');
  const T = await import('/src/core/talents.js');
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 9 });
  const hit = (floor) => {
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = runMod.createRun({ character: a, seed });
      r.floor = floor;
      dungeon.makeFloorMap(r);
      if (r.floorMap.cells.some((c) => c.kind === 'event' && c.data?.event === 'herald')) n++;
    }
    return n;
  };
  return { f1: hit(1), f7: hit(7), f8: hit(8), f9: hit(9), maxFloor: T.QUEST_MAX_FLOOR, talents: Object.keys(T.EXTRA_TALENTS).length };
});
console.log('楼层规则:', JSON.stringify(floorRule));
ok(floorRule.maxFloor === 8, `QUEST_MAX_FLOOR = ${floorRule.maxFloor}`);
ok(floorRule.f7 > 0 && floorRule.f8 > 0, `第 7 / 8 层都会出（${floorRule.f7} / ${floorRule.f8}）`);
ok(floorRule.f9 === 0, `第 9 层一次都不出（${floorRule.f9}）`);
ok(floorRule.talents >= 21, `额外天赋 ${floorRule.talents} 枚`);

await browser.close();
console.log('PROBE DONE');
