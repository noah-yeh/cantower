/**
 * 竞技场段位 / 排名 / 每日奖励（v3.35）—— tests
 *
 * 全部走 core 纯函数：时间由测试显式传入，不依赖真实时钟。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RANKS, ARENA_START_SCORE, ELO_K,
  scoreOf, rankOf, nextRankOf, eloDelta, applyArenaResult,
  dayKey, dailyState, claimDaily, ladderOf, rankOfChar,
} from '../src/core/arena-rank.js';
import { createMeta, matchOpponents, buildGhostPool } from '../src/core/meta.js';
import { loadMeta, saveMeta } from '../src/core/save.js';
import { createCharacter, ARENA_MAX } from '../src/core/roster.js';

const stub = (over = {}) => ({
  id: 'ch_test',
  name: '测试角色',
  classId: 'warrior',
  raceId: 'stone',
  veteran: true,
  status: 'idle',
  maxHp: 100,
  atk: 10,
  deck: Array(10).fill('strike'),
  relics: [],
  lives: 3,
  maxLives: 3,
  record: { bestFloor: 0, exploreCount: 0, arenaWins: 0, arenaLosses: 0 },
  ...over,
});

/* ---------------- 段位表 ---------------- */

test('段位门槛单调、覆盖 0 分到无穷，且每日奖励随段位递增', () => {
  assert.equal(RANKS[0].min, 0);
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(RANKS[i].min > RANKS[i - 1].min, '门槛必须递增');
    assert.ok(RANKS[i].daily > RANKS[i - 1].daily, '每日奖励必须递增');
    assert.ok(RANKS[i].win > RANKS[i - 1].win, '单胜金币必须递增');
  }
  assert.equal(rankOf(0).id, 'iron');
  assert.equal(rankOf(899).id, 'iron');
  assert.equal(rankOf(900).id, 'bronze');
  assert.equal(rankOf(1099).id, 'bronze');
  assert.equal(rankOf(1100).id, 'silver');
  assert.equal(rankOf(1699).id, 'platinum');
  assert.equal(rankOf(1700).id, 'diamond');
  assert.equal(rankOf(99999).id, 'diamond', '钻石无上限');
});

test('nextRankOf：青铜的上一个是白银，钻石到顶', () => {
  assert.equal(nextRankOf(900)?.id, 'silver');
  assert.equal(nextRankOf(0)?.id, 'bronze');
  assert.equal(nextRankOf(99999), null);
});

/* ---------------- 分数与 Elo ---------------- */

test('scoreOf：缺字段按起点补，脏数据不外泄', () => {
  assert.equal(scoreOf({}), ARENA_START_SCORE);
  assert.equal(scoreOf(null), ARENA_START_SCORE);
  assert.equal(scoreOf({ arenaScore: 1234 }), 1234);
  assert.equal(scoreOf({ arenaScore: -50 }), 0, '负分要压回 0');
  assert.equal(scoreOf({ arenaScore: 'abc' }), ARENA_START_SCORE);
});

test('Elo：均势 ±20，打赢强敌多、打赢弱敌少，保底 ±1', () => {
  assert.equal(eloDelta(1000, 1000, true), ELO_K / 2);
  assert.equal(eloDelta(1000, 1000, false), -ELO_K / 2);
  assert.ok(eloDelta(1000, 1400, true) > eloDelta(1000, 1000, true), '越级获胜要拿更多');
  assert.ok(eloDelta(1000, 1400, false) > eloDelta(1000, 1000, false), '输给强敌少扣（分差靠近 0）');
  assert.ok(eloDelta(1000, 600, true) >= 1, '碾压局也要有正分（保底 1）');
  assert.ok(eloDelta(1000, 600, false) <= -1, '爆冷输了要扣（保底 -1）');
});

