import { chromium } from 'playwright-core';

const URL = process.argv[2] || 'https://canta-tower.app.workbuddy.host/?sharecode=LTZR57SHEN';
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('requestfailed', (r) => console.log('[reqfail]', r.url(), r.failure()?.errorText));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
console.log('A 首屏:', await page.evaluate(() => ({
  appLen: document.getElementById('app').innerHTML.length,
  head: document.body.innerText.replace(/\s+/g, ' ').slice(0, 80),
  sw: !!navigator.serviceWorker?.controller,
})));

const r = page.locator('[data-action="recruit"]').first();
if (await r.count()) { await r.click(); await page.waitForTimeout(300); }
const h = page.locator('[data-action="hire"]').first();
if (await h.count()) { await h.click(); await page.waitForTimeout(300); }
await page.locator('[data-action="open-expedition"]').first().click();
await page.waitForTimeout(250);
await page.locator('[data-action="explore"]').first().click();
await page.waitForTimeout(600);
console.log('B 进塔:', await page.evaluate(() => ({
  appLen: document.getElementById('app').innerHTML.length,
  head: document.body.innerText.replace(/\s+/g, ' ').slice(0, 60),
})));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const after = await page.evaluate(() => ({
  appLen: document.getElementById('app')?.innerHTML.length ?? -1,
  appText: (document.getElementById('app')?.innerText || '').replace(/\s+/g, ' ').slice(0, 100),
  bodyBg: getComputedStyle(document.body).backgroundColor,
  swCtrl: !!navigator.serviceWorker?.controller,
  htmlLen: document.documentElement.outerHTML.length,
}));
console.log('C 刷新后:', JSON.stringify(after));
await page.screenshot({ path: 'tools/.probe-black-after.png' });
await browser.close();
