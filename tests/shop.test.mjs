/**
 * 局内商店（v1.8）
 *
 * 这一层的规则全部是"钱和货"的算术，必须在 core 里可测：
 * 商店一旦变成 UI 里的 if 判断，价格、概率、保底就再也对不上了。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../src/core/rng.js';
import { CARDS, GENERIC_CARD_IDS } from '../src/core/cards.js';
import { CLASSES } from '../src/core/characters.js';
import { RELICS } from '../src/core/relics.js';
import { createCharacter } from '../src/core/roster.js';
import { createRun, applyReward, leaveShop, finishBattle, triggerCell, advanceFloor } from '../src/core/run.js';
import { MAX_FLOOR } from '../src/core/enemies.js';
import { makeFloorMap } from '../src/core/dungeon.js';
import { enterFirstBattle } from './_helpers.mjs';
import {
  goldFromBattle, cardPrice, relicPrice, relicShopPrice, shouldOpenShop, makeShop,
  buyShopCard, buyShopRelic, SHOP_MIN_GAP, SHOP_CARD_SLOTS, SHOP_RELIC_SLOTS, RELIC_PRICE,
  refreshCost, refreshShop, SHOP_KIND,
  CARD_REFRESH_BASE, CARD_REFRESH_STEP, CARD_REFRESH_PER_FLOOR, RELIC_REFRESH_BASE,
  RELIC_SHOP_MIN_GAP, SHOP_MAX_CHANCE,
} from '../src/core/shop.js';
import { MATERIAL_PER_RELIC } from '../src/core/meta.js';
import { saveRun, loadRun, clearRun } from '../src/core/save.js';

function newRun(seed = 5) {
  const character = createCharacter({ classId: 'warrior', raceId: 'stone', seed });
  return createRun({ character, seed });
}

/* ------------------------------------------------------------------ *
 * 金币
 * ------------------------------------------------------------------ */

test('杀怪金币：随层数增长，精英/首领有额外倍率', () => {
  assert.ok(goldFromBattle(10, 'normal') > goldFromBattle(1, 'normal'));
  assert.ok(goldFromBattle(10, 'elite') > goldFromBattle(10, 'normal'));
  assert.ok(goldFromBattle(10, 'boss') > goldFromBattle(10, 'elite'));
  /** 第 1 层至少够"看得见"，第 30 层首领也不该一次给到能买两张牌 */
  assert.ok(goldFromBattle(1, 'normal') >= 4);
  assert.ok(goldFromBattle(30, 'boss') < cardPrice('strike', 30) * 2);
});

test('打赢一场：局内金币真的进 run.gold', () => {
  const run = newRun(7);
  assert.ok(enterFirstBattle(run), 'v2.0：先翻格遇到敌人才有战斗');
  const tier = run.battle.enemy.tier;
  const expect = goldFromBattle(run.floor, tier);

  run.battle.phase = 'won';
  finishBattle(run);

  assert.equal(run.gold, expect);
  assert.equal(run.lastGold, expect);
  /** 掉落是概率（普通 45%），没掉就回地图、掉了才进奖励 */
  assert.ok(run.phase === 'reward' || run.phase === 'map');
});

'use strict';

/* ------------------------------------------------------------------ *
 * 价格
 * ------------------------------------------------------------------ */

test('卡价：费用越高越贵，power 牌额外加价，且随层数微涨', () => {
  assert.ok(cardPrice('heavy', 5) > cardPrice('strike', 5), '2 费该比 1 费贵');
  assert.ok(cardPrice('banner', 5) > cardPrice('toxin', 5), '永久牌该比普通牌贵');
  assert.ok(cardPrice('strike', 20) > cardPrice('strike', 2), '越往后越贵');
  assert.equal(cardPrice('strike', 7) % 5, 0, '价格取整到 5，商店里不出现 63 这种数');
});

test('宝物价格：按链递增，通用宝物最贵', () => {
  assert.ok(relicPrice('anvil') < relicPrice('poisonGem'), 'A 链该比 B 链便宜');
  assert.ok(relicPrice('poisonGem') <= relicPrice('moltenCore'), 'B 链不该比 C 链贵');
  /** 比激活种族槽位（3 个）更贵：商店卖的是成品，且不占槽位 */
  assert.ok(RELIC_PRICE.A >= MATERIAL_PER_RELIC);
});