test('applyArenaResult：写回角色、识别升段降段', () => {
  const ch = stub({ arenaScore: 1080 });
  const r = applyArenaResult(ch, 1080, true);
  assert.equal(ch.arenaScore, 1100);
  assert.equal(r.delta, 20);
  assert.equal(r.promoted, true, '1080+20=1100 跨过白银线');
  assert.equal(r.rank.id, 'silver');

  const ch2 = stub({ arenaScore: 1110 });
  const r2 = applyArenaResult(ch2, 1110, false);
  assert.equal(ch2.arenaScore, 1090);
  assert.equal(r2.demoted, true, '1110-20=1090 跌回青铜');
});

test('0 分不再往下扣：连输多少场也停在 0', () => {
  const ch = stub({ arenaScore: 0 });
  const r = applyArenaResult(ch, 0, false);
  assert.equal(ch.arenaScore, 0);
  assert.ok(r.delta < 0);
});

/* ---------------- 每日奖励 ---------------- */

const NOON = new Date('2026-11-08T12:00:00').getTime();

test('dayKey 用本地日期，不按 UTC', () => {
  assert.equal(dayKey(new Date('2026-11-08T00:00:30').getTime()), '2026-11-08');
  assert.equal(dayKey(new Date('2026-11-08T23:59:59').getTime()), '2026-11-08');
});

test('每日奖励：领一次到账、重复领被拒、跨天重置', () => {
  const meta = { gold: 100, roster: [], ghosts: [], arenaDaily: { day: '', claimed: [] } };
  const ch = stub({ id: 'a', arenaScore: 950 }); // 青铜 14

  let r = claimDaily(meta, ch, NOON);
  assert.equal(r.ok, true);
  assert.equal(r.gold, 14);
  assert.equal(meta.gold, 114);

  assert.equal(claimDaily(meta, ch, NOON).ok, false, '同一天重复领要被拒');
  assert.equal(meta.gold, 114, '被拒时不能扣钱');

  const nextDay = NOON + 24 * 3600 * 1000;
  assert.equal(claimDaily(meta, ch, nextDay).ok, true, '跨天后可以再领');
  assert.equal(meta.gold, 128);

  /** 分数涨了，奖励跟着涨：升到白银（1100+ → 22） */
  ch.arenaScore = 1150;
  const day3 = nextDay + 24 * 3600 * 1000;
  r = claimDaily(meta, ch, day3);
  assert.equal(r.gold, 22, '段位涨了每日奖励也要涨');
});

test('段位是领取那一刻的档：先升段再领，按新段位给', () => {
  const meta = { gold: 0, roster: [], ghosts: [], arenaDaily: null };
  const ch = stub({ id: 'b', arenaScore: 1290 });
  ch.arenaScore = 1310; // 刚升黄金
  const r = claimDaily(meta, ch, NOON);
  assert.equal(r.gold, 34);
  assert.equal(r.rank.id, 'gold');
});

test('死亡角色领不了每日奖励', () => {
  const meta = { gold: 0, roster: [], ghosts: [], arenaDaily: null };
  const ch = stub({ id: 'c', status: 'dead' });
  assert.equal(claimDaily(meta, ch, NOON).ok, false);
  assert.equal(meta.gold, 0);
});

/* ---------------- 排名 ---------------- */

test('排行榜：玩家与幽灵混排、名次稳定、死人不上榜', () => {
  const meta = createMeta(11);
  const ghostTop = meta.ghosts.reduce((a, b) => (scoreOf(b) > scoreOf(a) ? b : a));
  const rows = ladderOf(meta);
  assert.equal(rows[0].score, Math.max(...rows.map((r) => r.score)), '榜首是最高分');
  assert.equal(rows[0].id, ghostTop.id, '新档没人爬过分，榜首应该是预置幽灵');
  assert.equal(rows[0].rank, 1);

  /** 玩家 starter 在榜上，且名次稳定（重排两次结果一致） */
  const mine = rows.filter((r) => r.mine);
  assert.equal(mine.length, 1, '新档只有初始角色一个上榜位');
  const again = ladderOf(meta);
  assert.equal(again.find((r) => r.mine).rank, mine[0].rank);

  /** 死亡角色不上榜 */
  meta.roster[0].status = 'dead';
  assert.equal(ladderOf(meta).some((r) => r.mine), false);
  assert.equal(rankOfChar(meta, meta.roster[0]), null);
});

