/**
 * 探针 v3.31：音频到底有没有响
 *
 * 用户的反馈是「还是听不到声音」。听不到有三种完全不同的死法，得先分清：
 *   A. AudioContext 根本没解锁（state 永远 suspended）→ 浏览器策略 / iframe
 *   B. ctx 起来了但振荡器没被创建 → 代码路径没走到
 *   C. 振荡器一直在建、但音量 / 频率听不见 → 混音问题
 *
 * 这里给 AudioContext 打桩，统计 state 与 createOscillator 次数，
 * 再看 6 秒内 BGM 的振荡器是不是按 5.2 秒/和弦的节奏增长。
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.addInitScript(() => {
  const orig = window.AudioContext;
  window.__acs = [];
  window.__osc = 0;
  window.__gainPeaks = [];
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
  const cg = orig.prototype.createGain;
  orig.prototype.createGain = function (...a) {
    const g = cg.apply(this, a);
    window.__gainPeaks.push(g);
    return g;
  };
});

await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const snap = async (tag) => {
  const s = await page.evaluate(() => ({
    ctxCount: window.__acs.length,
    states: window.__acs.map((c) => c.state),
    time: window.__acs.map((c) => Number(c.currentTime.toFixed(2))),
    osc: window.__osc,
  }));
  console.log(tag, JSON.stringify(s));
  return s;
};

await snap('加载后（未交互）');

/** 第一次真实点击：应该解锁并起 BGM（点空白区，别触发任何面板） */
await page.mouse.click(195, 420);
await page.waitForTimeout(300);
await snap('第一次点击 +0.3s');
await page.waitForTimeout(2500);
await snap('第一次点击 +2.8s');
await page.waitForTimeout(3500);
const later = await snap('第一次点击 +6.3s');
console.log('→ 6 秒内 BGM 振荡器总数:', later.osc, '（一个和弦 = 3 音 + 1 低八度 = 4，6 秒约 1~2 个和弦）');

/** 静音开关能否把 master 拉回 0 */
const btn = page.locator('[data-action="toggle-sound"]').first();
if (await btn.count()) {
  await btn.click();
  await page.waitForTimeout(200);
  console.log('静音后按钮 classes:', await btn.getAttribute('class'));
  await btn.click();
  await page.waitForTimeout(200);
  console.log('再开启后 classes:', await btn.getAttribute('class'));
} else {
  console.log('!! 页面上没有 toggle-sound 按钮');
}

await browser.close();
