import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const r = page.locator('[data-action="recruit"]').first();
if (await r.count()) { await r.click(); await page.waitForTimeout(250); }
const h = page.locator('[data-action="hire"]').first();
if (await h.count()) { await h.click(); await page.waitForTimeout(250); }
await page.locator('[data-action="open-expedition"]').first().click();
await page.locator('[data-action="explore"]').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'tools/.visual-dungeon.png' });
let battle = false;
for (let i = 0; i < 90 && !battle; i++) {
  const enemy = page.locator('.dcell.k-enemy.pending').first();
  const target = (await enemy.count()) ? enemy : page.locator('.dcell.reach').first();
  if (!(await target.count())) break;
  await target.click().catch(() => {});
  await page.waitForTimeout(140);
  if (await page.locator('.hand').count()) battle = true;
}
console.log('进战斗:', battle);
if (battle) await page.screenshot({ path: 'tools/.visual-battle.png' });
await browser.close();
