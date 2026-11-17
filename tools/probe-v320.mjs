/**
 * 探针 v3.20：属性面板（参照原作属性列表）
 *
 * 要确认四件事：
 *   1. 营地角色卡有「属性」按钮，点了弹出属性面板浮层
 *   2. 面板 9 行（生命/攻击/防御/暴击/闪避/恢复/知识/幸运/能量上限），无食量
 *   3. 点面板内部不关闭、点空白关闭
 *   4. 整屏不溢出
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

/** 角色卡在「营地」页 */
await page.locator('[data-action="open-roster"]').first().click();
await page.waitForTimeout(400);

/** ① 角色卡的「属性」按钮 → 面板弹出 */
const btn = page.locator('[data-action="open-stats"]').first();
console.log('① 属性按钮存在:', await btn.count() === 1 ? 'PASS' : 'FAIL');
await btn.click();
await page.waitForTimeout(400);
const shown = await page.locator('.stats-panel').count();
console.log('①b 面板弹出:', shown === 1 ? 'PASS' : 'FAIL');
await page.screenshot({ path: 'tools/.v320-stats.png' });

/** ② 行数与内容 */
const stat = await page.evaluate(() => {
  const names = [...document.querySelectorAll('.sp-key b')].map((el) => el.textContent.trim());
  const vals = [...document.querySelectorAll('.sp-key i')].map((el) => el.textContent.trim());
  return {
    rows: names.length,
    names,
    vals,
    hasShiliang: names.some((n) => n.includes('食量')),
    hasFali: names.some((n) => n.includes('法力')),
    hasEnergy: names.some((n) => n.includes('能量')),
    overflow: document.documentElement.scrollHeight > window.innerHeight + 2,
  };
});
console.log('② 九行属性:', JSON.stringify(stat));

/** ③ 点面板内部不关、点空白关 */
await page.locator('.sp-head').first().click();
await page.waitForTimeout(300);
const stillOpen = await page.locator('.stats-panel').count();
await page.locator('.stats-panel').first().click({ position: { x: 8, y: 8 } });
await page.waitForTimeout(300);
const closed = await page.locator('.stats-panel').count();
console.log('③ 内部不关/空白关:', stillOpen === 1 && closed === 0 ? 'PASS' : 'FAIL', `(inner=${stillOpen}, closed=${closed === 0})`);

await browser.close();
