/**
 * 探针 v3.32：BGM 低频验证
 *
 * 用户反馈「背景音乐有沉闷的嘟、还带震动」—— 是和弦垫下面的低八度 sub
 * （43~65Hz 正弦，与基频叠出拍频）。v3.32 已去掉 sub、pad 抬一个八度。
 *
 * 这里拦截 oscillator.frequency.value 的赋值，统计 BGM 用到的所有频率：
 * 断言最低频 ≥ 160Hz（pad 基频 174Hz 起）。
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript(() => {
  window.__freqs = [];
  const orig = window.AudioContext;
  const co = orig.prototype.createOscillator;
  orig.prototype.createOscillator = function (...a) {
    const o = co.apply(this, a);
    const p = o.frequency;
    let v = p.value;
    try {
      Object.defineProperty(p, 'value', {
        get: () => v,
        set: (x) => { v = x; window.__freqs.push(x); },
      });
    } catch { /* 拦不上就算了 */ }
    return o;
  };
});

await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.mouse.click(195, 420);
await page.waitForTimeout(6000);

const freqs = await page.evaluate(() => window.__freqs);
const low = freqs.filter((f) => f < 160);
console.log('振荡器频率样本:', freqs.slice(0, 16).join(', '), '... 共', freqs.length);
console.log('最低频:', Math.min(...freqs), 'Hz');
console.log('<160Hz 的低频个数:', low.length, low.length === 0 ? '✓ 沉闷低频已除' : '✗ 仍有低频 ' + low.join(','));
await browser.close();
