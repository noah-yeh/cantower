/**
 * 探针 v3.14：翻地砖回来了
 *
 * 要确认四件事：
 *   1. 开局只有入口是明的，其余 8 格是暗块 / 可翻的「?」
 *   2. 点一下「?」直接结算（不是"先翻开再点一次"）
 *   3. 翻空的时候给出「空房间：捡到 N 古币」，不是静默
 *   4. 整屏不溢出、提示文案对得上当前状态
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(300);
const hire = page.locator('[data-action="hire"]').first();
if (await hire.count()) { await hire.click(); await page.waitForTimeout(300); }

await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="explore"]').first().click();
await page.waitForTimeout(600);

const stat = await page.evaluate(() => {
  const all = [...document.querySelectorAll('.dcell')];
  return {
    cells: all.length,
    dark: document.querySelectorAll('.dcell.dark').length,
    reach: document.querySelectorAll('.dcell.reach').length,
    pending: document.querySelectorAll('.dcell.pending').length,
    done: document.querySelectorAll('.dcell.done').length,
    hint: document.querySelector('.dm-hint')?.textContent?.trim(),
    overflow: document.documentElement.scrollHeight > window.innerHeight + 2,
  };
});
console.log('开局地图:', JSON.stringify(stat));
await page.screenshot({ path: 'tools/.v314-dungeon.png' });

/** 点一个可翻的暗格：一次点击后必须已经"翻开并结算" */
const before = await page.locator('.dcell.reach').count();
await page.locator('.dcell.reach').first().click();
await page.waitForTimeout(500);

const after = await page.evaluate(() => ({
  reach: document.querySelectorAll('.dcell.reach').length,
  pending: document.querySelectorAll('.dcell.pending').length,
  note: document.querySelector('.dnote')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  inBattle: !!document.querySelector('.hand'),
  hint: document.querySelector('.dm-hint')?.textContent?.trim(),
}));
console.log('点一格之后:', JSON.stringify({ before, ...after }));
await page.screenshot({ path: 'tools/.v314-after-click.png' });

console.log('进战斗:', after.inBattle);
await browser.close();
