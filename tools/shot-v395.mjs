/**
 * v3.95 探针 —— 种族并进图鉴 + 商城货币文案
 *
 * 用户两句话：
 *   "不是说把种族移到图鉴里面展示就行了吗？解锁升级都在那边，外面不需要再放入口了"
 *   "现在商城为什么会显示古币200"
 *
 * 检查：
 *   A. 大厅：不再有「种族」独立入口，次级入口回到 5 格
 *   B. 图鉴「种族」页签：4 张卡 + 每张一个养成按钮，点解锁 / 升级真的生效
 *   C. 图鉴种族页签不再出现"去种族页"这种指向已删页面的说法
 *   D. 商城：页头写「古币余额」，四张卡的价格 / 收益都用「古币」而不是「金」
 *   E. 全程零 console 报错（独立种族页删干净了，没有指向死路由的按钮）
 */
import { chromium } from 'playwright-core';

const BASE = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('OK  ' + msg); } else { fail++; console.log('ERR ' + msg); }
};

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await sleep(400);

/* ================================================================ A. 大厅入口 */
const hall = await page.evaluate(() => ({
  hasRaces: !!document.querySelector('[data-action="open-races"]'),
  labels: [...document.querySelectorAll('.hall-tools .ht .ht-label')].map((e) => e.textContent.replace(/\s+/g, '').trim()),
}));
ok(!hall.hasRaces, '大厅没有「种族」独立入口');
ok(hall.labels.length === 5, `次级入口 5 格（${hall.labels.join(' / ')}）`);
ok(!hall.labels.some((t) => t.startsWith('种族')), '5 格里也没有种族');

/* ================================================================ B. 图鉴种族页签 */
await page.locator('[data-action="open-codex"]').click();
await sleep(350);
await page.locator('[data-action="codex-tab"][data-tab="races"]').click();
await sleep(400);

const tab = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.race-card')];
  return {
    cards: cards.length,
    locked: cards.filter((c) => c.classList.contains('locked')).length,
    unlockBtns: document.querySelectorAll('[data-action="race-unlock"]').length,
    upBtns: document.querySelectorAll('[data-action="race-levelup"]').length,
    hasPageShell: !!document.querySelector('.race-page'),
    note: document.querySelector('.cx-scroll')?.textContent || '',
  };
});
ok(tab.cards === 4, `4 张种族卡（实际 ${tab.cards}）`);
ok(tab.unlockBtns + tab.upBtns === 4, `每张卡都有养成按钮（解锁 ${tab.unlockBtns} + 升级 ${tab.upBtns}）`);
ok(!tab.hasPageShell, '用的是图鉴外壳，不是旧种族页');
ok(!/在种族页/.test(tab.note), '文案不再指向已删的种族页');
ok(/碎片/.test(tab.note) && /商城/.test(tab.note), '文案说明了碎片来源（商城）');

/* 给碎片 → 点解锁 */
await page.evaluate(async () => {
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  m.races.moss.shards = 60;
  m.races.stone.shards = 60; // 石头人也要有碎片，第 2 段要测升级
  saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(350);
await page.locator('[data-action="open-codex"]').click();
await sleep(300);
await page.locator('[data-action="codex-tab"][data-tab="races"]').click();
await sleep(350);

const beforeUnlock = await page.evaluate(() => document.querySelectorAll('.race-card.locked').length);
await page.locator('[data-action="race-unlock"]').first().click();
await sleep(500);
const unlocked = await page.evaluate(() => ({
  locked: document.querySelectorAll('.race-card.locked').length,
  flash: document.querySelector('.flash')?.textContent || '',
  tab: document.querySelector('.rtab.on')?.textContent || '',
}));
ok(beforeUnlock === 3 && unlocked.locked === 2, `解锁后锁定卡 3 → 2（${beforeUnlock} → ${unlocked.locked}）`);
ok(/解锁/.test(unlocked.flash), `页内有解锁提示（${unlocked.flash}）`);
ok(unlocked.tab === '种族', `操作后仍停在「种族」页签（${unlocked.tab}）`);

/* 点升级 */
const lvBefore = await page.evaluate(() => document.querySelector('.race-card:not(.locked) .rc-lv b')?.textContent);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('[data-action="race-levelup"]')]
    .find((b) => b.closest('.race-card')?.querySelector('.rc-title b')?.textContent === '石头人');
  btn?.click();
});
await sleep(500);
const lvAfter = await page.evaluate(() => ({
  lv: document.querySelector('.race-card:not(.locked) .rc-lv b')?.textContent,
  flash: document.querySelector('.flash')?.textContent || '',
  shards: document.querySelector('.race-card:not(.locked) .rc-num')?.textContent.replace(/\s+/g, ''),
}));
ok(lvAfter.lv === String(Number(lvBefore) + 1), `石头人升级 ${lvBefore} → ${lvAfter.lv}`);
ok(/升到 Lv/.test(lvAfter.flash), `页内有升级提示（${lvAfter.flash}）`);
ok(/碎片50\//.test(lvAfter.shards || ''), `扣掉 10 碎片还剩 50（${lvAfter.shards}）`);

/* ================================================================ D. 商城文案 */
await page.locator('[data-action="back-hall"]').click();
await sleep(300);
await page.locator('[data-action="open-shop"]').click();
await sleep(400);
const mall = await page.evaluate(() => {
  const txt = document.querySelector('.race-scroll')?.innerText || '';
  return {
    head: document.querySelector('.race-top-sub')?.textContent.replace(/\s+/g, ' ').trim() || '',
    cards: document.querySelectorAll('.mall-card').length,
    /** v3.95 修复：`coin` 类名撞了全局货币圆点，古币宝箱卡被压成 12px */
    heights: [...document.querySelectorAll('.mall-card')].map((c) => Math.round(c.getBoundingClientRect().height)),
    texts: [...document.querySelectorAll('.mall-card')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
  };
});
ok(mall.cards === 4, `商城 4 张卡（实际 ${mall.cards}）`);
ok(mall.heights.every((h) => h >= 60), `四张卡都正常高度（${mall.heights.join('/')}，古币宝箱曾被压成 12px）`);
ok(/古币余额 \d+/.test(mall.head), `页头写「古币余额 N」（${mall.head}）`);
ok(mall.texts.every((t) => !/\d+\s*金|领 \d+ 金/.test(t)), '四张卡不再混用「金」这个旧叫法');
ok(mall.texts.filter((t) => /古币/.test(t)).length >= 3, '价格与收益都写成古币');

/* ================================================================ E. 零报错 */
ok(errors.length === 0, `全程零报错${errors.length ? `（${errors.slice(0, 3).join(' | ')}）` : ''}`);

console.log(`\n—— 结果 ——  通过 ${pass} / 失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
