/**
 * 首页一屏化探针（v3.7）
 * 在 4 档常见手机视口下检查：
 *  1. .hall-scroll 不产生滚动（scrollHeight <= clientHeight）
 *  2. 主视觉横幅有合理高度（>= 70px）
 *  3. 招募区完整可见
 * 并在各档截一张全屏图供人工检查。
 */
import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:4182/';
const VIEWPORTS = [
  { name: 'se', w: 375, h: 667 },   // iPhone SE：最小主力机
  { name: 'tiny', w: 320, h: 568 }, // 极矮兜底
  { name: 'normal', w: 390, h: 844 }, // 主流安卓
  { name: 'tall', w: 430, h: 932 }, // 大屏
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 667 } });

for (const vp of VIEWPORTS) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.hall-hero', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(900); // 入场动画结束

  const info = await page.evaluate(() => {
    const sc = document.querySelector('.hall-scroll');
    const hero = document.querySelector('.hall-hero');
    const cta = document.querySelector('.recruit-cta');
    const app = document.querySelector('#app');
    return {
      scroll: sc ? { sh: sc.scrollHeight, ch: sc.clientHeight, overflow: sc.scrollHeight - sc.clientHeight } : null,
      heroH: hero ? Math.round(hero.getBoundingClientRect().height) : null,
      ctaVisible: cta ? (cta.getBoundingClientRect().bottom <= app.getBoundingClientRect().bottom + 1) : null,
      bodyScroll: document.documentElement.scrollHeight - window.innerHeight,
    };
  });
  console.log(`${vp.name} ${vp.w}x${vp.h}:`, JSON.stringify(info));
  await page.screenshot({ path: `tools/.probe-fit-${vp.name}.png` });
}

await browser.close();
console.log('done');
