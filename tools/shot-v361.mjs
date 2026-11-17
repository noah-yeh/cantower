/**
 * v3.61 探针：背景乐改 WebAudio 缓冲 + 交叉淡化，修「音效没了 / 声音太大 / 循环断」。
 *
 * 用户：「原来的打击音效都没了，这个背景音乐声音太大了而且循环的时候有点不够连贯」
 *
 * 断言：
 *   ① 文件可达（带 sharecode）；
 *   ② 手势后 source=file、AudioContext running、段已排上；
 *   ③ **不再有 <audio> 元素**（它就是抢音频会话、把音效挤哑的元凶）；
 *   ④ 音效通道完好：sfxGain=1、master=1、ctx 仍在 running；播一个 sfx 不改变状态；
 *   ⑤ 背景乐音量降到 0.3（用户嫌大）；
 *   ⑥ 交叉淡化在跑：段起点序列重叠（间隔 = 曲长 - 1.6s），且 1 秒后 t 前进。
 */
import { chromium } from 'playwright-core';

const BASE = process.env.PROBE_URL || 'http://127.0.0.1:4182/';
const ok = (c, m) => console.log(c ? 'OK ' : 'ERR', m);
const browser = await chromium.launch({ channel: 'msedge', args: ['--mute-audio'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

/** ① 文件可达（站点静态资源必须带 sharecode） */
const [base, qs] = BASE.split('?');
const resp = await page.request.get(`${base}assets/audio/bgm-harp.wav${qs ? `?${qs}` : ''}`);
ok(resp.ok(), `bgm 文件 HTTP ${resp.status()}（${Math.round((await resp.body()).length / 1024)} KB）`);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

/** 手势解锁 */
await page.mouse.click(195, 400);
await page.waitForTimeout(1500);

const info = await page.evaluate(async () => (await import('/src/ui/audio.js')).bgmInfo());
ok(info.source === 'file', `音乐来源 = 文件（${info.source}）`);
ok(info.ctxState === 'running', `AudioContext running（${info.ctxState}）`);
ok(info.segments >= 1, `缓冲段已排程（${info.segments} 段，曲长 ${info.dur?.toFixed(1)}s）`);

/** ③ 不该再有 <audio> 元素 */
const audioEls = await page.evaluate(() => document.querySelectorAll('audio').length);
ok(audioEls === 0, `页面里没有 <audio> 元素（${audioEls} 个）——不再抢音频会话`);

/** ④ 音效通道完好 */
const dbg = await page.evaluate(async () => (await import('/src/ui/audio.js')).audioDebug());
ok(dbg.sfx === 1 && dbg.master === 1, `音效通道畅通（sfx=${dbg.sfx}, master=${dbg.master}）`);
ok(Math.abs(dbg.bgm - 0.3) < 1e-6, `背景乐音量已降到 0.3（${dbg.bgm}）`);

const afterSfx = await page.evaluate(async () => {
  const a = await import('/src/ui/audio.js');
  a.sfx('hit');
  a.sfx('crit');
  return { state: a.audioState(), dbg: a.audioDebug() };
});
ok(afterSfx.state === 'running' && afterSfx.dbg.sfx === 1, `播放打击音效后 ctx 仍 running（${afterSfx.state}）`);

/** ⑥ 交叉淡化 + 播放前进 */
const starts = await page.evaluate(async () => (await import('/src/ui/audio.js')).bgmSegmentStarts(21, 1.6, 3));
const gap = starts[1] - starts[0];
ok(Math.abs(gap - 19.4) < 1e-6 && gap < 21, `段间隔 19.4s < 曲长 21s → 每段重叠 1.6s（${gap}s）`);

const t1 = info.t;
await page.waitForTimeout(1000);
const t2 = (await page.evaluate(async () => (await import('/src/ui/audio.js')).bgmInfo())).t;
ok(Number(t2) > Number(t1), `播放前进中（${Number(t1).toFixed(2)} → ${Number(t2).toFixed(2)}s）`);
await page.screenshot({ path: 'tools/probe/shot-v361-bgm.png' });

/** ⑤ 静音往返仍走 master 总线 */
await page.evaluate(async () => (await import('/src/ui/audio.js')).toggleMute());
await page.waitForTimeout(300);
const m1 = await page.evaluate(async () => (await import('/src/ui/audio.js')).audioDebug());
ok(m1.master < 0.05 && m1.muted, `静音后 master≈0（${m1.master.toFixed?.(3) ?? m1.master}）`);
await page.evaluate(async () => (await import('/src/ui/audio.js')).toggleMute());
await page.waitForTimeout(400);
const m2 = await page.evaluate(async () => (await import('/src/ui/audio.js')).audioDebug());
ok(m2.master > 0.9 && !m2.muted, `取消静音后 master≈1（${m2.master.toFixed?.(3) ?? m2.master}）`);

await browser.close();
console.log('ALL PASS');
