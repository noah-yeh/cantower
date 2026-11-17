/**
 * 探针 v3.19：格子减负 + 一次性引导
 *
 * 要确认五件事：
 *   1. 首次进迷宫自动弹引导浮层，点「知道了」关闭且 localStorage 记账
 *   2. 格子上不再有「点开 / 再点·XX」小字（.dc-sub 绝迹）
 *   3. 地图下没有常驻提示语（.dm-hint 绝迹）
 *   4. 顶栏 ？ 能重新打开引导
 *   5. 两段式仍然成立：点暗格只翻开，pending 格只剩图标
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

/** ① 首次进迷宫：引导浮层应该在 */
const guideShown = await page.locator('.maze-guide').count();
console.log('① 首次进迷宫弹引导:', guideShown === 1 ? 'PASS' : 'FAIL', `(count=${guideShown})`);
await page.screenshot({ path: 'tools/.v319-guide.png' });

/** 点「知道了」：浮层关、localStorage 记账 */
await page.locator('.maze-guide [data-action="maze-guide-ok"]').first().click();
await page.waitForTimeout(300);
const tut = await page.evaluate(() => localStorage.getItem('rs_maze_tut'));
console.log('①b 关闭后记账:', tut === '1' ? 'PASS' : 'FAIL', `(rs_maze_tut=${tut})`);

/** ②③ 格子减负 + 常驻提示语绝迹 */
const stat = await page.evaluate(() => ({
  cells: document.querySelectorAll('.dcell').length,
  dcSub: document.querySelectorAll('.dc-sub').length,
  dmHint: document.querySelectorAll('.dm-hint').length,
  reachText: document.querySelector('.dcell.reach')?.textContent?.trim(),
  pendingSamples: [...document.querySelectorAll('.dcell.pending')].map((el) => el.textContent.trim().slice(0, 12)),
  overflow: document.documentElement.scrollHeight > window.innerHeight + 2,
}));
console.log('②③ 格子减负:', stat.dcSub === 0 && stat.dmHint === 0 ? 'PASS' : 'FAIL', JSON.stringify(stat));
await page.screenshot({ path: 'tools/.v319-dungeon.png' });

/** ④ 顶栏 ？ 重开引导 → 关闭 */
await page.locator('[data-action="maze-guide"]').first().click();
await page.waitForTimeout(300);
const reopened = await page.locator('.maze-guide').count();
await page.locator('.maze-guide').first().click({ position: { x: 20, y: 20 } });
await page.waitForTimeout(300);
const closedByBackdrop = await page.locator('.maze-guide').count();
console.log('④ 问号回看:', reopened === 1 && closedByBackdrop === 0 ? 'PASS' : 'FAIL', `(reopen=${reopened}, backdropClose=${closedByBackdrop === 0})`);

/** ⑤ 两段式仍在：点暗格 → 翻开不触发 */
await page.locator('.dcell.reach').first().click();
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({
  pending: document.querySelectorAll('.dcell.pending').length,
  note: document.querySelector('.dnote')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  inBattle: !!document.querySelector('.hand'),
}));
console.log('⑤ 点暗格只翻开:', !after.inBattle ? 'PASS' : 'FAIL', JSON.stringify(after));
await page.screenshot({ path: 'tools/.v319-after-reveal.png' });

await browser.close();
