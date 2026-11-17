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

const look = () => page.evaluate(() => ({
  bar: !!document.querySelector('.abandon-bar'),
  pauseBtn: !!document.querySelector('[data-action="pause"]'),
  screen: document.querySelector('.dmap-wrap') ? 'map' : document.querySelector('.hand') ? 'battle' : document.querySelector('.reward-list') ? 'reward' : '?',
}));
console.log('地图页:', JSON.stringify(await look()));
await page.screenshot({ path: 'tools/.trim-map.png' });

let battle = false;
for (let i = 0; i < 90 && !battle; i++) {
  const enemy = page.locator('.dcell.k-enemy.pending').first();
  const target = (await enemy.count()) ? enemy : page.locator('.dcell.reach').first();
  if (!(await target.count())) break;
  await target.click().catch(() => {});
  await page.waitForTimeout(150);
  if (await page.locator('.hand').count()) battle = true;
}
console.log('战斗页:', JSON.stringify(await look()));
await page.screenshot({ path: 'tools/.trim-battle.png' });

// 打完这场看奖励页
for (let i = 0; i < 40; i++) {
  if (await page.locator('.reward-list').count()) break;
  const end = page.locator('[data-action="end-turn"]').first();
  if (!(await end.count())) break;
  await end.click().catch(() => {});
  await page.waitForTimeout(260);
  const card = page.locator('.card.playable').first();
  if (await card.count()) { await card.click().catch(() => {}); await page.waitForTimeout(200); }
}
console.log('奖励页:', JSON.stringify(await look()));
if (await page.locator('.reward-list').count()) await page.screenshot({ path: 'tools/.trim-reward.png' });
await browser.close();
