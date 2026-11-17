/**
 * 广告位规则测试
 *
 * 广告直接产金币，是经济系统的一部分 —— 次数、跨天重置、只读状态这三件事
 * 必须能被自动验证，而不是靠手动点几下看看。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AD_DAILY_LIMIT, AD_REWARD_GOLD, dayKey, adState, canWatchAd, grantAdReward,
} from '../src/core/ads.js';
import { createMeta } from '../src/core/meta.js';

/** 用本地时间构造，保证 dayKey 与运行机器时区无关 */
const at = (d, h = 10) => new Date(2026, 10, d, h, 0, 0).getTime();
const DAY1 = at(4);
const DAY2 = at(5);
const DAY1_LATE = at(4, 23);

test('新大厅：每天 5 次，一次 30 金', () => {
  const meta = createMeta(1);
  const st = adState(meta, DAY1);

  assert.equal(st.limit, AD_DAILY_LIMIT);
  assert.equal(st.left, AD_DAILY_LIMIT);
  assert.equal(st.used, 0);
  assert.equal(st.reward, AD_REWARD_GOLD);
  assert.equal(canWatchAd(meta, DAY1).ok, true);
});

test('看一眼就加金币，次数跟着减', () => {
  const meta = createMeta(2);
  const before = meta.gold;

  const res = grantAdReward(meta, DAY1);

  assert.equal(res.ok, true);
  assert.equal(res.gold, AD_REWARD_GOLD);
  assert.equal(res.left, AD_DAILY_LIMIT - 1);
  assert.equal(meta.gold, before + AD_REWARD_GOLD);
  assert.equal(adState(meta, DAY1).left, AD_DAILY_LIMIT - 1);
});

test('用完 5 次就拒绝，并且不再加金币', () => {
  const meta = createMeta(3);
  for (let i = 0; i < AD_DAILY_LIMIT; i++) assert.equal(grantAdReward(meta, DAY1).ok, true);

  const goldAfterLimit = meta.gold;
  const check = canWatchAd(meta, DAY1);
  assert.equal(check.ok, false);
  assert.match(check.reason, /用完/);

  const denied = grantAdReward(meta, DAY1);
  assert.equal(denied.ok, false);
  assert.equal(meta.gold, goldAfterLimit, '被拒绝时不该发钱');
});

test('跨天自动重置，不用写回也能算', () => {
  const meta = createMeta(4);
  for (let i = 0; i < AD_DAILY_LIMIT; i++) grantAdReward(meta, DAY1);
  assert.equal(adState(meta, DAY1).left, 0);

  // 第二天：状态按新的一天算，但 meta.ads 还是旧的（懒重置）
  assert.equal(adState(meta, DAY2).left, AD_DAILY_LIMIT);
  assert.equal(canWatchAd(meta, DAY2).ok, true);
  assert.equal(meta.ads.day, dayKey(DAY1), '只读查询不该改存档');

  // 真正领取时才写回新日期
  const res = grantAdReward(meta, DAY2);
  assert.equal(res.ok, true);
  assert.equal(meta.ads.day, dayKey(DAY2));
  assert.equal(meta.ads.used, 1);
});

test('adState 是只读的：反复调用不会消耗次数', () => {
  const meta = createMeta(5);
  for (let i = 0; i < 20; i++) adState(meta, DAY1);
  assert.equal(adState(meta, DAY1).used, 0);
  assert.equal(meta.gold, createMeta(5).gold);
});

test('同一天内的不同时刻算同一天', () => {
  const meta = createMeta(6);
  grantAdReward(meta, DAY1);
  assert.equal(adState(meta, DAY1_LATE).left, AD_DAILY_LIMIT - 1);
  assert.equal(dayKey(DAY1), dayKey(DAY1_LATE));
});

test('旧档没有 ads 字段也能正常用（按 0 次算）', () => {
  const meta = createMeta(7);
  delete meta.ads;

  assert.equal(adState(meta, DAY1).left, AD_DAILY_LIMIT);
  const res = grantAdReward(meta, DAY1);
  assert.equal(res.ok, true);
  assert.equal(meta.ads.used, 1);
});

test('存档里的脏数据不会导致次数算错', () => {
  const meta = createMeta(8);
  // 模拟存进来 { day: 今天, used: 'abc' } 这种坏值
  meta.ads = { day: dayKey(DAY1), used: 'abc' };
  assert.equal(adState(meta, DAY1).used, 0);
  assert.equal(adState(meta, DAY1).left, AD_DAILY_LIMIT);
});

test('dayKey 输出 YYYY-MM-DD', () => {
  assert.match(dayKey(DAY1), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(dayKey(DAY1), '2026-11-04');
});
