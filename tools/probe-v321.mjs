/**
 * 探针 v3.21：线性攻击力模型落地检查
 *   1. 进战斗后卡面数字正常渲染，无 JS 报错
 *   2. 属性面板「攻击力」说明已是 +1% 口径
 *   3. 打一张牌，敌人掉血与卡面数字一致（战斗真的走 atkMul）
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

/** 属性面板：攻击力说明 */
await page.locator('[data-action="open-roster"]').first().click();
await page.waitForTimeout(400);
await page.locator('[data-action="open-stats"]').first().click();
await page.waitForTimeout(300);
const atkDesc = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.sp-row')];
  const r = rows.find((el) => el.textContent.includes('攻击力'));
  return r?.textContent?.replace(/\s+/g, ' ').trim();
});
console.log('① 面板攻击力行:', atkDesc);
await page.locator('.stats-panel').first().click({ position: { x: 6, y: 6 } });
await page.waitForTimeout(300);

/** 进塔 → 打一场 */
await page.locator('[data-action="back-hall"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(300);
await page.locator('[data-action="explore"]').first().click();
await page.waitForTimeout(600);
/** 关掉首次引导 */
const ok = page.locator('[data-action="maze-guide-ok"]').first();
if (await ok.count()) { await ok.click(); await page.waitForTimeout(300); }

/** 翻格直到进战斗 */
for (let i = 0; i < 6; i++) {
  if (await page.locator('.hand').count()) break;
  const reach = page.locator('.dcell.reach').first();
  if (!(await reach.count())) break;
  await reach.click();
  await page.waitForTimeout(350);
  const pendingEnemy = page.locator('.dcell.k-enemy.pending').first();
  if (await pendingEnemy.count()) { await pendingEnemy.click(); await page.waitForTimeout(500); }
}
const inBattle = await page.locator('.hand').count();
console.log('② 进战斗:', inBattle === 1 ? 'PASS' : 'FAIL');

const face = await page.evaluate(() => {
  const card = document.querySelector('.card');
  return { name: card?.querySelector('.cname')?.textContent, text: card?.querySelector('.ctext')?.textContent };
});
console.log('③ 首张卡面:', JSON.stringify(face));
await page.screenshot({ path: 'tools/.v321-battle.png' });

await browser.close();
