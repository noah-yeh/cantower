/**
 * 探针 v3.12：确认迷雾关掉之后地图长什么样
 * （整层一把摊开、没有暗格、没有"?"）
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
    kinds: all.map((el) => [...el.classList].find((c) => c.startsWith('k-'))?.slice(2) ?? 'entry'),
  };
});
console.log('地图:', JSON.stringify(stat));

await page.screenshot({ path: 'tools/.v312-dungeon.png' });

/** 点一只敌人：必须一段式直接进战斗（不再有"先翻开"） */
await page.locator('.dcell.k-enemy.pending').first().click();
await page.waitForTimeout(600);
console.log('进战斗:', !!(await page.locator('.hand').count()));
await page.screenshot({ path: 'tools/.v312-battle.png' });

await browser.close();
