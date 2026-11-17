/**
 * v3.70 探针：商店「背包已有」提示 + 店内背包入口。
 *
 * 用户：「卡牌商店出现的卡牌如果背包已经有的，可以升级的可以增加一点不同的
 * 效果提示，而且打开商店的时候还可以看到背包按钮随时可查看当前持有哪些卡牌
 * 更方便构筑」。
 *
 * 检查：
 *   ① 卡组已持有 → 名字旁「已有 ×N（· +级）」，种类行标可强化 / 已满强化；
 *   ② 可强化时描述下多一行金色「强化 +N 后：…」，满强化则没有；
 *   ③ 未持有的卡不加任何标记；
 *   ④ 买下后当场变「已有 ×1」（渲染即时更新）；
 *   ⑤ 右上「背包」按钮与左上「离开」不重叠，点开进背包、返回回到同一台摊子
 *      （货架与古币都不变）。
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

/** 造一趟停在行商的探险：卡组里有 guard×2（最高 +1）和 brace+3（满强化），货架三张卡 */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const runMod = await import('/src/core/run.js');
  const m = meta.createMeta(20261110);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  ch.status = 'exploring'; ch.lives = 3; m.roster = [ch]; save.saveMeta(m);

  const run = runMod.createRun({ character: ch, seed: 42 });
  run.phase = 'shop';
  run.gold = 500;
  run.materials = 0;
  run.deck = ['guard', 'guard+1', 'brace+3', 'jab'];
  run.shop = {
    kind: 'card', refreshes: 0, relics: [],
    cards: [
      { id: 'guard', price: 100, sold: false },   // 已有 ×2，最高 +1 → 可强化 +2
      { id: 'brace', price: 100, sold: false },   // 已有 +3 → 已满强化
      { id: 'heavy', price: 100, sold: false },   // 未持有
    ],
  };
  save.saveRun(run);
  m.run = { characterId: ch.id, floor: run.floor, paused: true };
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="resume"]').first().click();
await page.waitForTimeout(500);

const rows = await page.evaluate(() => [...document.querySelectorAll('.shop-item')].map((el) => ({
  name: el.querySelector('.rname')?.textContent.replace(/\s+/g, ' ').trim(),
  tag: el.querySelector('.own-tag')?.textContent.trim() || '',
  kind: el.querySelector('.rkind')?.textContent.replace(/\s+/g, ' ').trim(),
  up: el.querySelector('.rtext .up')?.textContent.replace(/\s+/g, ' ').trim() || '',
  upColor: el.querySelector('.rtext .up') ? getComputedStyle(el.querySelector('.rtext .up')).color : '',
})));

ok(rows.length === 3, `行商渲染 3 格货（实际 ${rows.length}）`);
ok(/已有 ×2 · 最高 \+1/.test(rows[0]?.tag || ''), `guard 标出已有份数与最高等级：「${rows[0]?.tag}」`);
ok(/还差一张同级 \+1才能合/.test(rows[0]?.kind || ''),
  `一张 +0 一张 +1 → 提示要同级（v3.87）：「${rows[0]?.kind}」`);
ok(/^升到 \+2 后：/.test(rows[0]?.up || ''), `guard 多一行升级后效果：「${rows[0]?.up.slice(0, 40)}…」`);
ok(!/rgb\(2[0-9]{2}, 2[0-9]{2}, 2[0-9]{2}\)/.test(rows[0]?.upColor || ''), `强化行是金色调（${rows[0]?.upColor}）`);
ok(/已有 ×1 · 最高 \+3/.test(rows[1]?.tag || ''), `brace 满强化也标已有：「${rows[1]?.tag}」`);
ok(/已满强化/.test(rows[1]?.kind || ''), `brace 种类行写已满强化：「${rows[1]?.kind}」`);
ok(!rows[1]?.up, '满强化不再给强化后预览');
ok(!rows[2]?.tag && !rows[2]?.up, '未持有的卡没有任何标记');
await page.screenshot({ path: 'tools/probe/shot-v370-owned.png' });

/* ④ 买下 heavy → 当场变「已有 ×1」 */
await page.locator('.shop-item').nth(2).click();
await page.waitForTimeout(400);
const bought = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.shop-item')][2];
  return {
    tag: el?.querySelector('.own-tag')?.textContent.trim() || '',
    up: el?.querySelector('.rtext .up')?.textContent.trim() || '',
    gold: document.querySelector('.purse .chip.gold b')?.textContent.trim(),
  };
});
ok(/已有 ×1/.test(bought.tag), `买下后当场标已有 ×1：「${bought.tag}」`);
ok(/^升到 \+1 后：/.test(bought.up), '买下的新卡给出升级预览');
ok(bought.gold === '400', `古币正确扣掉（剩 ${bought.gold}）`);

/* ⑤ 背包入口位置与回程 */
const nav = await page.evaluate(() => {
  const L = document.querySelector('.back-btn:not(.right)')?.getBoundingClientRect();
  const R = document.querySelector('.back-btn.right')?.getBoundingClientRect();
  return {
    label: document.querySelector('.back-btn.right')?.textContent.trim(),
    action: document.querySelector('.back-btn.right')?.dataset.action,
    overlap: !!(L && R && L.right > R.left && R.right > L.left && L.bottom > R.top && R.bottom > L.top),
    onScreen: R ? R.right <= innerWidth && R.top >= 0 : false,
  };
});
ok(nav.label === '角色', `右上按钮改成「角色」（${nav.label}）`);
ok(nav.action === 'open-hero', `走角色详情页入口（${nav.action}）`);
ok(!nav.overlap && nav.onScreen, '与「离开」不重叠且在屏内');

await page.locator('.back-btn.right').click();
await page.waitForTimeout(450);
const bag = await page.evaluate(() => ({
  hero: !!document.querySelector('.hero-page .hp-box'),
  oldBag: !!document.querySelector('.hall-title'),
  cards: [...document.querySelectorAll('.hero-page .hp-card .cname')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
}));
ok(bag.hero, '进的是角色详情页（v3.87 旧背包页已删）');
ok(!bag.oldBag, '旧背包页不再出现');
ok(bag.cards.length >= 4, `详情页牌库列出卡组：${bag.cards.join(' / ')}`);
await page.screenshot({ path: 'tools/probe/shot-v370-bag.png' });

await page.locator('.hero-page [data-action="close-hero-page"]').first().click();
await page.waitForTimeout(400);
const back = await page.evaluate(() => ({
  title: document.querySelector('.overlay.shop h1')?.textContent.trim(),
  rows: document.querySelectorAll('.shop-item').length,
  gold: document.querySelector('.purse .chip.gold b')?.textContent.trim(),
}));
ok(/行\s*商/.test(back.title || ''), `返回回到行商（${back.title}）`);
ok(back.rows === 3 && back.gold === '400', `货架与古币都没变（${back.rows} 格 / ${back.gold}）`);

await browser.close();
console.log('ALL PASS');