/* ------------------------------------------------------------------ *
 * 出现概率
 * ------------------------------------------------------------------ */

test('第 1 层不开商店：玩家还没有任何金币和材料', () => {
  assert.equal(shouldOpenShop({ floor: 1, lastShopFloor: 1 }, new Rng(1)), false);
});

test('连续 5 层没出，这一层必出（纯概率会让部分种子整局碰不到）', () => {
  /** 一个永远返回 0.999 的 rng：概率判定必然失败，只有保底能让它开 */
  const never = { next: () => 0.999 };
  assert.equal(
    shouldOpenShop({ floor: 1 + SHOP_MIN_GAP, lastShopFloor: 1 }, never),
    true,
  );
  assert.equal(
    shouldOpenShop({ floor: SHOP_MIN_GAP, lastShopFloor: 1 }, never),
    false,
    '差一层还不到保底',
  );
});

test('出现概率随层数上升，但封顶不高（v3.13 合计压到约 8 次 / 30 层）', () => {
  const rng = new Rng(2024);
  /** N 要够大：3000 次的抽样噪声有 ±0.8%，会把"封顶"断言抖出去 */
  const rate = (floor) => {
    let hit = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      if (shouldOpenShop({ floor, lastShopFloor: floor - 1 }, rng)) hit++;
    }
    return hit / N;
  };

  const low = rate(3);
  const high = rate(24);
  assert.ok(low > 0.06 && low < 0.12, `第 3 层概率异常: ${low}`);
  assert.ok(high > low, `高层该更容易遇到行商: ${low} → ${high}`);
  assert.ok(high >= SHOP_MAX_CHANCE - 0.02 && high <= SHOP_MAX_CHANCE + 0.02,
    `概率必须封顶在 SHOP_MAX_CHANCE 附近: ${high}`);
});

test('商店密度：30 层大约 6~7 次，不该退化成"每两层一个"（v3.11）', () => {
  /**
   * 用户反馈"怎么感觉每层都有商店" —— 旧参数（22% 起步 / 5 层保底）
   * 模拟出来是 12.5 次/30 层，体感属实。这条断言是防回归的：
   * 概率判定 + 保底一旦又叠太紧，这里会直接红。
   */
  let total = 0;
  const seeds = 40;
  for (let seed = 1; seed <= seeds; seed++) {
    const run = newRun(seed);
    let shops = 0;
    for (let floor = 2; floor <= 30; floor++) {
      run.floor = floor;
      makeFloorMap(run);
      if (run.floorMap.cells.some((c) => c.kind === 'shop')) shops++;
    }
    total += shops;
  }
  const avg = total / seeds;
  assert.ok(avg >= 4 && avg <= 9, `30 层平均商店次数异常: ${avg.toFixed(2)}`);
});

/* ------------------------------------------------------------------ *
 * 货架
 * ------------------------------------------------------------------ */

test('货架：行商只卖 6 张卡（v3.13 拆店后不再卖宝物），卡池只含通用与本职业', () => {
  const run = newRun(11);
  const shop = makeShop(run, new Rng(31), 'card');
  const cls = CLASSES[run.classId];

  assert.equal(shop.kind, 'card');
  assert.equal(shop.cards.length, SHOP_CARD_SLOTS);
  assert.equal(shop.relics.length, 0, '宝物已经搬到宝库去卖了');
  assert.equal(shop.refreshes, 0);

  for (const it of shop.cards) {
    const c = CARDS[it.id];
    assert.ok(c, `货架上的卡必须存在: ${it.id}`);
    assert.ok(!c.race, '种族卡不能出现在商店里');
    assert.ok(
      GENERIC_CARD_IDS.includes(it.id) || cls.pool.includes(it.id),
      `不能卖别的职业的牌: ${it.id}`,
    );
    assert.equal(it.price, cardPrice(it.id, run.floor));
    assert.equal(it.sold, false);
  }
});

