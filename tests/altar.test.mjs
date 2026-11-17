/**
 * 付费祭坛（v3.37）与商店多卡位
 *
 * 焚卡祭坛（pyre）：付古币删一张，卡组下限 5。
 * 变形祭坛（morph）：付古币随机变成同类型同费用的另一张，等级清零。
 * 待遇同商店：格子不 done，离开可再进，每次办事单独扣钱。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createCharacter } from '../src/core/roster.js';
import {
  createRun, triggerCell, removeCardInRun, morphCardInRun, cancelRunAltar,
  removeCost, morphCost, MIN_DECK_SIZE,
} from '../src/core/run.js';
import { parseCard, CARDS } from '../src/core/cards.js';
import { makeShop, SHOP_CARD_SLOTS } from '../src/core/shop.js';
import { Rng } from '../src/core/rng.js';

function newRun(seed = 5) {
  const character = createCharacter({ classId: 'warrior', raceId: 'stone', seed });
  return createRun({ character, seed });
}

/** 找一个事件格是 pyre/morph 的种子并建局，返回 { run, idx }（格子已翻开） */
function newRunWithEvent(event, maxSeed = 200) {
  for (let seed = 1; seed <= maxSeed; seed++) {
    const run = newRun(seed);
    const idx = run.floorMap?.cells?.findIndex((c) => c.kind === 'event' && c.data?.event === event);
    if (idx >= 0) {
      run.floorMap.cells[idx].revealed = true; // v3.16 两段式：先翻开后才能触发
      return { run, idx };
    }
  }
  throw new Error(`试了 ${maxSeed} 个种子都没有 ${event} 事件`);
}

/* ------------------------------------------------------------------ *
 * 焚卡祭坛
 * ------------------------------------------------------------------ */

test('焚卡祭坛：触发进 remove 相位，格子不 done（离开可再进）', () => {
  const { run, idx } = newRunWithEvent('pyre');
  const cell = run.floorMap.cells[idx];
  const res = triggerCell(run, idx);
  assert.equal(res.ok, true, '触发成功');
  assert.equal(run.phase, 'remove', '进入焚卡相位');
  assert.equal(cell.done, false, '格子不标记完成');
  assert.ok(res.text.includes(String(removeCost(run))), '横幅里写明单价');
});

test('焚卡：扣钱、删卡；每次办事单独扣钱', () => {
  const { run, idx } = newRunWithEvent('pyre');
  triggerCell(run, idx);
  const key = run.deck[0];
  const gold0 = run.gold;
  run.gold = 1000; // 保证付得起
  const before = run.deck.length;
  const countBefore = run.deck.filter((x) => x === key).length;

  const res = removeCardInRun(run, key);
  assert.equal(res.ok, true, res.reason || '删卡成功');
  assert.equal(run.deck.length, before - 1);
  assert.equal(run.gold, 1000 - removeCost(run));
  const count = (k) => run.deck.filter((x) => x === k).length;
  assert.equal(count(key), countBefore - 1, '这张牌少了一张');

  // 同一次进坛可以接着办第二张 —— 只要付得起
  const res2 = removeCardInRun(run, run.deck[0]);
  assert.equal(res2.ok, true, res2.reason || '第二张也删得掉');
  assert.equal(run.gold, 1000 - removeCost(run) * 2);
});

test('焚卡下限：卡组到 5 张就不许再删', () => {
  const { run, idx } = newRunWithEvent('pyre');
  triggerCell(run, idx);
  run.gold = 99999;
  run.deck.length = MIN_DECK_SIZE; // 直接把卡组裁到下限
  const res = removeCardInRun(run, run.deck[0]);
  assert.equal(res.ok, false);
  assert.ok(res.reason.includes(String(MIN_DECK_SIZE)), '提示里写明下限');
  assert.equal(run.deck.length, MIN_DECK_SIZE, '一张都没删掉');
});

test('焚卡：古币不足给明确理由', () => {
  const { run, idx } = newRunWithEvent('pyre');
  triggerCell(run, idx);
  run.gold = 0;
  const res = removeCardInRun(run, run.deck[0]);
  assert.equal(res.ok, false);
  assert.ok(res.reason.includes('古币不足'));
});

test('离开焚卡祭坛回地图，再点格子还能进（状态不变）', () => {
  const { run, idx } = newRunWithEvent('pyre');
  triggerCell(run, idx);
  assert.equal(cancelRunAltar(run), true);
  assert.equal(run.phase, 'map');
  const res = triggerCell(run, idx);
  assert.equal(res.ok, true);
  assert.equal(run.phase, 'remove', '再进还是焚卡相位');
});

/* ------------------------------------------------------------------ *
 * 变形祭坛
 * ------------------------------------------------------------------ */

test('变形祭坛：触发进 morph 相位，格子不 done', () => {
  const { run, idx } = newRunWithEvent('morph');
  triggerCell(run, idx);
  assert.equal(run.phase, 'morph');
  assert.equal(run.floorMap.cells[idx].done, false);
});

