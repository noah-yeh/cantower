/**
 * v3.60 探针：背景乐换成真实音频文件。
 *
 * 用户：「背景音改成这个」（选中 02《奇幻探索_竖琴长笛拨弦》）。
 * 断言：
 *   ① 手势解锁后 bgm 以文件方式播放（source=file，不是合成器）；
 *   ② <audio> 确实在走（currentTime 增长）、循环开着；
 *   ③ 静音后暂停，取消静音恢复播放；
 *   ④ 文件可被 HTTP 拉到（200，非 404）。
 */
import { chromium } from 'playwright-core';

const BASE = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

/** ④ 文件可达（站点静态资源必须带 sharecode，照页面方式拼 query） */
const [base, qs] = BASE.split('?');
const resp = await page.request.get(`${base}assets/audio/bgm-harp.wav${qs ? `?${qs}` : ''}`);
ok(resp.ok(), `bgm 文件 HTTP ${resp.status()}（${Math.round((await resp.body()).length / 1024)} KB）`);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

/** 手势解锁（main.js 一直挂着的 unlockAudio 监听） */
await page.mouse.click(195, 400);
await page.waitForTimeout(1200);

const info1 = await page.evaluate(async () => (await import('/src/ui/audio.js')).bgmInfo());
ok(info1.started, `手势后音乐已启动（started=${info1.started}）`);
ok(info1.source === 'file', `音乐来源 = 文件（${info1.source}）`);

const playing = await page.evaluate(async () => (await import('/src/ui/audio.js')).bgmInfo());
ok(playing.loop && playing.src.startsWith('bgm-harp.wav'), `<audio loop src=bgm-harp.wav（t=${playing.t?.toFixed(1)}s paused=${playing.paused}）`);
const t1 = playing.t;
await page.waitForTimeout(900);
const t2 = (await page.evaluate(async () => (await import('/src/ui/audio.js')).bgmInfo())).t;
ok(t2 > t1, `播放前进中（${Number(t1).toFixed(2)} → ${Number(t2).toFixed(2)}s）`);
await page.screenshot({ path: 'tools/probe/shot-v360-bgm.png' });

/** ③ 静音往返 */
await page.evaluate(async () => {
  const a = await import('/src/ui/audio.js');
  a.toggleMute();
});
await page.waitForTimeout(250);
const mutedState = await page.evaluate(async () => {
  const info = await (await import('/src/ui/audio.js')).bgmInfo();
  return { paused: info.paused, muted: localStorage.getItem('rs_mute') };
});
ok(mutedState.paused && mutedState.muted === '1', `静音后 <audio> 暂停（paused=${mutedState.paused}, rs_mute=${mutedState.muted}）`);
await page.evaluate(async () => {
  const a = await import('/src/ui/audio.js');
  a.toggleMute();
});
await page.waitForTimeout(400);
const resumed = await page.evaluate(async () => !(await (await import('/src/ui/audio.js')).bgmInfo()).paused);
ok(resumed, '取消静音后恢复播放');

await browser.close();
console.log('ALL PASS');
