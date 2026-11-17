/**
 * 竞技场 —— 镜像对战（v1.4）
 *
 * 这一组测试盯的是"竞技场到底是不是两个真人角色在打"。
 * 旧版把它做成了折算（敌方卡池 + 攻击 ×4.3），所以最能说明问题的断言是：
 * **对手打出来的每一张牌，都必须真的在它的卡组里。**
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  simulateArena, estimateWinRate,
  createArenaBattle, arenaPlay, arenaEndTurn, arenaEnemyStep, arenaResult, arenaBattleView,
  ARENA_HP_MUL, SECOND_ENERGY, SECOND_DRAW, ARENA_MAX_TURNS,
} from '../src/core/arena.js';
import { cardName, cardOf } from '../src/core/cards.js';
import { MAX_ENERGY } from '../src/core/combat.js';
import { createMeta, matchOpponents, buildGhostPool } from '../src/core/meta.js';
import { createCharacter, ratingOf } from '../src/core/roster.js';
import { scoreOf } from '../src/core/arena-rank.js';
import { Rng } from '../src/core/rng.js';
import { loadMeta, SAVE_VERSION } from '../src/core/save.js';

/** 造一个够 combat 跑的角色桩 */
function stub({ deck = ['strike'], maxHp = 150, atk = 10, relics = [], classId = 'warrior', raceId = 'stone' } = {}) {
  return {
    id: 'stub', name: '桩', classId, raceId, level: 5,
    maxHp, atk, def: 0, crit: 0, dodge: 0, recovery: 0, knowledge: 0, luck: 0,
    deck, relics, relicSlots: [],
  };
}

/* ------------------------------------------------------------------ *
 * 1:1 —— 对手就是另一个角色
 * ------------------------------------------------------------------ */

test('对手打出来的每一张牌，都在它自己的卡组里', () => {
  const meta = createMeta(11);
  const hero = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });

  let checked = 0;
  for (const ghost of meta.ghosts) {
    const r = simulateArena(hero, ghost, 5);
    const allowed = new Set(ghost.deck.map((k) => cardName(k)));
    const plays = r.log.filter(
      (l) => l.side === 'e' && !['回合开始', '中毒发作', '磐石', '光合', '收势'].includes(l.name),
    );
    for (const p of plays) {
      assert.equal(allowed.has(p.name), true, `${ghost.name} 打了「${p.name}」，它的卡组里没有这张`);
      checked++;
    }
  }
  assert.ok(checked > 50, '至少要看几十张敌方出牌，样本才够');
});

test('对手的宝物真的生效：骨符开场 8 点护甲会吸收伤害', () => {
  // 只有打击、攻击力 1 的对手，除了这 8 点护甲什么都不会有。
  // raceId 置空：v2.2 起快照没有种族就没有天赋，别让磐石护甲混进来。
  // classId 用 mage 不用 warrior（v3.24）：战士的打击现在自带 +1 护甲，
  // 挨打前护甲早就不是 8 了 —— 这条测的是骨符，不该被职业特性干扰。
  const ghost = stub({ deck: Array(6).fill('strike'), maxHp: 400, atk: 1, relics: ['boneCharm'], raceId: null, classId: 'mage' });
  const hero = stub({ deck: ['strike'], maxHp: 200, atk: 12 });

  const r = simulateArena(hero, ghost, 5);
  const firstHit = r.log.find((l) => l.side === 'p' && l.detail.includes('对手 -'));
  assert.ok(firstHit, '玩家应该至少打中一次');
  assert.match(firstHit.detail, /护甲吃 8/, `第一下应该被骨符的 8 点护甲吃掉一部分，实际：${firstHit.detail}`);
});

test('对手也会中毒：毒发发生在它自己的回合结束时', () => {
  const ghost = stub({ deck: Array(8).fill('guard'), maxHp: 400, atk: 10 });
  const hero = stub({ deck: Array(8).fill('t_venom'), maxHp: 300, atk: 10 });

  const r = simulateArena(hero, ghost, 9);
  const tick = r.log.find((l) => l.side === 'e' && l.name === '中毒发作');
  assert.ok(tick, '对手应该中毒发作');
  assert.ok(r.enemyHp < 400, '中毒应该真的掉血');
});

test('竞技场不会重复结算面板宝物：快照里的铁环不该再加一次血', () => {
  // 152 是「基础 134 + 铁环 18」之后的数，入场时不能再加
  const ch = stub({ maxHp: 152, relics: ['ironRing'] });
  const r = simulateArena(ch, ch, 1);
  assert.equal(r.playerMaxHp, 152);
  assert.equal(r.enemyMaxHp, 152);
  assert.equal(r.playerMaxHp, Math.round(152));
});

