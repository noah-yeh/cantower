/**
 * v3.85 探针：委托板改成「接受 / 婉拒」页 + 前 6 层限制 + 一局 3 份。
 *
 * 用户：「任务委托只会在前面6层出现，可以拒绝，最多一局可以接受3个任务，
 * 可以多做一些天赋给不同的任务」。
 *
 * 检查：
 *   ① 踩委托板 → 委托页（.quest-page）：名字 / 目标 / 奖励天赋池 / 两个按钮；
 *   ② 点婉拒 → 回地图，横幅写「婉拒」，没接到委托、已接份数不变；
 *   ③ 再踩一块板 → 点接受 → 回地图，横幅写「接下」，run.quest 写入、份数 +1；
 *   ④ 详情页属性蒙板里的委托进度行用新名字；
 *   ⑤ 第 7 层起生成的地图里没有委托板（core 规则，浏览器里抽样 30 次）；
 *   ⑥ 390 与 375×600 矮屏都不溢出。
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

/**
 * 造 run：第 3 层，地图上两格强制改成委托板（都翻开）。
 * 一局默认 questsTaken=0，两份都能接/拒。
 */
await page.evaluate(async () => {
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
  run.floor = 3;
  dungeon.makeFloorMap(run);
  const cells = run.floorMap.cells;
  const spots = cells
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.kind === 'empty' && !c.data && !c.done)
    .slice(0, 2);
  spots.forEach(({ c }) => {
    c.kind = 'event';
    c.data = { event: 'herald' };
    c.revealed = true;
  });
  run.phase = 'map';
  save.saveRun(run);
  m.run = { characterId: a.id, floor: run.floor };
  save.saveMeta(m);
  /** reload 会清掉 window.*，索引写 localStorage 才留得住 */
  localStorage.setItem('probe_heralds', JSON.stringify(spots.map((s) => s.i)));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(450);
await page.locator('[data-action="maze-guide-ok"]').first().click().catch(() => {});
await page.waitForTimeout(250);

/* ---- ① 踩委托板 → 委托页 ---- */
await page.evaluate(() => {
  const idx = JSON.parse(localStorage.getItem('probe_heralds') || '[]');
  document.querySelectorAll('.dcell')[idx[0]]?.click();
});
await page.waitForTimeout(500);
const quest = await page.evaluate(() => {
  const p = document.querySelector('.quest-page');
  return {
    open: !!p,
    title: p?.querySelector('h1')?.textContent.trim(),
    sub: p?.querySelector('.sub')?.textContent.trim(),
    name: p?.querySelector('.qo-name')?.textContent.trim(),
    goal: p?.querySelector('.qo-goal')?.textContent.trim(),
    reward: p?.querySelector('.qo-reward')?.textContent.replace(/\s+/g, '').trim(),
    pool: p?.querySelector('.qo-pool')?.textContent.replace(/\s+/g, '').trim(),
    accept: !!p?.querySelector('[data-action="quest-accept"]'),
    decline: !!p?.querySelector('[data-action="quest-decline"]'),
    overflow: p ? p.scrollHeight - p.clientHeight : -1,
  };
});
console.log('委托页:', JSON.stringify(quest));
ok(quest.open, '踩委托板进入委托页（不是触发即接单）');
ok(quest.title === '委托板', `标题：${quest.title}`);
ok(/已接 0 \/ 3/.test(quest.sub || ''), `份数提示：${quest.sub}`);
ok(!!quest.name && !!quest.goal, `委托内容：${quest.name} · ${quest.goal}`);
ok(/×1/.test(quest.reward || ''), `奖励行：${quest.reward}`);
ok((quest.pool || '').includes('·'), `奖励天赋池：${quest.pool}`);
ok(quest.accept && quest.decline, '接受 / 婉拒两个按钮都在');
await page.screenshot({ path: 'tools/probe/v385-quest.png' });

/* ---- ② 婉拒 → 回地图 ---- */
await page.locator('[data-action="quest-decline"]').click();
await page.waitForTimeout(450);
const declined = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return {
    screenMap: !!document.querySelector('.dmap'),
    questPage: !!document.querySelector('.quest-page'),
    note: document.querySelector('.dnote')?.textContent.replace(/\s+/g, ' ').trim() || '',
    quest: run?.quest || null,
    taken: run?.questsTaken ?? -1,
  };
});
console.log('婉拒后:', JSON.stringify(declined));
ok(declined.screenMap && !declined.questPage, '婉拒后回到地图');
ok(/婉拒/.test(declined.note), `横幅报婉拒：${declined.note}`);
ok(declined.quest === null, '没有接到委托');
ok(declined.taken === 0, `婉拒不算接过（questsTaken=${declined.taken}）`);
await page.screenshot({ path: 'tools/probe/v385-declined.png' });

