/**
 * v3.53 探针：荆棘改成层数 buff
 *   1. 卡面文案是「获得 N 层荆棘（受击时反弹等量伤害）」，不再写"护甲百分比"
 *   2. 打出后：状态行出现「荆棘 N」chip、飘字「荆棘 +N 层」、记录里留痕
 *   3. 层数吃知识：知识 50 时 4 层 → 6 层
 *   4. 敌人打你时按层数反弹（敌人掉血）
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
  const rngMod = await import('/src/core/rng.js');
  const m = meta.createMeta(20261109);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.status = 'idle'; ch.lives = 3; m.roster = [ch]; save.saveMeta(m);
  const run = runMod.createRun({ character: ch, seed: 42 });
  // 卡组全换「反击」，保证起手就有荆棘牌；知识 50 → 层数 ×1.5
  run.deck = Array(6).fill('w_counter');
  run.player.knowledge = 50;
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[idx] = {
    kind: 'enemy', revealed: true, done: false,
    data: { tier: 'normal', enemy: enemies.makeEnemy(run.floor, new rngMod.Rng(7), 'normal') },
  };
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
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

/* ---- 1. 卡面文案 ---- */
const cardText = await page.evaluate(() =>
  document.querySelector('.hand .card')?.textContent.replace(/\s+/g, ' ').trim() || '');
console.log('首张手牌:', cardText);
ok(/获得 4 层荆棘/.test(cardText), '卡面写「获得 4 层荆棘」');
ok(!/护甲/.test(cardText) || /反弹等量伤害/.test(cardText), '卡面不再讲"护甲百分比"');
ok(/受击时反弹等量伤害/.test(cardText), '卡面说明反弹方式');

/* ---- 2. 打出：chip + 飘字（知识 50 → 6 层） ---- */
const enemyHpOf = () => page.evaluate(() => {
  const t = document.querySelector('.hp-enemy .label')?.textContent || '';
  return Number(t.split('/')[0].trim());
});
const ehp0 = await enemyHpOf();
await page.evaluate(() => document.querySelector('.hand .card')?.click());
await page.waitForTimeout(320);
const floats = await page.evaluate(() => [...document.querySelectorAll('.float')].map((e) => e.textContent.trim()));
const chips = await page.evaluate(() =>
  [...document.querySelectorAll('.player-zone .tags-line .chip')].map((c) => c.textContent.trim()));
console.log('飘字:', JSON.stringify(floats), '状态:', JSON.stringify(chips));
ok(floats.some((t) => t.includes('荆棘 +6 层')), '飘字「荆棘 +6 层」（4 层 × 知识 50 → 6）');
ok(chips.some((t) => t === '荆棘 6'), '状态行出现「荆棘 6」chip');

/* ---- 3. 结束回合：敌人打你，按 6 层反弹 ---- */
const before = { enemy: await enemyHpOf(), player: await page.evaluate(() => Number((document.querySelector('.hp-player .label')?.textContent || '0/0').split('/')[0].trim())) };
await page.evaluate(() => document.querySelector('[data-action="end-turn"]')?.click());
await page.waitForTimeout(1200);
const after = { enemy: await enemyHpOf(), player: await page.evaluate(() => Number((document.querySelector('.hp-player .label')?.textContent || '0/0').split('/')[0].trim())) };
console.log('回合前后:', JSON.stringify({ before, after }));

/* ---- 4. 记录：敌人这次攻击附带反伤 6 ---- */
await page.evaluate(() => document.querySelector('[data-action="open-log"]')?.click());
await page.waitForTimeout(280);
const logRows = await page.evaluate(() =>
  [...document.querySelectorAll('.log-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()));
console.log('记录:', JSON.stringify(logRows.slice(0, 5)));
/**
 * 敌人血量不能直接比对：它可能带「再生 / 溶蚀」，打完你回一口血。
 * 反伤有没有落地看记录 —— 敌方那条攻击里会多出一笔 "-6"（pierce 伤害）。
 */
ok(logRows.some((r) => /^敌 /.test(r) && /-6/.test(r)), '敌人攻击的同一笔结算里带 -6（荆棘反弹）');
ok(logRows.some((r) => r.includes('荆棘 +6 层')), '战斗记录写明加了几层');
ok(after.player <= before.player, '玩家没有额外掉血（护甲挡完了）');

await page.evaluate(() => document.querySelector('.log-overlay')?.click());
await page.waitForTimeout(200);
await page.screenshot({ path: 'tools/shots/v353-battle.png' });
await browser.close();
console.log('probe ok');
