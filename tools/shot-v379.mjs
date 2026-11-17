/**
 * v3.79 探针：探索页（迷宫地图）详情入口 + 去掉下方宝物条
 *
 * 要证的五件事：
 *   1. 地图页顶栏有「详情」按钮（open-hero），点开 = 完整角色详情页（run 模式）
 *   2. 详情页里牌库 / 宝物页签能切，宝物页签能看到本局宝物
 *   3. 地图页不再渲染 relic-bar（v3.79 用户：探索页面下方不需要展示宝物）
 *   4. 战斗页保持原样：顶栏「属性」快面板（open-run-stats）+ 头像开详情（open-hero）
 *   5. 详情页 ✕ 关掉后回到地图，全程控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? 'OK ' : 'ERR'} ${msg}`); };

/* ---- 造角色出发 ---- */
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = save.loadMeta() || meta.createMeta(20261112);
  const ch = roster.createCharacter({ classId: 'hunter', raceId: 'stone', seed: 5 });
  ch.veteran = false;
  ch.status = 'idle';
  ch.lives = 3;
  m.roster = [ch];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-action="open-expedition"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-action="explore"], [data-action="pick-expedition"]')?.click());
await page.waitForTimeout(550);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);

/* ---- 1. 地图页详情入口（v3.81 起顶栏「详情」撤掉，入口 = 底部角色行头像） ---- */
const entry = await page.evaluate(() => {
  const b = document.querySelector('.dtray .dhero');
  return b ? 'dhero' : null;
});
ok(entry === 'dhero', '地图底部有角色行头像作为详情入口');

await page.evaluate(() => document.querySelector('.dtray .dhero')?.click());
await page.waitForTimeout(350);
ok(await page.locator('.overlay.hero-page').count() > 0, '点「详情」打开角色详情页');
ok(await page.locator('.hp-tal').count() > 0, '详情页有天赋圆徽（上半区）');

/* ---- 2. 牌库 / 宝物页签可切 ---- */
await page.evaluate(() => document.querySelector('[data-action="hero-tab"][data-tab="relic"]')?.click());
await page.waitForTimeout(250);
const relicTab = await page.evaluate(() => ({
  on: !!document.querySelector('.hp-body'),
  text: document.querySelector('.hp-body')?.textContent.replace(/\s+/g, ' ').slice(0, 60),
}));
ok(relicTab.on, '宝物页签能打开');
ok(/已激活|待激活/.test(relicTab.text || ''), `宝物页签内容正常（v3.84 首行直接是已激活：${relicTab.text}…）`);

/* ---- 3. 地图页没有 relic-bar ---- */
await page.evaluate(() => document.querySelector('.hp-close')?.click());
await page.waitForTimeout(300);
ok(await page.locator('.overlay.hero-page').count() === 0, '✕ 关掉详情页回到地图');
const noRelicBar = await page.evaluate(() => ({
  bar: document.querySelectorAll('.dmap-wrap .relic-bar, .relic-bar').length,
  tray: !!document.querySelector('.dtray'),
}));
ok(noRelicBar.bar === 0, `地图页已无宝物条（found ${noRelicBar.bar}）`);
ok(noRelicBar.tray, '底部托盘还在（背包 / 放弃）');

/* ---- 4. 进战斗：战斗页保持「属性」快面板 + 头像详情 ---- */
for (let step = 0; step < 60; step++) {
  if (await page.locator('.hand .card').count()) break;
  const st = await page.evaluate(() => {
    if (document.querySelector('[data-action="leave-shop"]')) { document.querySelector('[data-action="leave-shop"]')?.click(); return 'shop'; }
    if (document.querySelector('[data-action="choose"]')) { document.querySelector('[data-action="choose"]')?.click(); return 'choose'; }
    if (document.querySelector('[data-action="cancel-upgrade"]')) { document.querySelector('[data-action="cancel-upgrade"]')?.click(); return 'up'; }
    if (document.querySelector('.dcell.pending.k-enemy')) { document.querySelector('.dcell.pending.k-enemy')?.click(); return 'enemy'; }
    if (document.querySelector('.dcell.reach')) { document.querySelector('.dcell.reach')?.click(); return 'reach'; }
    if (document.querySelector('.dcell.pending')) { document.querySelector('.dcell.pending')?.click(); return 'pend'; }
    return null;
  });
  if (!st) break;
  await page.waitForTimeout(320);
}
const inBattle = await page.locator('.hand .card').count() > 0;
ok(inBattle, '进入了战斗');
if (inBattle) {
  const battleTop = await page.evaluate(() => ({
    stats: !!document.querySelector('.topbar [data-action="open-run-stats"]'),
    face: !!document.querySelector('[data-action="open-hero"]'),
  }));
  ok(battleTop.stats, '战斗页顶栏保留「属性」快面板入口');
  ok(battleTop.face, '战斗页玩家头像仍开完整详情');

  await page.evaluate(() => document.querySelector('.topbar [data-action="open-run-stats"]')?.click());
  await page.waitForTimeout(250);
  ok(await page.locator('.stats-panel').count() > 0, '战斗页「属性」打开快面板');
  await page.evaluate(() => document.querySelector('.sp-close')?.click());
  await page.waitForTimeout(250);
  ok(await page.locator('.stats-panel').count() === 0, '快面板 ✕ 能关');
}

ok(errs.length === 0, `控制台零报错（${errs.join(' | ') || 'clean'}）`);
await page.screenshot({ path: 'tools/probe/v379-map.png' });
await browser.close();
if (fails.length) { console.log('FAIL:\n- ' + fails.join('\n- ')); process.exit(1); }
console.log('PROBE PASS');