/* ---- ③ 再踩一块 → 接受 ---- */
await page.evaluate(() => {
  const idx = JSON.parse(localStorage.getItem('probe_heralds') || '[]');
  document.querySelectorAll('.dcell')[idx[1]]?.click();
});
await page.waitForTimeout(450);
const acceptPresent = await page.evaluate(() => !!document.querySelector('[data-action="quest-accept"]'));
ok(acceptPresent, '第二块委托板还能看委托');
await page.locator('[data-action="quest-accept"]').click();
await page.waitForTimeout(450);
const accepted = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  return {
    screenMap: !!document.querySelector('.dmap'),
    note: document.querySelector('.dnote')?.textContent.replace(/\s+/g, ' ').trim() || '',
    quest: run?.quest || null,
    taken: run?.questsTaken ?? -1,
  };
});
console.log('接受后:', JSON.stringify(accepted));
ok(accepted.screenMap, '接受后回到地图');
ok(/接下/.test(accepted.note), `横幅报接下：${accepted.note}`);
ok(accepted.quest && accepted.quest.progress === 0, `委托写入：${accepted.quest?.name}`);
ok(accepted.taken === 1, `已接份数 +1（${accepted.taken}）`);
await page.screenshot({ path: 'tools/probe/v385-accepted.png' });

/* ---- ④ 详情页委托进度行 ---- */
await page.locator('[data-action="open-hero"]').first().click();
await page.waitForTimeout(400);
await page.locator('[data-action="hero-attrs"]').click();
await page.waitForTimeout(350);
const heroQuest = await page.evaluate(() => ({
  text: document.querySelector('.hp-note.quest')?.textContent.replace(/\s+/g, ' ').trim() || '',
}));
console.log('详情页委托行:', JSON.stringify(heroQuest));
ok(new RegExp(accepted.quest?.name || '委托').test(heroQuest.text), `进度行用新名字：${heroQuest.text}`);
await page.screenshot({ path: 'tools/probe/v385-hero-quest.png' });
await page.locator('[data-action="close-hero-page"]').first().click().catch(() => {});

/* ---- ⑤ 第 7 层起没有委托板 ---- */
const floorRule = await page.evaluate(async () => {
  const dungeon = await import('/src/core/dungeon.js');
  const runMod = await import('/src/core/run.js');
  const roster = await import('/src/core/roster.js');
  const a = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 9 });
  let early = 0;
  let late = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const r1 = runMod.createRun({ character: a, seed });
    r1.floor = 1;
    dungeon.makeFloorMap(r1);
    if (r1.floorMap.cells.some((c) => c.kind === 'event' && c.data?.event === 'herald')) early++;
    const r2 = runMod.createRun({ character: a, seed });
    r2.floor = 9;
    dungeon.makeFloorMap(r2);
    if (r2.floorMap.cells.some((c) => c.kind === 'event' && c.data?.event === 'herald')) late++;
  }
  return { early, late };
});
console.log('层数限制:', JSON.stringify(floorRule));
ok(floorRule.early > 0, `第 1 层会出委托板（30 种子 ${floorRule.early} 次）`);
ok(floorRule.late === 0, `第 9 层一次都不出（${floorRule.late}）`);

/* ---- ⑥ 矮屏 ---- */
const before = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  const cell = run.floorMap.cells.find((c) => !c.done && c.kind === 'empty') || run.floorMap.cells.find((c) => !c.done);
  cell.kind = 'event';
  cell.data = { event: 'herald' };
  cell.revealed = true;
  run.phase = 'map';
  run.quest = null;
  run.questsTaken = 0;
  save.saveRun(run);
  return run.floorMap.cells.indexOf(cell);
});
await page.setViewportSize({ width: 375, height: 600 });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(450);
await page.evaluate((i) => document.querySelectorAll('.dcell')[i]?.click(), before);
await page.waitForTimeout(500);
const small = await page.evaluate(() => {
  const p = document.querySelector('.quest-page');
  if (!p) return { open: false };
  const acts = p.querySelector('.qo-acts');
  const r = acts.getBoundingClientRect();
  return {
    open: true,
    overflow: p.scrollHeight - p.clientHeight,
    actsBottom: Math.round(r.bottom),
    viewH: window.innerHeight,
    declineVisible: !!p.querySelector('[data-action="quest-decline"]'),
  };
});
console.log('矮屏委托页:', JSON.stringify(small));
ok(small.open, '375×600 委托页正常打开');
ok(small.overflow <= 1, `矮屏不滚动（溢出 ${small.overflow}）`);
ok(small.actsBottom <= small.viewH && small.declineVisible, `两个按钮都在视口内（底 ${small.actsBottom}/${small.viewH}）`);
await page.screenshot({ path: 'tools/probe/v385-small.png' });

await browser.close();
console.log('PROBE DONE');
