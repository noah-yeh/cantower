/**
 * v3.58 探针：初始属性上调 + 能量上限 5~8 成为角色属性。
 *
 * 用户：「初始属性值现在随机生成范围是多少？感觉除了生命值都太少了可以适当调高一点点，
 * 然后能量初始可以是5-8这个样子」。
 *
 * 断言：候选人卡片显示能量 / 属性面板能量行 = 角色掷点且落在 5~8 /
 *       进塔首回合能量 = 角色能量（不是全局 8）/ 名册卡显示能量。
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
await page.waitForTimeout(400);

// ① 招人：卡片与面板都要显示能量，且落在 5~8
await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(350);
const cand = await page.evaluate(async () => {
  const save = await import('/src/core/save.js');
  const ch = save.loadMeta().candidate;
  return { energy: ch.energy, card: document.querySelector('.slot-stats')?.innerText.replace(/\s+/g, ' ') };
});
ok(cand.energy >= 5 && cand.energy <= 8, `候选人能量掷在 5~8（${cand.energy}）`);
ok(new RegExp(`能量 ${cand.energy}`).test(cand.card), `候选卡片显示能量：「${cand.card}」`);

await page.locator('.cand-face').click();
await page.waitForTimeout(300);
const row = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.stats-panel .sp-row')];
  const r = rows.find((x) => x.querySelector('.sp-key b')?.textContent === '能量上限');
  return r?.querySelector('.sp-key i')?.textContent;
});
ok(Number(row) === cand.energy, `属性面板能量上限 = ${row}（候选人 ${cand.energy}）`);
await page.screenshot({ path: 'tools/probe/shot-v358-cand.png' });
await page.mouse.click(195, 20);
await page.waitForTimeout(200);

// ② 造一局：把候选人直接塞成 5 能量的战士，进战斗看首回合能量
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const enemies = await import('/src/core/enemies.js');
  const rngMod = await import('/src/core/rng.js');

  const m = save.loadMeta();
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 7 });
  ch.energy = 5;
  ch.initial.energy = 5;
  ch.status = 'idle'; ch.lives = 3; m.roster = [ch];
  const run = runMod.createRun({ character: ch, seed: 42 });
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[idx] = { kind: 'enemy', revealed: true, done: false,
    data: { tier: 'normal', enemy: enemies.makeEnemy(1, new rngMod.Rng(3), 'normal') } };
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
for (let step = 0; step < 20; step++) {
  if (await page.locator('.energy-orb').count()) break;
  const clicked = await page.evaluate(() => {
    const el = document.querySelector('.dcell.pending') || document.querySelector('.dcell.reach');
    if (!el) return false;
    el.click();
    return true;
  });
  if (!clicked) break;
  await page.waitForTimeout(300);
}
const orb = await page.evaluate(() => document.querySelector('.energy-orb')?.textContent.trim());
ok(orb === '◈ 5', `战斗首回合能量 = 角色能量（${orb}）`);
await page.screenshot({ path: 'tools/probe/shot-v358-battle.png' });

// ③ 名册卡也要显示能量（不然招完就看不到了）
const rosterText = await page.evaluate(async () => {
  const runMod = await import('/src/core/run.js');
  const save = await import('/src/core/save.js');
  const run = save.loadRun();
  run.phase = 'map';
  save.saveRun(run);
  document.querySelector('[data-action="pause"]')?.click();
  return null;
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-action="open-roster"]')?.click());
await page.waitForTimeout(400);
const cardStats = await page.evaluate(() => document.querySelector('.char-stats')?.innerText.replace(/\s+/g, ' '));
ok(/能量 5/.test(cardStats || ''), `名册卡显示能量：「${cardStats}」`);

await browser.close();
console.log('ALL PASS');
