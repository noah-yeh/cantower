/**
 * 音频层守卫（v3.30）。
 *
 * 音频是唯一一个"跑不起来也不该崩游戏"的模块，所以这里钉三件事：
 *   1. node 里 import 不产生副作用（没有 window 也不能炸）
 *   2. 没有 AudioContext 时所有入口静默空转
 *   3. playEvents 的事件归并逻辑不会因为未知事件类型抛错
 *
 * 真机上"有没有声音"没法自动化测，全靠这三条守住"不会把游戏搞崩"。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isMuted, toggleMute, sfx, playEvents, unlockAudio, startMusic, stopMusic,
  audioState, audioSupported, bgmInfo, audioDebug, bgmSegmentStarts,
} from '../src/ui/audio.js';

test('node 环境 import 音频模块不抛错，且默认不静音', () => {
  assert.equal(typeof sfx, 'function');
  assert.equal(typeof playEvents, 'function');
  assert.equal(isMuted(), false);
});

test('没有 window 时诊断为「不支持 / 未创建」，而不是谎报 running', () => {
  assert.equal(audioSupported(), false);
  assert.equal(audioState(), 'none');
});

test('没有 AudioContext 时所有入口都是空转，不抛错', () => {
  assert.doesNotThrow(() => unlockAudio());
  assert.doesNotThrow(() => sfx('hit'));
  assert.doesNotThrow(() => sfx('不存在的音效'));
  assert.doesNotThrow(() => startMusic());
  assert.doesNotThrow(() => stopMusic());
  assert.doesNotThrow(() => playEvents([
    { type: 'damage', target: 'enemy', value: 12 },
    { type: 'crit' },
    { type: 'poison', value: 2 },
    { type: 'heal', value: 5 },
    { type: 'dodge' },
    { type: 'weird-unknown-type' },
  ]));
});

test('playEvents 接受空值 / 非法输入', () => {
  assert.doesNotThrow(() => playEvents());
  assert.doesNotThrow(() => playEvents([]));
  assert.doesNotThrow(() => playEvents([{}]));
});

test('静音开关可切换，且在无 AudioContext 时也能返回状态', () => {
  const before = isMuted();
  const after = toggleMute();
  assert.equal(after, !before);
  assert.equal(isMuted(), after);
  toggleMute(); // 还原
});

/**
 * v3.61：背景乐从 `<audio loop>` 改成 WebAudio 缓冲 + 交叉淡化。
 * 两条回归都钉在这里：
 *   ① 段与段必须**重叠**（间隔 = 曲长 - 淡化时长）—— 硬切就是间隔 = 曲长，
 *      接缝会有一声"咔"，这是用户实测报的问题；
 *   ② 诊断接口在 node 里不能炸（它们是探针唯一的信息源）。
 */
test('背景乐段落交叉重叠（间隔 = 曲长 - 淡化时长，不是硬切）', () => {
  const dur = 21;
  const fade = 1.6;
  const starts = bgmSegmentStarts(dur, fade, 3);
  assert.equal(starts.length, 3);
  assert.equal(starts[0], 0);
  const gap = starts[1] - starts[0];
  assert.ok(Math.abs(gap - (dur - fade)) < 1e-6, `段间隔应等于 ${dur - fade}，实际 ${gap}`);
  assert.ok(gap < dur, '相邻段必须重叠，间隔不能等于曲长（那就是硬切）');
  /** 重叠时长就是淡化时长：前段还没播完，后段已经淡入了 */
  assert.ok(Math.abs((dur - gap) - fade) < 1e-6, '重叠时长应等于淡化时长');
});

test('bgmInfo / audioDebug 在无 AudioContext 的 node 环境里安全返回', () => {
  const info = bgmInfo();
  assert.equal(info.source, 'none');
  assert.equal(info.dur, 0);
  assert.equal(info.src, '');
  const dbg = audioDebug();
  assert.equal(dbg.ctxState, 'none');
  assert.equal(dbg.master, null);
  assert.equal(dbg.sfx, null);
});
