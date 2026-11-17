/**
 * 探针 v3.31：本地验证「声音 + 版本水印 + 强制更新」
 *
 * 1. 点击后 AudioContext 变 running，BGM 振荡器按 5.2 秒/和弦的节奏增长（不是每秒一批）
 * 2. 帮助面板显示构建号
 * 3. ♪ 静音时按钮带 off 类
 * 4. 控制台零报错
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.addInitScript(() => {
  const orig = window.AudioContext;
  window.__acs = [];
  window.__osc = 0;
  window.AudioContext = class extends orig {
    constructor(...a) {
      super(...a);
      window.__acs.push(this);
    }
  };
  const co = orig.prototype.createOscillator;
  orig.prototype.createOscillator = function (...a) {
    window.__osc++;
    return co.apply(this, a);
  };
});

await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.mouse.click(195, 420);
await page.waitForTimeout(200);
const afterClick = await page.evaluate(() => ({
  state: window.__acs.map((c) => c.state),
  osc: window.__osc,
  audio: window.__rsAudio(),
  build: window.__rsBuild,
}));
console.log('点击后:', JSON.stringify(afterClick));
await page.waitForTimeout(5600);
const later = await page.evaluate(() => ({
  states: window.__acs.map((c) => c.state),
  osc: window.__osc,
}));
console.log('再等 5.6s:', JSON.stringify(later));
console.log('→ 5.6 秒里新增振荡器', later.osc - afterClick.osc, '（一个和弦 ≈ 5~6 个，说明不再每秒叠一层）');

await page.locator('[data-action="toggle-help"]').click();
await page.waitForTimeout(300);
const help = await page.evaluate(() => ({
  build: document.querySelector('.hs-build')?.textContent?.replace(/\s+/g, ' ').trim(),
  hardBtn: !!document.querySelector('[data-action="hard-reload"]'),
  sheetBox: (() => {
    const el = document.querySelector('.hs-card');
    const r = el?.getBoundingClientRect();
    return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null;
  })(),
  scrollable: (() => {
    const el = document.querySelector('.hs-body');
    return el ? el.scrollHeight > el.clientHeight + 2 : null;
  })(),
}));
console.log('帮助面板:', JSON.stringify(help));

const snd = page.locator('[data-action="toggle-sound"]').first();
await page.locator('[data-action="toggle-help"]').last().click();
await page.waitForTimeout(200);
await snd.click();
await page.waitForTimeout(250);
console.log('静音后 class:', await snd.getAttribute('class'));
await snd.click();
await page.waitForTimeout(300);
console.log('再开后 class:', await snd.getAttribute('class'), '● audio:', JSON.stringify(await page.evaluate(() => window.__rsAudio())));

console.log('页面错误:', errs.length ? errs : '无');
await browser.close();
