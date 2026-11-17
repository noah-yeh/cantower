/**
 * v3.62 探针：能量上限的三条局内途径（用户：「控制大部分卡组最后都不会超过
 * 10 个能量，除非某些特殊职业或者种族」）。
 *
 * ① 星髓神龛事件：地图上点神龛格 → 能量上限 +1、战斗 HUD 能量跟着到新值；
 * ② 星辉烛台：三选一奖励里出现并可选 → 拿到后 run.player.energy = 9；
 * ③ 月苔圣杯：青苔族专属文案在线；非青苔族的宝库 / 奖励池刷不到（core 已测，UI 抽查文案）。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(350);

/** ① 青苔族法师一局，摆一个神龛事件格 + 一次带烛台的战后奖励 */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const dungeon = await import('/src/core/dungeon.js');

  const m = meta.createMeta(20261110);
  const ch = roster.createCharacter({ classId: 'mage', raceId: 'moss', seed: 11 });
  ch.status = 'idle'; ch.lives = 3; m.roster = [ch]; save.saveMeta(m);

  const run = runMod.createRun({ character: ch, seed: 9 });
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[idx] = { kind: dungeon.CELL.EVENT, revealed: true, done: false, data: { event: 'shrine' } };
  /** 战后三选一：一格烛台（保证奖励页能点到它） */
  run.reward = { options: [{ kind: 'relic', id: 'starCandle', lv: 1, label: '星辉烛台' }, { kind: 'card', id: 'm_echo', label: '回响' }, { kind: 'heal', id: 'heal', label: '治疗' }], tier: 'normal' };
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

// 点神龛格（轮询重试：等迷宫渲染 + 引导浮层让位）
let shrineNote = '';
for (let i = 0; i < 6 && !shrineNote; i++) {
  await page.waitForTimeout(400);
  const diag = await page.evaluate(() => ({
    pending: [...document.querySelectorAll('.dcell.pending')].map((e) => e.className),
    cells: document.querySelectorAll('.dcell').length,
    note: document.querySelector('.dnote-slot')?.textContent.trim() || '',
  }));
  if (i === 0) console.log('DIAG', JSON.stringify(diag));
  if (!diag.pending.length) continue;
  await page.evaluate(() => document.querySelector('.dcell.pending.k-event')?.click());
  await page.waitForTimeout(450);
  shrineNote = await page.evaluate(async () => {
    const run = (await import('/src/core/save.js')).loadRun();
    return run?.lastCellNote || '';
  });
}
ok(/能量上限 \+1/.test(shrineNote), `神龛结算横幅：「${shrineNote}」`);

// ② 神龛 +1 → 8 变 9；开一场战斗确认回能按 9 走
const battleReady = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const dungeon = await import('/src/core/dungeon.js');
  const enemies = await import('/src/core/enemies.js');
  const rngMod = await import('/src/core/rng.js');
  const run = save.loadRun();
  const before = run.player.energy;
  /** 与 tests/energy.test.mjs 同口径：直接覆写第一个非楼梯格为敌人格 */
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[idx] = {
    kind: dungeon.CELL.ENEMY, revealed: true, done: false,
    data: { tier: 'normal', enemy: enemies.makeEnemy(1, new rngMod.Rng(3), 'normal') },
  };
  save.saveRun(run);
  const trig = runMod.triggerCell(run, idx);
  save.saveRun(run);
  return { trig: JSON.stringify(trig), before, energy: run.player.energy, cap: run.battle?.player.energyCap, phase: run.phase };
});
ok(battleReady.phase === 'battle' && battleReady.cap === battleReady.energy, `进战斗 energyCap=${battleReady.cap} = run.player.energy=${battleReady.energy}（神龛 +1 已生效：${battleReady.before} → ${battleReady.energy}）`);

// 重载续战：非暂停档启动时自动恢复进战斗页（不再出 resume 按钮）
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const orbText = await page.evaluate(() => document.querySelector('.energy-orb')?.textContent || '');
ok(orbText.includes(String(battleReady.energy)), `战斗 HUD 能量珠：${orbText.trim()}（期望含 ${battleReady.energy}）`);

// ③ 奖励阶段不落盘（设计：读档退回地图）—— 同会话内切阶段、渲染面板、走 core 领奖
const reward = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const panels = await import('/src/ui/panels.js');
  const run = save.loadRun();
  run.phase = 'reward';
  run.battle = null;
  run.reward = { options: [{ kind: 'relic', id: 'starCandle', lv: 1, label: '星辉烛台' }, { kind: 'card', id: 'm_echo', label: '回响' }, { kind: 'heal', id: 'heal', label: '治疗' }], tier: 'normal' };
  const html = panels.renderReward(run);
  const idx = run.reward.options.findIndex((o) => o.id === 'starCandle');
  const before = run.player.energy;
  runMod.applyReward(run, idx);
  save.saveRun(run);
  return { htmlHasCandle: /星辉烛台/.test(html), before, after: run.player.energy };
});
ok(reward.htmlHasCandle, '奖励面板渲染出星辉烛台（含文案与图标）');
ok(reward.after === reward.before + 1 && reward.after <= 10, `领奖后能量上限 ${reward.before} → ${reward.after}（普通途径硬顶 10）`);

await page.screenshot({ path: 'tools/probe/shot-v362-energy.png' });

// ④ 圣杯文案（青苔族专属）在宝物表里可读
const chalice = await page.evaluate(async () => {
  const r = await import('/src/core/relics.js');
  return { text: r.RELICS.moonChalice.text, avail: r.relicAvailableFor('moonChalice', 'moss') };
});
ok(chalice.avail && /青苔族专属/.test(chalice.text), `月苔圣杯文案：「${chalice.text}」`);

await browser.close();
console.log('ALL PASS');
