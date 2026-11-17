/**
 * 临时探针：v3.8 首页主动作 + 冒险 / 竞技场入口 + 图鉴三页。
 * 用法：node tools/probe-codex.mjs
 */
import { chromium } from 'playwright-core';

const OUT = 'tools/.probe-cx';
const URL = 'http://127.0.0.1:4182/';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.hall-acts', { timeout: 15000 });
await page.waitForTimeout(500);

const home = await page.evaluate(() => {
  const sc = document.querySelector('.hall-scroll');
  return {
    acts: [...document.querySelectorAll('.ha')].map((b) => b.innerText.replace(/\n/g, ' | ')),
    tools: [...document.querySelectorAll('.ht')].map((b) => b.innerText.replace(/\n/g, ' | ')),
    overflow: sc ? sc.scrollHeight - sc.clientHeight : null,
    heroH: Math.round(document.querySelector('.hall-hero').getBoundingClientRect().height),
  };
});
console.log('① 首页:', JSON.stringify(home));
await page.screenshot({ path: `${OUT}-1-home-empty.png` });

// 造一个实习生 + 一个转正角色
await page.evaluate(async () => {
  const m = JSON.parse(localStorage.getItem('ruin-spire/hall') || '{}');
  const { createCharacter } = await import('/src/core/roster.js');
  const { SAVE_VERSION } = await import('/src/core/meta.js');
  /** 新档没写过存档时没有版本号，loadMeta 会当成未知档重置 —— 探针里手动补上 */
  m.version = SAVE_VERSION;
  const a = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 31 });
  a.name = '石一'; a.status = 'idle';
  const b = createCharacter({ classId: 'mage', raceId: 'moss', seed: 32 });
  b.name = '苔二'; b.status = 'idle'; b.veteran = true; b.arenaLeft = 3; b.arenaNextAt = 0;
  b.record = { bestFloor: 12, exploreCount: 1, arenaWins: 4, arenaLosses: 1, wins: 0, losses: 0 };
  m.roster = [...(m.roster || []), a, b];
  localStorage.setItem('ruin-spire/hall', JSON.stringify(m));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.hall-acts');
await page.waitForTimeout(400);
console.log('② 首页（有人）:', JSON.stringify(await page.evaluate(() => ({
  acts: [...document.querySelectorAll('.ha')].map((b) => b.innerText.replace(/\n/g, ' | ')),
  overflow: (() => { const s = document.querySelector('.hall-scroll'); return s.scrollHeight - s.clientHeight; })(),
}))));
await page.screenshot({ path: `${OUT}-2-home-full.png` });

// 冒险
await page.locator('[data-action="open-expedition"]').click();
await page.waitForTimeout(300);
console.log('③ 冒险页:', JSON.stringify(await page.evaluate(() => ({
  title: document.querySelector('.hall-title')?.textContent,
  cards: [...document.querySelectorAll('.ex-card')].map((c) => c.innerText.replace(/\n/g, ' | ')),
  empty: document.querySelector('.empty')?.textContent,
}))));
await page.screenshot({ path: `${OUT}-3-expedition.png` });

// 返回 → 竞技场
await page.locator('[data-action="back-hall"]').click();
await page.waitForTimeout(250);
await page.locator('[data-action="open-arena"]').click();
await page.waitForTimeout(300);
console.log('④ 竞技场页:', JSON.stringify(await page.evaluate(() => ({
  title: document.querySelector('.hall-title')?.textContent,
  cards: [...document.querySelectorAll('.ex-card')].map((c) => c.innerText.replace(/\n/g, ' | ')),
}))));
await page.screenshot({ path: `${OUT}-4-arena.png` });

// 图鉴
await page.locator('[data-action="back-hall"]').click();
await page.waitForTimeout(250);
await page.locator('[data-action="open-codex"]').click();
await page.waitForTimeout(350);
const codex1 = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('.rtab')].map((b) => b.innerText.trim()),
  chips: [...document.querySelectorAll('.cx-chip')].map((b) => b.innerText.trim()),
  cards: document.querySelectorAll('.cx-card').length,
  first: document.querySelector('.cx-card')?.innerText.replace(/\n/g, ' | '),
}));
console.log('⑤ 图鉴·卡牌:', JSON.stringify(codex1));
await page.screenshot({ path: `${OUT}-5-codex-cards.png` });

// 选法师
await page.locator('[data-action="codex-class"][data-cls="mage"]').click();
await page.waitForTimeout(300);
console.log('⑥ 法师牌池:', JSON.stringify(await page.evaluate(() => ({
  head: document.querySelector('.cx-clsname')?.innerText.replace(/\n/g, ' '),
  talents: [...document.querySelectorAll('.cx-talent-line')].map((e) => e.innerText.replace(/\n/g, ' ')),
  cards: document.querySelectorAll('.cx-card').length,
  start: [...document.querySelectorAll('.cx-core')].length,
}))));
await page.screenshot({ path: `${OUT}-6-codex-mage.png` });

// 宝物（v3.92：原「天赋」页签，现在只讲宝物）
await page.locator('[data-action="codex-tab"][data-tab="relics"]').click();
await page.waitForTimeout(300);
console.log('⑦ 图鉴·宝物:', JSON.stringify(await page.evaluate(() => ({
  rows: document.querySelectorAll('.cx-row').length,
  heads: [...document.querySelectorAll('.sec-head span:first-child')].map((e) => e.innerText),
}))));
await page.screenshot({ path: `${OUT}-7-codex-relics.png` });

// 装备
await page.locator('[data-action="codex-tab"][data-tab="equip"]').click();
await page.waitForTimeout(300);
console.log('⑧ 图鉴·装备:', JSON.stringify(await page.evaluate(() => ({
  items: [...document.querySelectorAll('.cx-eq')].map((e) => e.innerText.replace(/\n/g, ' | ')),
}))));
await page.screenshot({ path: `${OUT}-8-codex-equip.png` });

await browser.close();
console.log('done');