/* ------------------------------------------------------------------ *
 * 匹配 —— 真实快照，零缩放
 * ------------------------------------------------------------------ */

test('匹配到的对手是原样快照：血量 / 攻击 / 卡组 / 宝物一个数都不改', () => {
  const meta = createMeta(11);
  const hero = createCharacter({ classId: 'mage', raceId: 'shade', seed: 8 });
  hero.level = 12;

  const opps = matchOpponents(meta, ratingOf(hero), new Rng(3), 3);
  assert.equal(opps.length, 3);

  const src = new Map(meta.ghosts.map((g) => [g.id, g]));
  for (const g of opps) {
    const base = src.get(g.id);
    assert.ok(base, '对手必须来自幽灵池，不能现场捏一个');
    assert.equal(g.maxHp, base.maxHp);
    assert.equal(g.atk, base.atk);
    assert.deepEqual(g.deck, base.deck);
    assert.deepEqual(g.relics, base.relics);
  }
});

test('匹配是"分数相邻的三人"，不是随机抽三个', () => {
  const meta = createMeta(11);
  const scores = meta.ghosts.map((g) => scoreOf(g)).sort((a, b) => a - b);
  const mid = scores[Math.floor(scores.length / 2)];

  const opps = matchOpponents(meta, mid, new Rng(1), 3);
  const rs = opps.map((g) => scoreOf(g));
  assert.deepEqual(rs, rs.slice().sort((a, b) => a - b), '展示顺序要弱→强');
  assert.ok(rs.some((r) => r >= mid), '要有一个不弱于自己的');
  assert.ok(rs.some((r) => r <= mid), '要有一个不比自己强的');

  const span = scores[scores.length - 1] - scores[0];
  for (const r of rs) assert.ok(Math.abs(r - mid) <= span * 0.6, '不该抽到离得很远的');
});

test('匹配是"分数相邻的三人"，不是随机抽三个', () => {
  const meta = createMeta(11);
  const scores = meta.ghosts.map((g) => scoreOf(g)).sort((a, b) => a - b);
  const mid = scores[Math.floor(scores.length / 2)];

  const opps = matchOpponents(meta, mid, new Rng(1), 3);
  const rs = opps.map((g) => scoreOf(g));
  assert.deepEqual(rs, rs.slice().sort((a, b) => a - b), '展示顺序要弱→强');
  assert.ok(rs.some((r) => r >= mid), '要有一个不弱于自己的');
  assert.ok(rs.some((r) => r <= mid), '要有一个不比自己强的');

  const span = scores[scores.length - 1] - scores[0];
  for (const r of rs) assert.ok(Math.abs(r - mid) <= span * 0.6, '不该抽到离得很远的');
});

test('幽灵池空了也不崩，返回空数组', () => {
  assert.deepEqual(matchOpponents({ ghosts: [] }, 500, new Rng(1), 3), []);
  assert.deepEqual(matchOpponents({ ghosts: [null, { id: 'x' }] }, 500, new Rng(1), 3), []);
});

test('预置幽灵分两组：低段位陪练 + 转过正的高段位（v3.35）', () => {
  const pool = buildGhostPool(11);
  assert.equal(pool.length, 15, '3 个陪练 + 12 个正式');
  for (const g of pool) {
    assert.equal(typeof g.arenaScore, 'number', `${g.name} 缺段位分`);
    if (g.arenaScore >= 980) {
      /** 高段位组：按世界观是"活着从塔里回来的人"，不能是刚招募的新人 */
      assert.ok(g.level >= 8, `${g.name} 只有 ${g.level} 级`);
      assert.ok(g.deck.length >= 20, `${g.name} 卡组只有 ${g.deck.length} 张`);
      assert.ok(g.relics.length >= 3, `${g.name} 只有 ${g.relics.length} 件宝物`);
    } else {
      /** 低段位陪练：3~8 级，让 1 级新人在铁/青铜有得打 */
      assert.ok(g.level >= 3 && g.level <= 8, `${g.name} ${g.level} 级，不在陪练区间`);
      assert.ok(g.deck.length >= 14, `${g.name} 卡组只有 ${g.deck.length} 张`);
    }
    assert.equal(g.relicSlot, undefined);
    assert.equal((g.relicSlots || []).length, 0, '种族宝物要已激活，未激活的不该带进竞技场');
  }
  /** 分数要落在战力相当的区间：低段位陪练拿最低的三个分数，且分数不重复 */
  const byScore = [...pool].sort((a, b) => a.arenaScore - b.arenaScore);
  assert.equal(new Set(byScore.map((g) => g.arenaScore)).size, byScore.length, '分数不应重复');
  for (const g of byScore.slice(0, 3)) {
    assert.ok(g.arenaScore < 980, `${g.name}(${g.arenaScore}) 应该是低段位陪练`);
    assert.ok(g.level < 8, `${g.name} ${g.level} 级太高，起不到陪练作用`);
  }
});

