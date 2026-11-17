/**
 * 探针 v3.36：竞技场战斗记录的可见性
 *
 * 要证的四件事：
 *   1. 战斗屏记录面板**默认展开常驻**（.live-log.open），不用点按钮
 *   2. 面板跟着战局自动刷新（对手出牌后记录行数 > 0）；点头部能收起（留最新一行）、能再展开
 *   3. 结算页记录默认**收起**，只有一行入口按钮
 *   4. 点入口展开是固定高度滚动区，再点收起还原；全程控制台零报错
 */
import { chromium } from 'playwright-core';

const URL = process.env.PROBE_URL || 'http://127.0.0.1:4183/';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

/** 全新档起步（与 probe-rank 同一套路径：招募页 → 竞技场名单 → 选人） */
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.locator('[data-action="open-arena"]').first().click();
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-action="arena"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('[data-action="fight"]')?.click());
await page.waitForTimeout(600);

/** 1. 战斗屏：记录面板默认展开常驻 */
const inBattle = await page.evaluate(() => {
  const panel = document.querySelector('.live-log');
  return {
    onBattle: !!document.querySelector('.midline'),
    panel: !!panel,
    open: panel?.classList.contains('open') || false,
    title: panel?.querySelector('.ll-title')?.textContent || '',
    topBtn: document.querySelector('[data-action="toggle-arena-log"]')?.textContent?.trim() || '',
    rows: panel?.querySelectorAll('.log-row').length || 0,
  };
});
console.log('战斗屏初始:', JSON.stringify(inBattle));
if (!inBattle.onBattle) { console.log('FAIL: 没进战斗屏'); process.exit(1); }
if (!inBattle.panel || !inBattle.open) { console.log('FAIL: 记录面板没有默认展开常驻'); process.exit(1); }

/** 2. 面板自动刷新：让对手走两步 / 自己出一张牌，记录行数应增长 */
await page.waitForTimeout(1300); // 对手先手时会在这段时间里出牌
const grown = await page.evaluate(() => document.querySelectorAll('.live-log .log-row').length);
console.log(`一秒后记录行数: ${inBattle.rows} → ${grown}`);

/** 3. 收起 / 展开 */
await page.evaluate(() => document.querySelector('.live-log .ll-head')?.click());
await page.waitForTimeout(200);
const closed = await page.evaluate(() => {
  const panel = document.querySelector('.live-log');
  return {
    closed: panel?.classList.contains('closed') || false,
    last: panel?.querySelector('.ll-last')?.textContent.replace(/\s+/g, ' ').trim() || '',
    topBtn: document.querySelector('[data-action="toggle-arena-log"]')?.textContent?.trim() || '',
  };
});
console.log('收起态:', JSON.stringify(closed));
if (!closed.closed || !closed.last) { console.log('FAIL: 收起态没有保留最新一行'); process.exit(1); }

await page.evaluate(() => document.querySelector('.live-log .ll-head')?.click());
await page.waitForTimeout(200);
const reopened = await page.evaluate(() => document.querySelector('.live-log')?.classList.contains('open') || false);
console.log(`再展开: ${reopened}`);
if (!reopened) { console.log('FAIL: 展开不回来'); process.exit(1); }

/** 4. 弃权直接进结算页（探针只验记录，不必真打赢）：默认收起 + 入口展开 */
await page.evaluate(() => document.querySelector('[data-action="arena-forfeit"]')?.click());
await page.waitForTimeout(500);
const collapsedResult = await page.evaluate(() => ({
  onResult: !!document.querySelector('.big-result'),
  toggle: document.querySelector('.result-log-toggle')?.textContent.replace(/\s+/g, ' ').trim() || null,
  sheet: !!document.querySelector('.arena-log .log-body'),
}));
console.log('结算页(收起):', JSON.stringify(collapsedResult));
if (!collapsedResult.onResult) { console.log('FAIL: 没到结算页'); process.exit(1); }
if (!collapsedResult.toggle) { console.log('FAIL: 结算页没有记录入口'); process.exit(1); }
if (collapsedResult.sheet) { console.log('FAIL: 结算页记录没有默认收起'); process.exit(1); }

await page.evaluate(() => document.querySelector('.result-log-toggle')?.click());
await page.waitForTimeout(200);
const expanded = await page.evaluate(() => ({
  sheet: !!document.querySelector('.arena-log .log-body'),
  rows: document.querySelectorAll('.arena-log .log-row').length,
  scrollable: (() => {
    const b = document.querySelector('.arena-log .log-body');
    return !!b && b.scrollHeight > b.clientHeight + 4;
  })(),
}));
console.log('结算页(展开):', JSON.stringify(expanded));
if (!expanded.sheet || expanded.rows === 0) { console.log('FAIL: 展开后没有记录内容'); process.exit(1); }

await page.evaluate(() => document.querySelector('.result-log-toggle')?.click());
await page.waitForTimeout(200);
const recollapsed = await page.evaluate(() => !document.querySelector('.arena-log .log-body')
  && !!document.querySelector('.result-log-toggle'));
console.log(`再收起: ${recollapsed}`);
if (!recollapsed) { console.log('FAIL: 收不回去'); process.exit(1); }

console.log(errs.length ? `页面错误: ${errs.join(' | ')}` : '页面错误: 无');
await browser.close();
console.log('PROBE PASS');
