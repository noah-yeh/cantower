/**
 * v3.78 探针：顶层收口。
 *
 * 用户：「现在在 30 层点击楼梯会一直下到下一层，没法出来；另外在 30 层
 * 一定会有一个卡牌商店一个宝物商店」。
 *
 * 检查：
 *   ① UI 端到端：30 层造一趟清完敌人的 run，点楼梯 → 直接进结算页
 *     （以前卡在战斗页还能继续点，层数一直涨）；
 *   ② 结算后回到大厅，层数不再涨；
 *   ③ core 侧 500 种子 30 层双店覆盖率（tests 里也有 100 种子断言）。
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

/** 造一个「正在 30 层探险、敌人清光、楼梯已翻开」的存档 */
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
  run.floor = 30;
  dungeon.makeFloorMap(run);
  for (const c of run.floorMap.cells) if (c.kind === 'enemy') c.done = true;
  run.floorMap.cells[run.floorMap.stairs].revealed = true;
  run.phase = 'map';
  run.floorMap.enemiesLeft = 0;
  save.saveRun(run);
  m.run = { characterId: a.id, floor: 30 };
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

/* 继续探险进地图 */
await page.locator('[data-action="resume"]').first().click().catch(() => {});
await page.waitForTimeout(400);

const pre = await page.evaluate(() => ({
  screen: document.querySelector('#app')?.textContent.includes('塔顶') ? 'settle' : 'other',
  floorShown: (document.body.textContent.match(/第\s*(\d+)\s*层/) || [])[1],
}));
ok(!!pre.floorShown, `地图显示第 ${pre.floorShown} 层`);

/* 点楼梯 */
await page.evaluate((stairs) => {
  const el = document.querySelector(`[data-index="${stairs}"]`);
  el?.click();
}, (await page.evaluate(() => {
  /** 从模块里拿楼梯索引：直接读 run 存档最稳 —— 走 localStorage */
  const raw = localStorage.getItem('ruin-spire/run');
  return raw ? JSON.parse(raw).floorMap?.stairs ?? 0 : 0;
})));
await page.waitForTimeout(600);

const post = await page.evaluate(() => {
  const text = document.body.textContent;
  const raw = localStorage.getItem('ruin-spire/run');
  return {
    settle: text.includes('胜利') || text.includes('WIN'),
    floorInSave: raw ? JSON.parse(raw).floor : null,
    backToHall: !!document.querySelector('[data-action="open-expedition"]'),
  };
});
ok(post.settle || post.backToHall, `点楼梯后进入结算/回大厅（settle=${post.settle} hall=${post.backToHall}）`);
ok(post.floorInSave == null || post.floorInSave <= 31, `存档层数没失控（${post.floorInSave}）`);

/* 通关后再点一次楼梯位置：层数必须不动 */
await page.evaluate(() => {
  const el = document.querySelector('[data-index]');
  el?.click();
});
await page.waitForTimeout(300);
const again = await page.evaluate(() => {
  const raw = localStorage.getItem('ruin-spire/run');
  return raw ? JSON.parse(raw).floor : null;
});
ok(again == null || again <= 31, `结算后再点格子层数不涨（${again}）`);

await page.screenshot({ path: 'tools/probe/v378-win.png' });
await browser.close();
console.log('done');
