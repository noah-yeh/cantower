/**
 * 探针 v3.33：竞技场交互化
 *
 * 要证的四件事：
 *   1. 挑战之后进的是**战斗屏**，不是直接跳结果
 *   2. 玩家能点自己的手牌打出，血/能量/手牌跟着变
 *   3. 结束回合后对手**逐张亮牌**（不是一次性刷完）
 *   4. 打到底能正常落到结果页，控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4183/';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

/** 造一个已转正、有竞技场额度的角色 */
await page.evaluate(async () => {
  const meta = await import('/src/core/meta.js');
  const roster = await import('/src/core/roster.js');
  const save = await import('/src/core/save.js');
  const m = meta.createMeta(20261107);
  const ch = roster.createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  ch.veteran = true;
  ch.status = 'idle';
  ch.lives = 3;
  ch.arenaLeft = 3;
  ch.arenaNextAt = 0;
  m.roster = [ch];
  save.saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 大厅 → 竞技场 → 选人 → 挑战
await page.locator('[data-action="open-arena"]').first().click();
await page.waitForTimeout(250);
await page.locator('[data-action="arena"]').first().click();
await page.waitForTimeout(250);
const pickCount = await page.locator('[data-action="fight"]').count();
console.log('可选对手数:', pickCount);

await page.locator('[data-action="fight"]').first().click();
await page.waitForTimeout(400);

const entered = await page.evaluate(() => ({
  hasStage: !!document.querySelector('.stage'),
  hasFoePlay: !!document.querySelector('.foe-play'),
  handCards: document.querySelectorAll('.tray .card').length,
  midline: document.querySelector('.midline')?.textContent?.trim(),
  foeName: document.querySelector('.enemy-name')?.textContent?.trim(),
  resultPage: !!document.querySelector('.big-result'),
}));
console.log('进屏后:', JSON.stringify(entered));

/** 先手若是对手，等它把回合打完再说 */
for (let i = 0; i < 40; i++) {
  const my = await page.evaluate(() => document.querySelector('.midline')?.textContent?.trim() === '你的回合');
  if (my) break;
  await page.waitForTimeout(300);
}
await page.screenshot({ path: 'tmp/arena-myturn.png' });

const before = await page.evaluate(() => ({
  hand: document.querySelectorAll('.tray .card').length,
  energy: document.querySelector('.energy-orb')?.textContent?.trim(),
  foeHp: document.querySelector('.hp-enemy .label')?.textContent?.trim(),
}));

/** 点第一张能打的牌 */
const playable = page.locator('.tray .card.playable').first();
const canPlay = await playable.count();
if (canPlay) await playable.click();
await page.waitForTimeout(500);

const after = await page.evaluate(() => ({
  hand: document.querySelectorAll('.tray .card').length,
  energy: document.querySelector('.energy-orb')?.textContent?.trim(),
  foeHp: document.querySelector('.hp-enemy .label')?.textContent?.trim(),
  logName: document.querySelector('.foe-play .fp-name')?.textContent?.trim(),
}));
console.log('出牌前:', JSON.stringify(before));
console.log('出牌后:', JSON.stringify(after));

/** 结束回合：看对手是不是一张一张出 */
await page.locator('[data-action="arena-end-turn"]').click();

const seen = [];
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(200);
  const s = await page.evaluate(() => {
    const name = document.querySelector('.foe-play .fp-name')?.textContent?.trim();
    const detail = document.querySelector('.foe-play .fp-detail')?.textContent?.trim();
    return name ? `${name}|${detail}` : null;
  });
  if (s && seen[seen.length - 1] !== s) seen.push(s);
  const over = await page.evaluate(() => !!document.querySelector('.big-result'));
  if (over) { seen.push('→ 已结算'); break; }
}
console.log('对手回合播到的牌（去重按时间）:');
for (const s of seen) console.log('   ', s);

const end = await page.evaluate(() => ({
  resultPage: !!document.querySelector('.big-result'),
  midline: document.querySelector('.midline')?.textContent?.trim(),
  hand: document.querySelectorAll('.tray .card').length,
  rows: [...document.querySelectorAll('.result-rows div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()).slice(0, 6),
}));
console.log('对手回合结束后:', JSON.stringify(end));

/** 一直打到结算页：轮到自己就出完能出的牌再结束回合 */
let rounds = 0;
for (let i = 0; i < 90; i++) {
  const st = await page.evaluate(() => ({
    result: !!document.querySelector('.big-result'),
    my: document.querySelector('.midline')?.textContent?.trim() === '你的回合',
    endBtn: !!document.querySelector('[data-action="arena-end-turn"]'),
  }));
  if (st.result) break;
  if (st.my && st.endBtn) {
    for (;;) {
      const card = page.locator('.tray .card.playable').first();
      if (!(await card.count())) break;
      await card.click();
      await page.waitForTimeout(180);
    }
    const btn = page.locator('[data-action="arena-end-turn"]');
    if (await btn.count()) await btn.click();
    rounds++;
  }
  await page.waitForTimeout(260);
}

const finish = await page.evaluate(() => ({
  resultPage: !!document.querySelector('.big-result'),
  mark: document.querySelector('.big-result')?.textContent?.trim(),
  rows: [...document.querySelectorAll('.result-rows div')].map((d) => d.textContent.replace(/\s+/g, ' ').trim()),
  logRows: document.querySelectorAll('.arena-log .log-row').length,
}));
console.log('玩家回合数:', rounds);
console.log('结算:', JSON.stringify(finish));
console.log('页面错误:', errs.length ? errs : '无');

await browser.close();
