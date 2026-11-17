/**
 * v3.89 探针 —— 种族养成 + 碎片宝箱 + 广告位
 *
 * 检查：
 *   1. 大厅有「种族」入口，角标显示已解锁数量
 *   2. 种族页 4 张卡：石头人已解锁，其余锁定
 *   3. 给碎片后能解锁、能升级，升级后招募区间数字确实变大
 *   4. 看广告开箱（mock 3 秒）→ 碎片增加、次数减少
 *   5. 招募只出已解锁的种族
 *   6. 老档迁移：名册里有青苔族角色 → 青苔族自动解锁
 */

import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:4182/';
let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('OK  ' + msg); }
  else { fail++; console.log('ERR ' + msg); }
};

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });

const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);

/* ---------------------------------------------------------------- 1. 入口（v3.95 起只在图鉴里） */
const entry = await page.evaluate(() => ({
  hallBtn: !!document.querySelector('[data-action="open-races"]'),
  tools: document.querySelectorAll('.hall-tools .ht').length,
}));
ok(!entry.hallBtn, '大厅不再有「种族」独立入口（v3.95 并入图鉴）');
ok(entry.tools === 5, `大厅次级入口 5 格（实际 ${entry.tools}）`);

await page.locator('[data-action="open-codex"]').click();
await sleep(350);
await page.locator('[data-action="codex-tab"][data-tab="races"]').click();
await sleep(350);

/* ---------------------------------------------------------------- 2. 种族页结构 */
const page1 = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.race-card')];
  return {
    hasPage: !!document.querySelector('.cx-scroll'),
    cards: cards.length,
    locked: cards.filter((c) => c.classList.contains('locked')).length,
    names: cards.map((c) => c.querySelector('.rc-title b')?.textContent || ''),
    stoneLv: document.querySelector('.race-card:not(.locked) .rc-lv b')?.textContent,
    stoneRange: document.querySelector('.race-card:not(.locked) .rc-range-val')?.textContent,
    /** v3.90：碎片宝箱移进商城，种族页不再有开箱按钮 */
    noBox: !document.querySelector('[data-action="race-box"]'),
    faces: [...document.querySelectorAll('.race-card .rc-face')].length,
  };
});
ok(page1.hasPage, '图鉴「种族」页签打开了');
ok(page1.cards === 4, `4 张种族卡（实际 ${page1.cards}）`);
ok(page1.locked === 3, `3 张锁定（实际 ${page1.locked}）`);
ok(page1.names.includes('石头人'), `种族名正确（${page1.names.join('/')}）`);
ok(page1.stoneLv === '0', `石头人初始 Lv 0（实际 ${page1.stoneLv}）`);
ok(/生命 \d+~\d+/.test(page1.stoneRange || ''), `显示招募区间（${page1.stoneRange}）`);
ok(page1.noBox, '种族页没有宝箱按钮（v3.90 移进商城）');
ok(page1.faces === 4, '种族卡头像是切图');

/** 取石头人卡上的区间数字 */
const stoneRange = async () => page.evaluate(() => {
  const t = document.querySelector('.race-card:not(.locked) .rc-range-val')?.textContent || '';
  const m = t.match(/生命 (\d+)~(\d+)/);
  return m ? { lo: Number(m[1]), hi: Number(m[2]) } : null;
});
const before = await stoneRange();

/* ---------------------------------------------------------------- 3. 给碎片 → 解锁 + 升级 */
await page.evaluate(async () => {
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  m.races.moss.shards = 60;
  m.races.stone.shards = 60;
  saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);
await page.locator('[data-action="open-codex"]').click();
await sleep(350);
await page.locator('[data-action="codex-tab"][data-tab="races"]').click();
await sleep(350);

const lockedCard = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.race-card.locked')][0];
  return {
    name: c?.querySelector('.rc-title b')?.textContent,
    unlockBtn: c?.querySelector('[data-action="race-unlock"]')?.textContent.replace(/\s+/g, ''),
    disabled: c?.querySelector('[data-action="race-unlock"]')?.disabled,
  };
});
ok(lockedCard.name === '青苔族', `第一个锁定卡是青苔族（${lockedCard.name}）`);
ok(lockedCard.disabled === false, `碎片够了解锁按钮可点（${lockedCard.unlockBtn}）`);

await page.locator('[data-action="race-unlock"]').first().click();
await sleep(500);
const afterUnlock = await page.evaluate(() => ({
  locked: document.querySelectorAll('.race-card.locked').length,
  flash: document.querySelector('.flash')?.textContent || '',
  shards: [...document.querySelectorAll('.race-card')]
    .map((c) => ({ name: c.querySelector('.rc-title b')?.textContent, num: c.querySelector('.rc-num')?.textContent.replace(/\s+/g, '') })),
}));
ok(afterUnlock.locked === 2, `解锁后剩 2 张锁定（实际 ${afterUnlock.locked}）`);
ok(afterUnlock.flash.includes('解锁'), `提示了解锁（${afterUnlock.flash}）`);
const mossRow = afterUnlock.shards.find((x) => x.name === '青苔族');
ok(mossRow && mossRow.num.includes('40'), `青苔族扣掉 20 碎片还剩 40（${mossRow?.num}）`);