/* ------------------------------------------------------------------ *
 * 先手与补偿
 * ------------------------------------------------------------------ */

test('先手由种子掷出，不是永远玩家先动', () => {
  const meta = createMeta(11);
  const ch = meta.ghosts[5];

  let first = 0;
  const n = 80;
  for (let s = 0; s < n; s++) {
    if (simulateArena(ch, ch, 4000 + s * 17).playerFirst) first++;
  }
  assert.ok(first > n * 0.3 && first < n * 0.7, `先手率 ${(first / n * 100).toFixed(0)}% 偏离 50% 太多`);
});

test('谁先手可以指定（给模拟扫参用）', () => {
  const ch = stub();
  assert.equal(simulateArena(ch, ch, 77, { forceFirst: 'p' }).playerFirst, true);
  assert.equal(simulateArena(ch, ch, 77, { forceFirst: 'e' }).playerFirst, false);
});

test('后手补偿存在，且只在第一次行动给', () => {
  assert.ok(SECOND_ENERGY > 0 && SECOND_DRAW > 0, '没有补偿的话先手优势会大到离谱');

  // 后手第一回合手牌 = 5 + 2 = 7（手牌上限），先手 5
  const ch = stub({ deck: Array(20).fill('guard'), atk: 10, maxHp: 400 });
  const a = simulateArena(ch, ch, 21, { forceFirst: 'p' });
  const b = simulateArena(ch, ch, 21, { forceFirst: 'e' });

  const handCount = (r, side, turn) => {
    // 第一条"回合开始"之后的出牌数 ≈ 那一回合的手牌数（能量够的话）
    return r.log.filter((l) => l.side === side && l.turn === turn && l.name !== '回合开始').length;
  };
  assert.ok(
    handCount(b, 'p', 1) >= handCount(a, 'p', 1),
    '玩家后手时第一回合应该能打出不少于先手时的牌',
  );
});

/* ------------------------------------------------------------------ *
 * 对称性 —— 这是镜像战唯一真正重要的不变量
 * ------------------------------------------------------------------ */

test('同角色自我对战：总胜率接近 50%', () => {
  const meta = createMeta(11);
  const ch = meta.ghosts[5];

  let w = 0;
  const n = 100;
  for (let s = 0; s < n; s++) if (simulateArena(ch, ch, 8000 + s * 23).win) w++;

  const rate = w / n;
  assert.ok(rate > 0.35 && rate < 0.65, `自我对战胜率 ${(rate * 100).toFixed(0)}%，镜像战不对称`);
});

test('同角色自我对战：四个职业都不能一面倒', () => {
  const meta = createMeta(11);
  for (const g of meta.ghosts) {
    let w = 0;
    const n = 40;
    for (let s = 0; s < n; s++) if (simulateArena(g, g, 12_000 + s * 29).win) w++;
    const rate = w / n;
    assert.ok(rate > 0.2 && rate < 0.8, `${g.name}（${g.classId}）自我对战 ${(rate * 100).toFixed(0)}%`);
  }
});

test('结果里的血量是快照真实血量，不是被赛制放大后的数', () => {
  const hero = stub({ maxHp: 150, deck: Array(6).fill('strike'), atk: 30 });
  const ghost = stub({ maxHp: 120, deck: Array(6).fill('guard'), atk: 1 });

  const r = simulateArena(hero, ghost, 31);
  assert.equal(r.playerMaxHp, 150);
  assert.equal(r.enemyMaxHp, 120);
  assert.ok(r.playerHp <= 150 && r.enemyHp <= 120);
  // 内部确实按赛制放大了
  assert.ok(ARENA_HP_MUL >= 1, '赛制系数不该被去掉');
});