test('货架：宝库一次上架 6 件宝物（v3.65），不卖卡、互不重复、不上架已经有的', () => {
  const run = newRun(11);
  const shop = makeShop(run, new Rng(31), 'relic');

  assert.equal(shop.kind, 'relic');
  assert.equal(shop.cards.length, 0, '宝库不卖卡');
  assert.equal(shop.relics.length, SHOP_RELIC_SLOTS);
  assert.equal(
    new Set(shop.relics.map((r) => r.id)).size,
    shop.relics.length,
    '同一格货架上不会出现两件同 id 的宝物',
  );

  for (const relic of shop.relics) {
    assert.ok(RELICS[relic.id]);
    assert.ok(!run.relics.includes(relic.id), '已经在手上的宝物不该再卖');
    assert.ok(!run.relicSlots.includes(relic.id), '种族槽里还没激活的宝物也不该卖');
    /** v3.40：带等级件按「等级 = 水晶数」计价，无等级件按链条基础价 */
    assert.equal(relic.price, relicShopPrice(relic.id, relic.lv), '价格走 relicShopPrice 统一口径');
  }
});

test('货架：同名卡已经 2 张就不再上架（商店不能绕过防刷规则）', () => {
  const run = newRun(12);
  /** 把卡组里每种牌都凑够 2 张 */
  run.deck = [...run.deck, ...run.deck];

  for (let seed = 1; seed <= 30; seed++) {
    const shop = makeShop(run, new Rng(seed));
    for (const it of shop.cards) {
      const n = run.deck.filter((k) => k.split('+')[0] === it.id || k === it.id).length;
      assert.ok(n < 2, `同名卡已满 2 张还上架: ${it.id}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * 购买
 * ------------------------------------------------------------------ */

test('买卡：扣金币、进卡组、标记售出，不能重复买', () => {
  const run = newRun(13);
  run.gold = 500;
  run.shop = { cards: [{ id: 'strike', price: 60, sold: false }], relics: [] };
  const before = run.deck.length;

  const res = buyShopCard(run, 0);
  assert.equal(res.ok, true);
  assert.equal(run.gold, 440);
  assert.equal(run.deck.length, before + 1);
  assert.equal(run.deck.at(-1), 'strike');
  assert.equal(run.shop.cards[0].sold, true);

  const again = buyShopCard(run, 0);
  assert.equal(again.ok, false);
  assert.equal(run.gold, 440, '失败不能扣钱');
  assert.equal(run.deck.length, before + 1);
});

test('买卡：金币不够时拒绝，且卡组/金币都不动', () => {
  const run = newRun(14);
  run.gold = 10;
  run.shop = { cards: [{ id: 'heavy', price: 90, sold: false }], relics: [] };
  const before = run.deck.slice();

  const res = buyShopCard(run, 0);
  assert.equal(res.ok, false);
  assert.match(res.reason, /古币不足/);
  assert.equal(run.gold, 10);
  assert.deepEqual(run.deck, before);
  assert.equal(run.shop.cards[0].sold, false);
});

test('买宝物：扣材料、进宝物栏，面板型宝物当场生效', () => {
  const run = newRun(15);
  run.materials = 5;
  run.shop = { cards: [], relics: [{ id: 'ironRing', price: 3, sold: false }] };
  const hpBefore = run.player.maxHp;

  const res = buyShopRelic(run, 0);
  assert.equal(res.ok, true);
  assert.equal(run.materials, 2);
  assert.ok(run.relics.includes('ironRing'));
  assert.equal(run.player.maxHp, hpBefore + RELICS.ironRing.hpFlat, '买完血量上限要立刻+18');
  assert.equal(run.stats.relicsTaken, 1);
});

test('买宝物：材料不够时拒绝（材料是抢手货，不能超支）', () => {
  const run = newRun(16);
  run.materials = 2;
  run.shop = { cards: [], relics: [{ id: 'ironRing', price: 3, sold: false }] };

  const res = buyShopRelic(run, 0);
  assert.equal(res.ok, false);
  assert.match(res.reason, /材料不足/);
  assert.equal(run.materials, 2);
  assert.ok(!run.relics.includes('ironRing'));
});

/* ------------------------------------------------------------------ *
 * 刷新（v3.13）
 * ------------------------------------------------------------------ */

test('刷新：行商花古币，每次贵一档，货架真的会换', () => {
  const run = newRun(21);
  run.floor = 8;
  run.gold = 500;
  run.shop = makeShop(run, new Rng(5), SHOP_KIND.CARD);

  const c0 = refreshCost(run);
  assert.ok(c0 >= CARD_REFRESH_BASE, '第一次刷新不该比底价便宜');
  assert.equal(c0 % 5, 0, '刷新价取整到 5，和卡价同一口径');

  const r1 = refreshShop(run);
  assert.equal(r1.ok, true);
  assert.equal(run.gold, 500 - c0);
  assert.equal(run.shop.refreshes, 1);

  const c1 = refreshCost(run);
  assert.equal(c1 - c0, CARD_REFRESH_STEP, `每次刷新该贵一档: ${c0} → ${c1}`);

  const r2 = refreshShop(run);
  assert.equal(r2.ok, true);
  assert.equal(run.gold, 500 - c0 - c1);
  assert.equal(run.shop.refreshes, 2, '第三次刷新会更贵');

  /** 货架必须变：连着刷 6 次，至少出现两种不同的组合，否则"刷新"等于白花钱 */
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    seen.add(run.shop.cards.map((c) => c.id).join(','));
    refreshShop(run);
  }
  assert.ok(seen.size >= 2, `刷新后货架没变过: ${[...seen].join(' | ')}`);
});

test('刷新：宝库花水晶材料，每次 +1，材料不够就拒绝', () => {
  const run = newRun(22);
  run.floor = 12;
  run.materials = 2;
  run.shop = makeShop(run, new Rng(6), SHOP_KIND.RELIC);

  assert.equal(refreshCost(run), RELIC_REFRESH_BASE, '第一次只要 1 个');
  const r1 = refreshShop(run);
  assert.equal(r1.ok, true);
  assert.equal(run.materials, 2 - RELIC_REFRESH_BASE);
  assert.equal(refreshCost(run), RELIC_REFRESH_BASE + 1, '第二次要 2 个');

  const r2 = refreshShop(run);
  assert.equal(r2.ok, false, '只剩 1 个材料，刷不动第二次');
  assert.match(r2.reason, /材料不足/);
  assert.equal(run.materials, 1, '失败不能扣材料');
  assert.equal(run.shop.refreshes, 1, '失败也不能涨次数');
});

test('刷新：已售出的记录会清空（新货是新的）', () => {
  const run = newRun(23);
  run.floor = 9;
  run.gold = 999;
  run.shop = makeShop(run, new Rng(7), SHOP_KIND.CARD);
  run.shop.cards[0].sold = true;

  refreshShop(run);
  for (const it of run.shop.cards) assert.equal(it.sold, false);
});

/* ------------------------------------------------------------------ *
 * 两家店的概率（v3.13）
 * ------------------------------------------------------------------ */

test('宝库比行商稀有：同一层成功率明显更低', () => {
  const rng = new Rng(777);
  let card = 0;
  let relic = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    if (shouldOpenShop({ floor: 10, lastShopFloor: 9, lastRelicShopFloor: 9 }, rng)) card++;
    if (shouldOpenShop({ floor: 10, lastShopFloor: 9, lastRelicShopFloor: 9 }, rng, SHOP_KIND.RELIC)) relic++;
  }
  assert.ok(card > 0 && relic > 0, '两家都该能开出来');
  assert.ok(relic < card * 0.7, `宝库该明显更稀有: 行商 ${card} / 宝库 ${relic}`);
});

test('宝库有独立保底：距上次 ≥ RELIC_SHOP_MIN_GAP 层必开', () => {
  const never = { next: () => 0.999 };
  assert.equal(
    shouldOpenShop({ floor: 1 + RELIC_SHOP_MIN_GAP, lastRelicShopFloor: 1 }, never, SHOP_KIND.RELIC),
    true,
  );
  assert.equal(
    shouldOpenShop({ floor: RELIC_SHOP_MIN_GAP, lastRelicShopFloor: 1 }, never, SHOP_KIND.RELIC),
    false,
    '差一层还不到保底',
  );
  /** 行商的保底不能被宝库的计时影响 */
  assert.equal(
    shouldOpenShop({ floor: 1 + SHOP_MIN_GAP, lastShopFloor: 1, lastRelicShopFloor: 30 }, never),
    true,
  );
});

/* ------------------------------------------------------------------ *
 * 流程
 * ------------------------------------------------------------------ */

test('保底层：距上次 ≥SHOP_MIN_GAP 层时，地图里必定有一个行商格', () => {
  let found = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const run = newRun(seed);
    run.floor = 1 + SHOP_MIN_GAP;
    run.lastShopFloor = 1;   // gap 刚好够 → 必开
    makeFloorMap(run);
    if (run.floorMap.cells.some((c) => c.kind === 'shop')) found++;
  }
  assert.equal(found, 12, '保底层不该靠运气：12 个种子都该有行商格');
});

test('行商是地图上的一格：触发进店，离店回本层（不推进层数）', () => {
  const run = newRun(17);
  run.floor = 1 + SHOP_MIN_GAP;
  run.lastShopFloor = 1;
  makeFloorMap(run);

  const i = run.floorMap.cells.findIndex((c) => c.kind === 'shop');
  assert.ok(i >= 0, '保底层应该有行商格');
  run.floorMap.cells[i].revealed = true;

  triggerCell(run, i);
  assert.equal(run.phase, 'shop');
  assert.ok(run.shop, '货架要挂在 run 上');

  leaveShop(run);
  assert.equal(run.phase, 'map', '离店回到本层地图');
  assert.equal(run.shop, null);
  assert.equal(run.floor, 1 + SHOP_MIN_GAP, '商店不再推进层数');
});

test('距上次只隔 1 层时，大多数种子不会出现行商格', () => {
  /**
   * 商店判定走独立随机流（种子里混了 seed 与 floor），所以这里换 seed 来找
   * "这一层不开店"的样本 —— 改 rngState 是不起作用的，那正是独立流的意义。
   */
  let quiet = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const r = newRun(seed);
    r.floor = 2;
    r.lastShopFloor = 2;   // gap=1，只能靠概率（约 24%）
    makeFloorMap(r);
    if (!r.floorMap.cells.some((c) => c.kind === 'shop')) quiet++;
  }
  assert.ok(quiet > 10, `40 个种子里该有相当一部分没有行商，实际 ${quiet}`);
});

test('宝库是独立的一格：触发后进的是宝库（只卖宝物、用水晶结账）', () => {
  const run = newRun(31);
  run.floor = 1 + RELIC_SHOP_MIN_GAP;
  run.lastRelicShopFloor = 1;
  makeFloorMap(run);

  const i = run.floorMap.cells.findIndex((c) => c.kind === 'relicShop');
  assert.ok(i >= 0, '宝库保底层应该有宝库格');
  run.floorMap.cells[i].revealed = true;

  triggerCell(run, i);
  assert.equal(run.phase, 'shop');
  assert.equal(run.shop.kind, 'relic');
  assert.equal(run.shop.cards.length, 0, '宝库不卖卡');
  assert.ok(run.shop.relics.length <= SHOP_RELIC_SLOTS);

  leaveShop(run);
  assert.equal(run.phase, 'map');
});

test('存档：停在商店时读回来还是那家店，货架、刷新次数和金币都在', () => {
  const store = new Map();
  const had = 'localStorage' in globalThis;
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  try {
    const run = newRun(19);
    run.floor = 7;
    run.gold = 123;
    run.materials = 4;
    run.shop = {
      kind: 'relic',
      refreshes: 2,
      cards: [],
      relics: [{ id: 'anvil', price: 3, sold: false }],
    };
    run.lastShopFloor = 7;
    run.lastRelicShopFloor = 6;
    run.phase = 'shop';

    saveRun(run);
    const loaded = loadRun();

    assert.equal(loaded.phase, 'shop');
    assert.equal(loaded.gold, 123);
    assert.equal(loaded.lastShopFloor, 7);
    assert.equal(loaded.lastRelicShopFloor, 6, '宝库保底计时也要续上');
    assert.equal(loaded.shop.kind, 'relic', '读档后不能把宝库变回行商');
    assert.equal(loaded.shop.refreshes, 2, '刷新次数丢了等于白送一次便宜刷新');
    assert.equal(loaded.shop.relics[0].id, 'anvil');
    assert.equal(loaded.battle, null, '行商阶段不该凭空造一场战斗');
  } finally {
    clearRun();
    if (!had) delete globalThis.localStorage;
  }
});

/* ------------------------------------------------------------------ *
 * 塔顶与坏档防御（v3.15，用户报"第 33 层还能一直点下一层"）
 * ------------------------------------------------------------------ */

test('通关判定：第 30 层下楼梯直接判 WIN，不存在第 31 层', () => {
  const run = newRun(9);
  run.floor = MAX_FLOOR;
  advanceFloor(run);
  assert.equal(run.phase, 'won', 'advanceFloor 在 31 层必须转 won');
  assert.equal(run.floor, MAX_FLOOR + 1, '层数可以越界（用于结算展示），但 phase 必须是 won');
});

test('坏档防御：层数越过塔顶的存档读回来直接判 WIN，不给"再下一层"', () => {
  const store = new Map();
  const had = 'localStorage' in globalThis;
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  try {
    /** 模拟旧版本 bug 存下的坏档：33 层、phase 还是 map（新版不可能产生这种状态） */
    const run = newRun(9);
    run.floor = 33;
    run.phase = 'map';
    saveRun(run);

    const loaded = loadRun();
    assert.equal(loaded.phase, 'won', '坏档读到就结算，不能继续下楼');
    assert.equal(loaded.battle, null);
    assert.equal(loaded.reward, null);
  } finally {
    clearRun();
    if (!had) delete globalThis.localStorage;
  }
});

/* ---------------- 离开可重进（v3.34） ---------------- */

test('离开行商再点同一格：货架原样回来，已售出和刷新次数都不变', () => {
  const run = newRun(17);
  run.floor = 1 + SHOP_MIN_GAP;
  run.lastShopFloor = 1;
  run.gold = 500;
  makeFloorMap(run);

  const i = run.floorMap.cells.findIndex((c) => c.kind === 'shop');
  run.floorMap.cells[i].revealed = true;

  triggerCell(run, i);
  refreshShop(run);                 /** 换一批：refreshes = 1 */
  run.shop.cards[0].sold = true;    /** 在新货架上买走第一件 */
  const goldAfterBuy = run.gold;

  leaveShop(run);
  assert.equal(run.phase, 'map');
  assert.ok(!run.floorMap.cells[i].done, '离开不消耗行商格');

  triggerCell(run, i);
  assert.equal(run.phase, 'shop');
  assert.equal(
    JSON.stringify(run.shop),
    JSON.stringify(run.floorMap.cells[i].data.shop),
    '格子上的快照和 run.shop 是同一份',
  );
  assert.equal(run.shop.refreshes, 1, '刷新次数保留');
  assert.equal(run.shop.cards[0].sold, true, '卖掉的牌不会复活');
  assert.equal(run.gold, goldAfterBuy, '古币不会因为离开/重进变化');
});

test('存档读回：离开过的行商格重进还是同一家店', () => {
  const store = new Map();
  const had = 'localStorage' in globalThis;
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    const run = newRun(23);
    run.floor = 1 + SHOP_MIN_GAP;
    run.lastShopFloor = 1;
    makeFloorMap(run);
    const i = run.floorMap.cells.findIndex((c) => c.kind === 'shop');
    run.floorMap.cells[i].revealed = true;
    triggerCell(run, i);
    run.shop.cards[0].sold = true;
    leaveShop(run);
    saveRun(run);

    const back = loadRun();
    const j = back.floorMap.cells.findIndex((c) => c.kind === 'shop');
    triggerCell(back, j);
    assert.equal(back.phase, 'shop');
    assert.equal(back.shop.cards[0].sold, true, '读档后重进，卖出记录还在');
  } finally {
    if (!had) delete globalThis.localStorage;
  }
});
