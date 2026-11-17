/**
 * v3.93 探针 —— 竞技场每日 8 次 + 命数招募时掷 5~8
 *
 * 用户：「竞技场每日次数改为8次，另外种族寿命改成招募的时候 5-8 条随机生成吧」。
 *
 * 检查：
 *   A. 大厅：竞技场副标题「今日剩 N 次」，不再有「恢复中 / 后 +1」
 *   B. 竞技场页：每人「今日 8/8 次」；说明写「每天 8 次，0 点回满」
 *   C. 跨天：存档里 arenaDay 是昨天 → 重载后回满 8 次（不靠计时）
 *   D. 命数：新档角色 5~8、pip 数量 = maxLives = lives，且 8 枚 pip 不撑破卡片
 *   E. 种族页 / 图鉴种族页签都写「5~8」
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
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await sleep(450);

/* ================================================================ A. 大厅 */
const hall = await page.evaluate(() => {
  const act = [...document.querySelectorAll('.hall-acts > *')]
    .map((e) => e.innerText.replace(/\s+/g, ' ').trim());
  return {
    acts: act,
    text: document.body.innerText,
  };
});
const arenaAct = hall.acts.find((t) => t.includes('竞技场')) || '';
ok(/今日剩 \d+ 次|今日次数已用完/.test(arenaAct), `大厅竞技场副标题是「今日剩 N 次」（${arenaAct}）`);
ok(!/恢复中|后 \+1/.test(hall.text), '大厅没有「恢复中 / 后 +1」的计时文案');

/* ================================================================ B. 竞技场页 */
await page.locator('[data-action="open-arena"]').click();
await sleep(400);

const arena = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('.ex-card')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  hint: document.querySelector('.rtab-hint')?.innerText.replace(/\s+/g, ' ').trim(),
  top: document.querySelector('.top-count')?.textContent.trim(),
}));
ok(arena.rows.length >= 1, `竞技场有 ${arena.rows.length} 位转正角色`);
ok(arena.rows.every((r) => /今日 8\/8 次/.test(r)), `每人显示「今日 8/8 次」（${arena.rows[0]}）`);
ok(/每天 8 次/.test(arena.hint || ''), `说明写「每天 8 次」（${arena.hint}）`);
ok(/0 点回满/.test(arena.hint || ''), '说明写「0 点回满」');
ok(!/恢复中|按时间恢复/.test(arena.hint + arena.rows.join('')), '页面里没有计时恢复的残留文案');

/* ================================================================ C. 跨天回满 */
const dayInfo = await page.evaluate(async () => {
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const { dayKey } = await import('/src/core/arena-rank.js');
  const m = loadMeta(Date.now());
  const ch = m.roster.find((c) => c.veteran);
  ch.arenaLeft = 0;
  ch.arenaDay = dayKey(Date.now() - 26 * 3600_000); // 昨天
  saveMeta(m);
  return { id: ch.id };
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(450);
await page.locator('[data-action="open-arena"]').click();
await sleep(400);
const afterDay = await page.evaluate(() => {
  const row = document.querySelector('.ex-card')?.innerText.replace(/\s+/g, ' ');
  return { row, top: document.querySelector('.top-count')?.textContent.trim() };
});
ok(/今日 8\/8 次/.test(afterDay.row || ''), `昨天打完的人今天回满 8 次（${afterDay.row}）`);

/* 打一场扣一次：直接用 core 的 spendArena，避免整场战斗太慢 */
const spend = await page.evaluate(async (id) => {
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const { spendArena, arenaState } = await import('/src/core/roster.js');
  const m = loadMeta(Date.now());
  const ch = m.roster.find((c) => c.id === id);
  const before = arenaState(ch, Date.now()).left;
  const okSpend = spendArena(ch, Date.now());
  saveMeta(m);
  return { before, okSpend, after: arenaState(ch, Date.now()).left };
}, dayInfo.id);
ok(spend.okSpend && spend.after === spend.before - 1, `打一场扣一次（${spend.before} → ${spend.after}）`);

await page.reload({ waitUntil: 'networkidle' });
await sleep(450);
await page.locator('[data-action="open-arena"]').click();
await sleep(400);
const afterSpend = await page.evaluate(() => document.querySelector('.ex-card')?.innerText.replace(/\s+/g, ' '));
ok(/今日 7\/8 次/.test(afterSpend || ''), `重载后仍是 7/8（${afterSpend}）`);

/* ================================================================ D. 命数 */
await page.locator('[data-action="back-hall"]').click();
await sleep(350);

const lives = await page.evaluate(async () => {
  const { loadMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  return m.roster.map((c) => ({ id: c.id, lives: c.lives, max: c.maxLives }));
});
ok(lives.every((c) => c.lives >= 5 && c.lives <= 8), `名册角色命数都在 5~8（${lives.map((c) => c.lives).join('/')}）`);
ok(lives.every((c) => c.lives === c.max), '满命数 = 当前命数');

/* 造一个 8 命角色，看 pip 会不会撑破卡片 */
await page.evaluate(async () => {
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  const ch = m.roster.find((c) => c.veteran);
  ch.lives = 8;
  ch.maxLives = 8;
  saveMeta(m);
  window.__cid = ch.id;
});
await page.reload({ waitUntil: 'networkidle' });
await sleep(450);
await page.locator('[data-action="open-roster"]').click();
await sleep(400);
await page.evaluate(() => {
  document.querySelector('[data-action="roster-tab"][data-tab="veteran"]')?.click();
});
await sleep(350);

const pip = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.camp-card')].find((c) => c.querySelector('.lives'));
  const box = card?.querySelector('.lives');
  const pips = box ? box.querySelectorAll('.pip') : [];
  const cardR = card?.getBoundingClientRect();
  const lastR = pips.length ? pips[pips.length - 1].getBoundingClientRect() : null;
  return {
    count: pips.length,
    on: box ? box.querySelectorAll('.pip.on').length : 0,
    overflow: lastR && cardR ? lastR.right > cardR.right + 0.5 : null,
  };
});
ok(pip.count === 8, `8 命画 8 枚 pip（实际 ${pip.count}）`);
ok(pip.on === 8, `8 枚都点亮（实际 ${pip.on}）`);
ok(pip.overflow === false, '8 枚 pip 没撑出卡片右边');

/* ================================================================ E. 种族文案（v3.95 起只在图鉴） */
await page.locator('[data-action="back-hall"]').click();
await sleep(300);
await page.locator('[data-action="open-codex"]').click();
await sleep(400);
await page.locator('[data-action="codex-tab"][data-tab="races"]').click();
await sleep(350);
const codexText = await page.evaluate(() => [...document.querySelectorAll('.race-card .rc-title i')]
  .map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
ok(codexText.length === 4 && codexText.every((t) => /命数 5~8/.test(t)),
  `图鉴种族页签四张卡都写「命数 5~8」（${codexText[0]}）`);
await page.screenshot({ path: 'tools/probe/v393-codex-races.png' });

console.log(`\n通过 ${pass} · 失败 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
