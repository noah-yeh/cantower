import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:4182/';
const browser = await chromium.launch({ channel: 'msedge' });

/* A. 正常加载：不能被自愈脚本误伤 */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[A pageerror]', e.message));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  console.log('A 正常加载:', await page.evaluate(() => ({
    appLen: document.getElementById('app').innerHTML.length,
    guard: sessionStorage.getItem('canta-boot-recover'),
  })));
  await ctx.close();
}

/* B. 模块加载失败：应自动自愈一次，第二次给可点兜底页而不是黑屏 */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  let blocked = 0;
  await page.route('**/src/ui/main.js', (route) => { blocked++; route.abort(); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.waitForTimeout(6500);
  console.log('B 模块坏掉:', await page.evaluate(() => ({
    appLen: document.getElementById('app').innerHTML.length,
    text: document.getElementById('app').innerText.replace(/\s+/g, ' ').slice(0, 50),
    hasBtn: !!document.getElementById('boot-fix'),
    guard: sessionStorage.getItem('canta-boot-recover'),
  })), '拦截次数:', blocked);
  await page.screenshot({ path: 'tools/.probe-selfheal.png' });
  await ctx.close();
}

await browser.close();
