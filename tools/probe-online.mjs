/**
 * 探针 v3.31：线上到底给了客户端哪一版
 *
 * 用户反馈「听不到声音」「切图还是旧的」，但 curl 比对线上 34 张素材与本地
 * 全部一致、sw 也是 v44 —— 说明部署没问题，是客户端拿到了旧缓存。
 * 这里用真浏览器走一遍线上地址，看：
 *   1. main.js 里有没有 toggle-sound（v3.30 才有的按钮）
 *   2. 图片请求的 status 与是否 from service worker
 *   3. sw 注册的版本
 */
import { chromium } from 'playwright-core';

const URL = 'https://canta-tower.app.workbuddy.host/?sharecode=LTZR57SHEN';
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const imgReqs = [];
page.on('response', async (res) => {
  const u = res.url();
  if (!/assets\/img\//.test(u)) return;
  imgReqs.push({ file: u.split('/').pop().split('?')[0], status: res.status(), fromSW: res.fromServiceWorker() });
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const info = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const main = await fetch('src/ui/main.js').then((r) => (r.ok ? r.text() : 'HTTP ' + r.status)).catch((e) => 'ERR ' + e.message);
  return {
    hasSoundBtn: !!document.querySelector('[data-action="toggle-sound"]'),
    mainHasAudioImport: /from '\.\/audio\.js'/.test(main),
    mainLen: main.length,
    swVersion: reg ? (reg.active ? reg.active.scriptURL : 'no-active') : 'no-reg',
    controlling: !!navigator.serviceWorker.controller,
    racesName: [...document.querySelectorAll('.cx')].length,
  };
});
console.log('页面信息:', JSON.stringify(info, null, 1));
console.log('图片响应前 8 条:');
for (const r of imgReqs.slice(0, 8)) console.log('  ', r.file, r.status, r.fromSW ? '(SW)' : '(网络)');
console.log('图片总数', imgReqs.length, '失败', imgReqs.filter((r) => r.status >= 400).length);

await browser.close();