test('再长的对局也会在回合上限内结束', () => {
  // 两个纯护甲对撞：谁都不出伤害，靠加时狂暴和上限兜底
  const turtle = stub({ deck: Array(12).fill('brace'), atk: 10, maxHp: 500 });
  const r = simulateArena(turtle, turtle, 3);
  assert.ok(r.turns <= ARENA_MAX_TURNS);
  assert.equal(typeof r.win, 'boolean');
});

test('estimateWinRate 给的是多次模拟的平均', () => {
  const a = stub({ deck: Array(8).fill('strike'), atk: 20, maxHp: 200 });
  const b = stub({ deck: Array(8).fill('jab'), atk: 5, maxHp: 100 });
  const rate = estimateWinRate(a, b, 5);
  assert.ok(rate >= 0 && rate <= 1);
  assert.ok(rate > 0.8, '攻击 20 打攻击 5 应该赢得很多');
});

/* ------------------------------------------------------------------ *
 * 存档：预置幽灵随版本重建
 * ------------------------------------------------------------------ */

test('读档时预置幽灵重建为新版，玩家自己的历史快照保留', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  try {
    // 旧档：预置幽灵还是"1~5 级白板"那一批
    const stale = { ...stub({ maxHp: 96, atk: 10 }), name: '石头人战士·幽灵', status: 'ghost' };
    const mine = { ...stub({ maxHp: 168, atk: 14 }), name: '青苔族猎人·旧影', status: 'ghost' };

    store.set('ruin-spire/hall', JSON.stringify({
      version: SAVE_VERSION,
      seed: 11,
      gold: 300,
      roster: [],
      candidates: [],
      slotReadyAt: [],
      ghosts: [stale, mine],
      graveyard: [],
      counter: 1,
      log: [],
    }));

    const meta = loadMeta(1);
    const presets = meta.ghosts.filter((g) => String(g.name).endsWith('·幽灵'));

    assert.equal(presets.length, 15, '预置幽灵应该整体换成新的一批（3 陪练 + 12 正式）');
    for (const g of presets) {
      assert.ok(g.level >= 3, `${g.name} 还是旧版白板`);
      const floor = g.arenaScore >= 980 ? 96 : 40;
      assert.ok(g.maxHp > floor, `${g.name} 血量没跟着重建`);
      assert.equal(typeof g.arenaScore, 'number', `${g.name} 缺段位分`);
    }
    assert.equal(meta.gold, 300, '重建幽灵不能动到金币');
    assert.ok(meta.ghosts.some((g) => g.name === '青苔族猎人·旧影'), '玩家自己的快照必须留着');
  } finally {
    delete globalThis.localStorage;
  }
});

/* ------------------------------------------------------------------ *
 * 交互流程（v3.33）—— 玩家亲手出牌，对手逐张亮牌
 * ------------------------------------------------------------------ */

test('开局就把手牌发给玩家：能出牌、扣能量、进弃牌堆', () => {
  const ch = stub({ deck: Array(20).fill('guard'), atk: 10, maxHp: 400 });
  const b = createArenaBattle(ch, ch, 21, { forceFirst: 'p' });

  assert.equal(b.phase, 'player');
  assert.ok(b.player.hand.length > 0, '玩家回合应该已经有手牌');
  assert.equal(b.player.energy, MAX_ENERGY);

  const handBefore = b.player.hand.length;
  const energyBefore = b.player.energy;
  const res = arenaPlay(b, 0);

  assert.equal(res.ok, true);
  assert.equal(b.player.hand.length, handBefore - 1);
  assert.equal(b.player.energy, energyBefore - 1, '格挡 1 费');
  assert.equal(b.player.discard.length, 1);
  assert.ok(res.events.length > 0, '出牌要带回事件，UI 靠它飘字/放音');
});

test('打不出去的牌会被拒绝，并且不消耗任何东西', () => {
  const ch = stub({ deck: Array(20).fill('guard'), atk: 10, maxHp: 400 });
  const b = createArenaBattle(ch, ch, 21, { forceFirst: 'p' });

  b.player.energy = 0;
  const hand = b.player.hand.length;
  const res = arenaPlay(b, 0);
  assert.equal(res.ok, false, '能量为 0 时不能出 1 费的牌');
  assert.equal(b.player.hand.length, hand);
  assert.equal(b.player.discard.length, 0);

  const noSuch = arenaPlay(b, 99);
  assert.equal(noSuch.ok, false);
});