test('rankOfChar 给出"第 N / 共 M"', () => {
  const meta = createMeta(11);
  const ch = meta.roster[0];
  const p = rankOfChar(meta, ch);
  assert.ok(p.rank >= 1 && p.rank <= p.total);
  assert.equal(p.total, ladderOf(meta).length);
});

/* ---------------- 初始转正角色 ---------------- */

test('新档自带一位转正角色：可打竞技场、分数在起点、属性略弱', () => {
  const meta = createMeta(20261108);
  assert.equal(meta.starter, true);
  assert.equal(meta.roster.length, 1);
  const ch = meta.roster[0];
  assert.equal(ch.veteran, true);
  assert.equal(ch.status, 'idle');
  assert.equal(ch.arenaLeft, ARENA_MAX, '转正福利：次数给满（v3.93 起每人每天 8 次）');
  assert.equal(ch.arenaScore, ARENA_START_SCORE);

  /** "稍微比较弱"：与同种子满血版比，血量攻击都打了 0.9 折 */
  const full = createCharacter({ classId: ch.classId, raceId: ch.raceId, seed: (20261108 * 92821 + 11) >>> 0 });
  assert.ok(ch.maxHp < full.maxHp, '血量应该比满血版低');
  assert.ok(ch.atk <= full.atk, '攻击不应该高于满血版');
  assert.equal(ch.initial.maxHp, ch.maxHp, '回滚基准要同步弱化值');
  assert.equal(ch.initial.atk, ch.atk);

  /** 弱角色也要有得打：铁段位应该能匹配到三个陪练对手 */
  const opps = matchOpponents(meta, scoreOf(ch), undefined, 3);
  assert.equal(opps.length, 3);
  assert.ok(opps.every((g) => g.arenaScore <= 1100), '新手不该匹配到远超自己段位的对手');
});

test('随机组合：不同种子给不同职业/种族的初始角色', () => {
  const a = createMeta(1).roster[0];
  const b = createMeta(2).roster[0];
  const c = createMeta(3).roster[0];
  /** 三个种子里至少两个组合不同（全部相同说明随机性坏了） */
  const uniq = new Set([`${a.classId}/${a.raceId}`, `${b.classId}/${b.raceId}`, `${c.classId}/${c.raceId}`]);
  assert.ok(uniq.size >= 2, `三个种子出了同一个组合？${[...uniq].join(', ')}`);
});

test('旧档迁移（v7）：名册空时补测试角色，非空时不打扰；段位分按起点补', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    /** 名册非空的老档：只补段位分和标记，不送角色 */
    store.set('ruin-spire/hall', JSON.stringify({
      version: 7, seed: 5, gold: 500,
      roster: [{ ...stub({ id: 'old1' }), level: 12, maxHp: 300, atk: 30, deck: Array(20).fill('strike') }],
      ghosts: [], graveyard: [], counter: 1, log: [],
    }));
    const meta = loadMeta(1);
    assert.equal(meta.roster.length, 1, '名册非空的老档不补初始角色');
    assert.equal(meta.starter, true, '标记要落盘，防止人死光后再送');
    assert.equal(meta.roster[0].arenaScore, ARENA_START_SCORE, '老角色段位分按起点补');
    assert.deepEqual(meta.arenaDaily, { day: '', claimed: [] });

    /** 名册空的老档：兜底送一位 */
    store.set('ruin-spire/hall', JSON.stringify({
      version: 7, seed: 5, gold: 500,
      roster: [], ghosts: [], graveyard: [], counter: 1, log: [],
    }));
    const meta2 = loadMeta(1);
    assert.equal(meta2.roster.length, 1, '名册空的老档补一位测试角色');
    assert.equal(meta2.roster[0].veteran, true);
    assert.equal(meta2.starter, true);
    saveMeta(meta2);
    const meta3 = loadMeta(1);
    assert.equal(meta3.roster.length, 1, '再读档不重复送');
  } finally {
    delete globalThis.localStorage;
  }
});
