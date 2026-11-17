/**
 * 临时探针：v3.5 招募（名额池 + 一次一位）。
 * 用法：node tools/probe-recruit.mjs
 */
import { chromium } from 'playwright-core';

const OUT = 'tools/.probe-recruit';
const URL = 'http://127.0.0.1:4182/';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const read = () => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem('ruin-spire/hall') || '{}');
  return {
    gold: m.gold, tickets: m.tickets, roster: (m.roster || []).length,
    candidate: m.candidate ? `${m.candidate.raceId}/${m.candidate.classId}` : null,
    head: document.querySelector('.sec-sub')?.textContent.trim().replace(/\s+/g, ' '),
    cta: document.querySelector('.recruit-cta')?.innerText.replace(/\n+/g, ' | '),
    cand: document.querySelector('.cand')?.innerText.replace(/\n+/g, ' | '),
    acts: [...document.querySelectorAll('.cand-acts .btn')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')),
  };
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

console.log('① 开局大厅:', JSON.stringify(await read()));
await page.locator('.hall-scroll').evaluate((el) => el.scrollTo(0, 9999));
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}-1-cta.png` });

// 点招募 → 出一个人
await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(300);
console.log('② 招募后:', JSON.stringify(await read()));
await page.locator('.hall-scroll').evaluate((el) => el.scrollTo(0, 9999));
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}-2-candidate.png` });

// 再点一次招募（应该被拒：眼前还有人）
await page.locator('[data-action="recruit"]').count().then((n) => console.log('③ 候选人存在时还有 recruit 按钮:', n));

// 换一位
await page.locator('[data-action="refresh"]').click();
await page.waitForTimeout(300);
console.log('④ 换一位后:', JSON.stringify(await read()));

// 雇佣
await page.locator('[data-action="hire"]').click();
await page.waitForTimeout(350);
console.log('⑤ 雇佣后:', JSON.stringify(await read()));
await page.screenshot({ path: `${OUT}-3-hired.png` });

// 再招一个 → 让他离开
await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="dismiss"]').click();
await page.waitForTimeout(300);
console.log('⑥ 离开后:', JSON.stringify(await read()));

// 名额耗尽态：注入 tickets=0
await page.evaluate(() => {
  const k = 'ruin-spire/hall';
  const m = JSON.parse(localStorage.getItem(k));
  m.tickets = 0;
  m.candidate = null;
  m.ticketAt = Date.now();
  localStorage.setItem(k, JSON.stringify(m));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('.hall-scroll').evaluate((el) => el.scrollTo(0, 9999));
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}-4-empty.png` });
console.log('⑦ 名额 0:', JSON.stringify(await read()));

// 点一下灰态招募 —— 应该有 flash 提示
await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(300);
console.log('⑧ 名额 0 点击:', await page.evaluate(() => document.querySelector('.flash')?.textContent));
await page.screenshot({ path: `${OUT}-5-empty-flash.png` });

// 没钱雇佣
await page.evaluate(() => {
  const k = 'ruin-spire/hall';
  const m = JSON.parse(localStorage.getItem(k));
  m.tickets = 3; m.gold = 10; m.candidate = null;
  localStorage.setItem(k, JSON.stringify(m));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(300);
console.log('⑨ 没钱雇佣:', JSON.stringify(await read()));
await page.locator('.hall-scroll').evaluate((el) => el.scrollTo(0, 9999));
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}-6-poor.png` });

await browser.close();
