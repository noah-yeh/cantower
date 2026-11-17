import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.evaluate(async () => {
  const { loadMeta, saveMeta } = await import('/src/core/save.js');
  const m = loadMeta(Date.now());
  m.races.stone = { unlocked: true, level: 7, shards: 4 };
  m.races.moss = { unlocked: true, level: 15, shards: 7 };
  m.races.shade = { unlocked: false, level: 0, shards: 13 };
  m.races.ember = { unlocked: false, level: 0, shards: 2 };
  m.ads = { day: '', used: 0, boxUsed: 2 };
  saveMeta(m);
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.locator('[data-action="open-races"]').click();
await page.waitForTimeout(500);
await page.screenshot({ path: 'store/shots/_races.png' });

// 顺便截一张大厅看 6 格工具行
await page.locator('[data-action="back-hall"]').click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'store/shots/_hall6.png' });
await browser.close();
console.log('shot done');