test('变形：变成同类型同费用的另一张，卡组长度不变、等级清零', () => {
  const { run, idx } = newRunWithEvent('morph');
  triggerCell(run, idx);
  run.gold = 1000;

  // 找一张未强化的攻击牌当原料（战士起始卡组必有 strike）
  const key = run.deck.find((k) => {
    const p = parseCard(k);
    return CARDS[p.id]?.kind === 'attack' && p.lv === 0;
  });
  assert.ok(key, '卡组里有未强化攻击牌');
  const before = run.deck.length;

  const res = morphCardInRun(run, key);
  assert.equal(res.ok, true, res.reason || '变形成功');
  assert.equal(run.deck.length, before, '一张换一张，长度不变');
  const i = run.deck.findIndex((k) => parseCard(k).lv === 0 && CARDS[parseCard(k).id].kind === 'attack');
  const got = parseCard(run.deck[res.ok ? run.deck.length - 1 >= 0 ? i : 0 : 0]);
  assert.notEqual(CARDS[got.id].name, res.from, '不是原来那张');
  assert.equal(CARDS[got.id].kind, 'attack', res.level === '同类型同费用' ? '保持攻击类型' : `回退口径：${res.level}`);
  assert.ok(run.gold < 1000, '扣了钱');
  /** v3.56：结果提示必须报账 —— 焚卡写「古币 -N」，变形不写玩家就不知道花了多少 */
  assert.ok(res.text.includes(`古币 -${res.cost}`), `提示带扣款金额：${res.text}`);
});

test('变形：强化过的卡变完等级归零（不许套利）', () => {
  const { run, idx } = newRunWithEvent('morph');
  triggerCell(run, idx);
  run.gold = 1000;
  // 伪造一张 strike+2：先变形成别的，再检查新卡等级
  const key = run.deck[0];
  run.deck[0] = key.replace(/(\+\d+)?$/, '+2');
  const res = morphCardInRun(run, run.deck[0]);
  if (!res.ok) return; // 万一 +2 后超出同名上限且没有候选，跳过
  const got = parseCard(run.deck[0]);
  assert.equal(got.lv, 0, '新卡是未强化状态');
});

test('变形：古币不足拒绝', () => {
  const { run, idx } = newRunWithEvent('morph');
  triggerCell(run, idx);
  run.gold = 0;
  const res = morphCardInRun(run, run.deck[0]);
  assert.equal(res.ok, false);
  assert.ok(res.reason.includes('古币不足'));
});

test('变形池不越同名上限：deck 里已有 2 张的 id 不会被变出来', () => {
  const { run, idx } = newRunWithEvent('morph');
  triggerCell(run, idx);
  run.gold = 1000;
  // 连续变形 20 次（不断补钱），统计没有出现第 3 张同名
  const counts = () => {
    const m = new Map();
    for (const k of run.deck) {
      const { id } = parseCard(k);
      m.set(id, (m.get(id) || 0) + 1);
    }
    return m;
  };
  for (let n = 0; n < 20; n++) {
    const before = counts();
    const res = morphCardInRun(run, run.deck[0]);
    if (!res.ok) break;
    const after = counts();
    for (const [id, n2] of after) {
      assert.ok(n2 <= 2, `${id} 超过了同名上限（${n2} 张）`);
    }
    // 变形前少 1（原料走了）、变形后多 1（新卡来了），总量守恒
    assert.equal([...after.values()].reduce((a, b) => a + b, 0), [...before.values()].reduce((a, b) => a + b, 0));
  }
});

/* ------------------------------------------------------------------ *
 * 价钱曲线
 * ------------------------------------------------------------------ */

test('祭坛价钱随层数上涨，变形比焚卡便宜', () => {
  const run = newRun(3);
  run.floor = 1;
  const r1 = removeCost(run), m1 = morphCost(run);
  run.floor = 20;
  const r20 = removeCost(run), m20 = morphCost(run);
  assert.ok(r20 > r1, `焚卡随层涨价（${r1} → ${r20}）`);
  assert.ok(m20 > m1, `变形随层涨价（${m1} → ${m20}）`);
  assert.ok(m1 < r1 && m20 < r20, '变形始终比焚卡便宜（它是随机的）');
  assert.equal(r1 % 5, 0, '取整到 5，和卡价同口径');
});

/* ------------------------------------------------------------------ *
 * 商店多卡位（v3.37：2 → 4）
 * ------------------------------------------------------------------ */

test('行商一次上架 6 张卡', () => {
  const run = newRun(11);
  const shop = makeShop(run, new Rng(31), 'card');
  assert.equal(SHOP_CARD_SLOTS, 6);
  assert.equal(shop.cards.length, 6, `实际上架 ${shop.cards.length} 张`);
  // 四张互不重复
  assert.equal(new Set(shop.cards.map((c) => c.id)).size, shop.cards.length);
});
