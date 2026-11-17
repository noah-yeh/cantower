/**
 * v3.52 探针：反伤口径改为「本体生命 × 比例」
 * 1. 荆棘/尖刺说明保留具体数字，但依据从「层数」换成「自身生命 × 百分比」
 *    （用户：「跟某个属性挂钩计算，不要把层数来计算」）。
 * 2. 深层怪本体生命更高 → 反弹自然更高，不需要单独的成长系数。
 * 3. 顺带回归 v3.51 的宝物 chip 位置（血条上方 tags-row，tray 无宝物条）。
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4187/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(350);
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const enemies = await import('/src/core/enemies.js');
  const traits = await import('/src/core/enemyTraits.js');
  const rngMod = await import('/src/core/rng.js');
  const m = meta.createMeta(20261109);
  const ch = roster.createCharacter({ classId: 'mage', raceId: 'stone', seed: 5 });
  ch.status = 'idle'; ch.lives = 3; m.roster = [ch]; save.saveMeta(m);
  const run = runMod.createRun({ character: ch, seed: 42 });
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  const foe = enemies.makeEnemy(run.floor, new rngMod.Rng(7), 'normal');
  // 强制换成荆棘模板，尖刺文案才有确定公式（value 3 / scale 0.4）
  foe.traits = [traits.CORE_TRAITS.guardian];
  foe.core = traits.CORE_TRAITS.guardian;
  foe.mutations = [];
  run.floorMap.cells[idx] = {
    kind: 'enemy', revealed: true, done: false,
    data: { tier: 'normal', enemy: foe },
  };
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
  // 塞几件宝物，保证 tags-row 里有 relic chip（法师初始只有实验之眼，够用但多两件更稳）
  run.relics = [...(run.relics || []), 'thornsVest', 'luckyClover'];
  save.saveRun(run);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(450);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);
for (let step = 0; step < 40; step++) {
  if (await page.locator('.hand .card').count()) break;
  const t = await page.evaluate(() => {
    if (document.querySelector('.dcell.pending.k-enemy')) return 'enemy';
    if (document.querySelector('.dcell.pending')) return 'pending';
    if (document.querySelector('.dcell.reach')) return 'reach';
    return null;
  });
  if (!t) break;
  await page.evaluate((k) => {
    const el = k === 'enemy' ? document.querySelector('.dcell.pending.k-enemy')
      : k === 'pending' ? document.querySelector('.dcell.pending')
        : document.querySelector('.dcell.reach');
    el?.click();
  }, t);
  await page.waitForTimeout(300);
}
await page.waitForTimeout(300);

/* ---- 1. 宝物 chip 位置 ---- */
const pos = await page.evaluate(() => {
  const inTags = [...document.querySelectorAll('.player-zone .tags-line .rl')];
  const inTray = document.querySelectorAll('.tray .relic-bar .rl, .tray .relic-bar').length;
  const tags = document.querySelector('.player-zone > .tags-row')?.getBoundingClientRect();
  const row = document.querySelector('.player-zone .player-row')?.getBoundingClientRect();
  return {
    n: inTags.length,
    names: inTags.map((c) => c.dataset.name || c.textContent.trim().slice(0, 10)),
    inTray,
    above: tags && row ? tags.bottom <= row.top + 1 : false,
  };
});
console.log('宝物 chip 位置:', JSON.stringify(pos));
ok(pos.inTray === 0, '手牌区（tray）不再有宝物条');
ok(pos.n >= 1, `血条上方 tags-row 里有宝物 chip（${pos.n} 枚）`);
ok(pos.above, '宝物 chip 行贴在血条上方');

/* ---- 2. 点宝物 chip 出蒙板说明 ---- */
await page.evaluate(() => document.querySelector('.player-zone .tags-line .rl')?.click());
await page.waitForTimeout(220);
const tip = await page.evaluate(() => {
  const o = document.querySelector('.tip-overlay');
  return o ? { name: o.querySelector('.tip-name')?.textContent.trim(), len: o.querySelector('.tip-text')?.textContent.trim().length } : null;
});
console.log('宝物浮层:', JSON.stringify(tip));
ok(!!tip && tip.len > 4, '点宝物 chip 出 showTip 蒙板且有内容');
await page.evaluate(() => document.querySelector('.tip-overlay')?.click());
await page.waitForTimeout(150);

/* ---- 3. 荆棘文案：按本体生命百分比，chip 与敌人面板同口径 ---- */
const info = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  const cell = run.floorMap.cells.find((c) => c.kind === 'enemy' && c.data?.enemy);
  const e = cell?.data?.enemy;
  return { floor: run.floor, baseHp: e?.baseHp, maxHp: e?.maxHp };
});
const expect = Math.round(info.baseHp * 0.03);
const chipText = await page.evaluate(() =>
  [...document.querySelectorAll('.enemy-zone .tags-line .trait')]
    .find((c) => c.textContent.includes('荆棘'))?.dataset.text || null);
console.log(`第 ${info.floor} 层，本体生命 ${info.baseHp}（maxHp ${info.maxHp}），期望反弹 ${expect}；chip 文案:`, chipText);
ok(!!chipText && chipText.includes(`反弹 ${expect} 点伤害`), `词条 chip 文案带具体反弹量（${info.baseHp} × 3% = ${expect}）`);
ok(!!chipText && new RegExp(`自身生命 ${info.baseHp} 的 3%`).test(chipText), '文案写明按哪个属性、多少比例算');
ok(!!chipText && !/每深入|基础 \d+/.test(chipText), '不再出现层数成长口径');

await page.screenshot({ path: 'tools/shots/v352-battle.png' });

/* 敌人信息面板同口径 */
await page.evaluate(() => document.querySelector('.enemy-zone .face-btn')?.click());
await page.waitForTimeout(250);
const fdText = await page.evaluate(() =>
  [...document.querySelectorAll('.fd-row .fd-name')].find((n) => n.textContent.includes('荆棘'))
    ?.parentElement.querySelector('.fd-text')?.textContent || null);
console.log('敌人面板文案:', fdText);
ok(!!fdText && fdText.includes(`反弹 ${expect} 点伤害`), '敌人信息面板同口径');
await page.screenshot({ path: 'tools/shots/v352-foesheet.png' });

/* ---- 4. 层数差异由属性成长承担：深层怪本体生命更高 → 反弹更高 ---- */
const growth = await page.evaluate(async () => {
  const enemies = await import('/src/core/enemies.js');
  const traits = await import('/src/core/enemyTraits.js');
  const rngMod = await import('/src/core/rng.js');
  const at = (f) => {
    const e = enemies.makeEnemy(f, new rngMod.Rng(3), 'normal');
    e.traits = [traits.MUTATIONS.mut_thorns];
    return { floor: f, baseHp: e.baseHp, maxHp: e.maxHp, reflect: Math.round(e.baseHp * 0.02) };
  };
  return { low: at(2), high: at(16) };
});
console.log('跨层对比:', JSON.stringify(growth));
ok(
  growth.high.baseHp > growth.low.baseHp && growth.high.reflect > growth.low.reflect,
  `深层本体生命更高 → 反弹更高（第 2 层 ${growth.low.reflect} → 第 16 层 ${growth.high.reflect}）`,
);
await browser.close();
console.log('probe ok');
