import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const snap = () => page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), h: Math.round(b.height) };
  };
  return {
    topbar: r('.hall-top'), hero: r('.hall-hero'),
    recruitArea: r('.cand') || r('.recruit-cta'),
    flash: r('.flash'), gold: document.querySelector('.gold-box b')?.textContent,
  };
});

console.log('初始:', JSON.stringify(await snap()));
// 招募一位
await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(400);
console.log('招募后:', JSON.stringify(await snap()));
await page.screenshot({ path: 'tools/.probe-shift-recruit.png', clip: { x: 0, y: 0, width: 390, height: 320 } });
// 婉拒
await page.locator('[data-action="dismiss"]').first().click();
await page.waitForTimeout(400);
console.log('婉拒后:', JSON.stringify(await snap()));
await page.screenshot({ path: 'tools/.probe-shift-dismiss.png', clip: { x: 0, y: 0, width: 390, height: 320 } });
// 再招募
await page.locator('[data-action="recruit"]').first().click();
await page.waitForTimeout(400);
console.log('再招后:', JSON.stringify(await snap()));
await browser.close();
