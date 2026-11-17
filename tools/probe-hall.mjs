/**
 * 临时探针：v3.6 大厅图标入口 + 玩法速查浮层。
 * 用法：node tools/probe-hall.mjs
 */
import { chromium } from 'playwright-core';

const OUT = 'tools/.probe-hall';
const URL = 'http://127.0.0.1:4182/';

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

const info = () => page.evaluate(() => ({
  grid: [...document.querySelectorAll('.hg')].map((el) => ({
    action: el.dataset.action,
    label: el.querySelector('.hg-label')?.textContent,
    num: el.querySelector('.hg-num')?.textContent,
    sub: el.querySelector('.hg-sub')?.textContent,
    off: el.classList.contains('off') || el.disabled,
  })),
  scrollH: document.querySelector('.hall-scroll')?.scrollHeight,
  clientH: document.querySelector('.hall-scroll')?.clientHeight,
  help: !!document.querySelector('.help-sheet'),
  hero: getComputedStyle(document.querySelector('.hall-hero')).height,
}));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

console.log('① 空档大厅:', JSON.stringify(await info()));
await page.screenshot({ path: `${OUT}-1-empty.png` });

// 招一个人，制造"有人在营地"的状态
await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="hire"]').click();
await page.waitForTimeout(350);
console.log('② 雇了人:', JSON.stringify(await info()));
await page.screenshot({ path: `${OUT}-2-hired.png` });

// 玩法速查
await page.locator('[data-action="toggle-help"]').first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}-3-help.png` });
console.log('③ 浮层:', await page.evaluate(() => ({
  open: !!document.querySelector('.help-sheet'),
  paras: document.querySelectorAll('.hs-body p').length,
})));
await page.locator('.hs-card [data-action="toggle-help"]').click();
await page.waitForTimeout(250);
console.log('④ 关掉浮层:', JSON.stringify({ help: !!(await page.locator('.help-sheet').count()) }));

// 每个格子都能进对应页面
for (const a of ['open-roster', 'open-manor', 'open-grave']) {
  await page.locator(`[data-action="${a}"]`).first().click();
  await page.waitForTimeout(300);
  const title = await page.evaluate(() => document.querySelector('.hall-title')?.textContent || document.body.innerText.slice(0, 40));
  console.log(`⑤ ${a} →`, JSON.stringify(title.replace(/\s+/g, ' ').trim()));
  await page.screenshot({ path: `${OUT}-4-${a}.png` });
  const back = page.locator('[data-action="back-hall"]').first();
  if (await back.count()) await back.click();
  await page.waitForTimeout(280);
}

// 进行中的探险条：开一局回大厅看
await page.locator('[data-action="open-roster"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="explore"]').first().click();
await page.waitForTimeout(600);
const pause = page.locator('[data-action="pause"]').first();
if (await pause.count()) {
  await pause.click();
  await page.waitForTimeout(400);
  console.log('⑥ 暂停回大厅:', JSON.stringify(await infoResume()));
  await page.screenshot({ path: `${OUT}-5-resume.png` });
}

async function infoResume() {
  return page.evaluate(() => ({
    resume: document.querySelector('.resume-row')?.innerText.replace(/\n+/g, ' | '),
    grid: document.querySelectorAll('.hg').length,
  }));
}

await browser.close();
