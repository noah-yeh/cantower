/**
 * v3.59 探针：力量牌文案作用域 + 护甲卡数值下调。
 *
 * 用户：「卡牌战旗的描述有点问题，写着永久实际上是本场战斗生效，可以改一下描述，
 * 另外增加护甲的卡牌叠甲都太容易了，可以调低一下这类卡牌的初始值」。
 *
 * 断言：
 *   ① 变形祭坛里 power 牌的类型标签是「本场」，整页不出现「永久」；
 *   ② 战斗手牌里战旗卡面写「本场战斗 +N 点攻击」，不写「永久」；
 *   ③ 护甲卡数值确实是下调后的值（举盾 15 / 铁壁 28 / 格挡 11 / 石肤 13）；
 *   ④ 卡面护甲数字跟着数据走（举盾卡面写 15 点护甲）。
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

/** ---------- ① 变形祭坛：power 牌标签 ---------- */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');

  const m = meta.createMeta(20261109);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.status = 'idle'; ch.lives = 3; m.roster = [ch]; save.saveMeta(m);

  const run = runMod.createRun({ character: ch, seed: 42 });
  /** 保证牌组里有 power 牌（战吼），祭坛才渲染得出「本场」标签 */
  if (!run.deck.includes('w_warcry')) run.deck.push('w_warcry');
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[idx] = { kind: 'event', revealed: true, done: false, data: { event: 'morph' } };
  run.gold = 500;
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
await page.evaluate(() => document.querySelector('.dcell.pending.k-event')?.click());
await page.waitForTimeout(400);

const altar = await page.evaluate(() => {
  const kinds = [...document.querySelectorAll('.rkind')].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
  return { kinds, body: document.body.innerText };
});
ok(altar.kinds.some((k) => k.includes('本场')), `祭坛 power 牌标签 = 本场（${altar.kinds.join(' | ')}）`);
ok(!altar.body.includes('永久'), '祭坛整页不含「永久」');
await page.screenshot({ path: 'tools/probe/shot-v359-altar.png' });

/** ---------- ② 战斗手牌：战旗卡面 ---------- */
await page.evaluate(async () => {
  const runMod = await import('/src/core/run.js');
  const save = await import('/src/core/save.js');
  const enemies = await import('/src/core/enemies.js');
  const rngMod = await import('/src/core/rng.js');

  const run = save.loadRun();
  run.phase = 'map';
  run.deck = Array(8).fill('banner');
  run.gold = 500;
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[idx] = {
    kind: 'enemy', revealed: true, done: false,
    data: { tier: 'normal', enemy: enemies.makeEnemy(1, new rngMod.Rng(3), 'normal') },
  };
  save.saveRun(run);
  /** 必须把 meta.run 也置回暂停态，否则 reload 后直接跳进迷宫、没有「继续」可点 */
  const m = save.loadMeta();
  m.run = { characterId: m.run.characterId, floor: run.floor, paused: true };
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(450);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(350);
await page.evaluate(() => document.querySelector('[data-action="maze-guide-ok"]')?.click());
await page.waitForTimeout(250);
for (let step = 0; step < 20; step++) {
  if (await page.locator('.card').count()) break;
  const clicked = await page.evaluate(() => {
    const el = document.querySelector('.dcell.pending') || document.querySelector('.dcell.reach');
    if (!el) return false;
    el.click();
    return true;
  });
  if (!clicked) break;
  await page.waitForTimeout(300);
}

const cards = await page.evaluate(() => [...document.querySelectorAll('.card')].map((c) => ({
  name: c.querySelector('.cname')?.textContent.trim(),
  text: c.querySelector('.ctext')?.textContent.trim(),
})));
const banner = cards.find((c) => (c.name || '').includes('战旗'));
ok(!!banner, `手牌里有战旗（手牌 ${cards.length} 张）`);
ok(/本场战斗 \+2 点攻击/.test(banner?.text || ''), `战旗卡面写本场战斗：「${banner?.text}」`);
ok(!/永久/.test(banner?.text || ''), '战旗卡面不含「永久」');
await page.screenshot({ path: 'tools/probe/shot-v359-battle.png' });

/** ---------- ③④ 护甲数据与卡面同源 ---------- */
const armor = await page.evaluate(async () => {
  const { CARDS, cardText } = await import('/src/core/cards.js');
  return {
    shieldUp: CARDS.w_shieldUp.block,
    ironWall: CARDS.w_ironWall.block,
    guard: CARDS.guard.block,
    stoneSkin: CARDS.r_stoneSkin.block,
    shieldUpText: cardText('w_shieldUp', 0),
    ironWallText: cardText('w_ironWall', 0),
  };
});
const expect = { shieldUp: 15, ironWall: 28, guard: 11, stoneSkin: 13 };
const bad = Object.entries(expect).filter(([k, v]) => armor[k] !== v);
ok(bad.length === 0, `护甲数据已下调（举盾 ${armor.shieldUp} / 铁壁 ${armor.ironWall} / 格挡 ${armor.guard} / 石肤 ${armor.stoneSkin}）`);
ok(/获得 15 点护甲/.test(armor.shieldUpText), `举盾卡面跟着数据走：「${armor.shieldUpText}」`);
ok(/获得 28 点护甲/.test(armor.ironWallText), `铁壁卡面跟着数据走：「${armor.ironWallText}」`);

await browser.close();
console.log('ALL PASS');