test('结束回合后轮到对手，它一张一张出，出完交回玩家', () => {
  const ch = stub({ deck: Array(20).fill('strike'), atk: 10, maxHp: 600 });
  const b = createArenaBattle(ch, ch, 21, { forceFirst: 'p' });

  const end = arenaEndTurn(b);
  assert.equal(end.phase, 'enemy');
  assert.equal(b.phase, 'enemy');

  let steps = 0;
  let cards = 0;
  while (b.phase === 'enemy' && steps++ < 30) {
    const s = arenaEnemyStep(b);
    if (s.card) cards++;
    assert.ok(s.phase === 'enemy' || s.phase === 'player' || s.phase === 'won' || s.phase === 'lost');
    if (s.done) break;
  }
  assert.ok(cards > 0, '对手应该至少打出一张牌');
  assert.equal(b.phase, 'player', '对手收场后必须把回合交回玩家');
  assert.ok(b.player.hand.length > 0, '新回合应该重新发牌');
});

test('对手先手时，进战斗屏就是它的回合', () => {
  const ch = stub({ deck: Array(20).fill('strike'), atk: 10, maxHp: 400 });
  const b = createArenaBattle(ch, ch, 21, { forceFirst: 'e' });
  assert.equal(b.phase, 'enemy');
  assert.ok(b.enemy.hand.length > 0, '它的手牌在开场就抽好了');
  assert.equal(b.player.hand.length, 0, '玩家还没轮到，手上不该有牌');
});

test('交互打完整场：手打死也会落到赢得/输掉/超时三个终局之一', () => {
  const hero = stub({ deck: Array(12).fill('strike'), atk: 30, maxHp: 200 });
  const ghost = stub({ deck: Array(12).fill('guard'), atk: 5, maxHp: 120 });

  const b = createArenaBattle(hero, ghost, 5);
  let guard = 0;
  while ((b.phase === 'player' || b.phase === 'enemy') && guard++ < 400) {
    if (b.phase === 'player') {
      /** 无脑出第一张打得起的牌 —— 测的是流程，不是策略 */
      for (;;) {
        const i = b.player.hand.findIndex((k) => {
          const c = cardOf(k);
          return c && !c.unplayable && c.cost <= b.player.energy;
        });
        if (i < 0) break;
        if (!arenaPlay(b, i).ok) break;
        if (b.phase !== 'player') break;
      }
      if (b.phase !== 'player') break;
      arenaEndTurn(b);
    } else {
      arenaEnemyStep(b);
    }
  }

  assert.ok(['won', 'lost', 'timeout'].includes(b.phase), `终局相位异常：${b.phase}`);
  const r = arenaResult(b);
  assert.equal(typeof r.win, 'boolean');
  assert.ok(r.playerHp <= r.playerMaxHp && r.enemyHp <= r.enemyMaxHp);
  assert.ok(r.log.length > 0, '一场决斗必须留下战斗记录');
});

test('渲染快照给全 UI 需要的字段，且不泄露对手手牌', () => {
  const ch = stub({ deck: Array(12).fill('strike'), atk: 10, maxHp: 300 });
  const b = createArenaBattle(ch, ch, 21, { forceFirst: 'p' });
  const v = arenaBattleView(b);

  assert.equal(v.phase, 'player');
  assert.ok(Array.isArray(v.hand) && v.hand.length > 0);
  assert.equal(typeof v.player.armor, 'number');
  assert.equal(typeof v.enemy.poison, 'number');
  assert.equal(v.enemy.hand, undefined, '对手的手牌只能给张数，不能给牌面');
  assert.equal(typeof v.enemy.handCount, 'number');
  assert.equal(v.hand.length, b.player.hand.length);
});

test('能量上限：竞技场按角色掷点回能（v3.58），旧角色缺字段退回 8', () => {
  const hero = { ...stub({ deck: Array(8).fill('strike') }), energy: 5 };
  const ghost = { ...stub({ deck: Array(8).fill('strike') }), energy: 7 };
  const b = createArenaBattle(hero, ghost, 9, { forceFirst: 'p' });
  assert.equal(b.player.energyCap, 5, '出战角色 5 能量');
  assert.equal(b.enemy.energyCap, 7, '对手影子 7 能量');
  /** 先手方不拿后手补偿，开场能量就是自己的上限 */
  assert.equal(b.player.energy, 5);
  assert.equal(b.player.energy, b.player.energyCap);

  const legacy = stub({ deck: Array(8).fill('strike') });
  const b2 = createArenaBattle(legacy, legacy, 9, { forceFirst: 'p' });
  assert.equal(b2.player.energyCap, MAX_ENERGY, '没有 energy 字段的旧角色按全局 8');
});