/* 升级石头人 */
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[data-action="race-levelup"]')]
    .find((b) => b.closest('.race-card')?.querySelector('.rc-title b')?.textContent === '石头人');
  btn?.click();
});
await sleep(500);
const afterLv = await page.evaluate(() => {
  const c = [...document.querySelectorAll('.race-card')]
    .find((x) => x.querySelector('.rc-title b')?.textContent === '石头人');
  return {
    lv: c?.querySelector('.rc-lv b')?.textContent,
    range: c?.querySelector('.rc-range-val')?.textContent,
    next: c?.querySelector('.rc-range-up')?.textContent,
    num: c?.querySelector('.rc-num')?.textContent.replace(/\s+/g, ''),
  };
});
ok(afterLv.lv === '1', `石头人升到 Lv 1（实际 ${afterLv.lv}）`);
const up = afterLv.range?.match(/生命 (\d+)~(\d+)/);
ok(up && Number(up[1]) === before.lo + 1 && Number(up[2]) === before.hi + 1,
  `升级后生命区间 +1（${before.lo}~${before.hi} → ${up?.[1]}~${up?.[2]}）`);
ok(afterLv.num.includes('50'), `扣掉 10 碎片还剩 50（${afterLv.num}）`);

/* ---------------------------------------------------------------- 4. 看广告开箱（v3.90 起在商城页） */
const shardsBefore = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  return Object.fromEntries(Object.entries(m.races).map(([k, v]) => [k, v.shards]));
});

await page.locator('[data-action="back-hall"]').click();
await sleep(300);
await page.locator('[data-action="open-shop"]').click();
await sleep(400);
await page.locator('[data-action="race-box"]').click();
await sleep(600);
const playing = await page.evaluate(() => ({
  overlay: !!document.querySelector('.ad-overlay'),
  slot: document.querySelector('.ad-overlay')?.dataset.slot,
  note: document.querySelector('.ad-note')?.textContent || '',
}));
ok(playing.overlay, '开箱时弹出广告遮罩');
ok(playing.slot === 'shard_box', `广告位是 shard_box（实际 ${playing.slot}）`);
ok(playing.note.includes('碎片'), `遮罩写明奖励是碎片（${playing.note}）`);

await sleep(3200);
const boxed = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  return {
    overlay: !!document.querySelector('.ad-overlay'),
    flash: document.querySelector('.flash')?.textContent || '',
    races: Object.fromEntries(Object.entries(m.races).map(([k, v]) => [k, v.shards])),
    boxUsed: m.ads?.boxUsed,
    gold: m.gold,
  };
});
ok(!boxed.overlay, '播完后遮罩关闭');
ok(/碎片 ×\d+/.test(boxed.flash) || /金/.test(boxed.flash), `播完给了奖励（${boxed.flash}）`);
const gained = Object.keys(boxed.races).some((k) => boxed.races[k] > (shardsBefore[k] ?? 0));
ok(gained, `某个种族碎片增加了（${JSON.stringify(shardsBefore)} → ${JSON.stringify(boxed.races)}）`);
ok(boxed.boxUsed === 1, `宝箱次数记为 1（实际 ${boxed.boxUsed}）`);

/* 次数用完 → 按钮禁用 */
await page.evaluate(async () => {
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  m.ads.boxUsed = 5;
  saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(300);
await page.locator('[data-action="open-shop"]').click();
await sleep(400);
const exhausted = await page.evaluate(() => ({
  disabled: document.querySelector('[data-action="race-box"]')?.disabled,
  text: document.querySelector('[data-action="race-box"]')?.textContent.replace(/\s+/g, ''),
}));
ok(exhausted.disabled === true, `次数用完按钮禁用（${exhausted.text}）`);

/* ---------------------------------------------------------------- 5. 招募只出已解锁种族 */
await page.evaluate(async () => {
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  m.tickets = 20;
  m.candidate = null;
  m.ads.boxUsed = 0;
  saveMeta(m);
});
const racesSeen = new Set();
for (let i = 0; i < 6; i++) {
  await page.evaluate(async () => {
    const { loadMeta, saveMeta } = await import('/src/core/save.js');
    const m = loadMeta(Date.now());
    m.tickets = 20; m.candidate = null;
    saveMeta(m);
  });
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(250);
  await page.locator('[data-action="recruit"]').first().click().catch(() => {});
  await sleep(450);
  const r = await page.evaluate(() => document.body.innerText.match(/(石头人|青苔族|影族|余烬族)/)?.[1] || null);
  if (r) racesSeen.add(r);
}
ok(racesSeen.size > 0 && !racesSeen.has('影族') && !racesSeen.has('余烬族'),
  `候选只出已解锁种族（见到 ${[...racesSeen].join('/') || '无'}）`);

/* ---------------------------------------------------------------- 6. 老档迁移 */
await page.evaluate(() => {
  localStorage.clear();
  const K = 'ruin-spire/hall';
  localStorage.setItem(K, JSON.stringify({
    version: 8, seed: 7, gold: 500, roster: [], candidates: [], slotReadyAt: [],
    ghosts: [], graveyard: [], counter: 1, log: [],
    candidate: null,
    run: { raceId: 'shade' },
  }));
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);
const migrated = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  return loadMeta(Date.now()).races;
});
ok(migrated?.stone?.unlocked === true, '老档：石头人保持解锁');
ok(migrated?.shade?.unlocked === true, '老档：进行中的探险里的影族自动解锁');
ok(migrated?.moss?.unlocked === false, '老档：没出现过的青苔族仍然锁定');

await page.screenshot({ path: 'store/shots/_v389-sanity.png', fullPage: false });

console.log(`\n—— 结果 ——  通过 ${pass} / 失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
