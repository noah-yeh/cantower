/**
 * 宝石牌（v3.91）
 *
 * 契约：
 *   1. 打出 = 镶嵌进状态栏，本场持续生效；卡进消耗堆，不进弃牌堆
 *   2. 五种宝石各自接到一个既有的乘区上（攻/甲/毒/能量/暴击），漏接任何一条都是 bug
 *   3. 同名可叠
 *   4. 宝石不进强化 / 合成池（+50% 会算出"半点能量"这种没法结算的值）
 *   5. battleView 要给 gems（状态栏要显示），amulet 不在 deck 里留痕
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../src/core/rng.js';
import { CARDS, GENERIC_CARD_IDS, cardText, gemText, upgradable } from '../src/core/cards.js';
import { createBattle, playCard, endTurn, battleView, gemSum } from '../src/core/combat.js';
import { forgeTargets, canForge } from '../src/core/forge.js';

const GEMS = ['gem_ruby', 'gem_sapphire', 'gem_emerald', 'gem_topaz', 'gem_amethyst'];

function stubEnemy(over = {}) {
  return {
    id: 'dummy', name: '木桩', tier: 'normal', floor: 1,
    core: null, mutations: [], traits: [],
    deck: [], hand: [], draw: [], discard: [],
    energy: 5, hp: 400, maxHp: 400, atk: 10, baseAtk: 10, armor: 0, poison: 0,
    weakTurns: 0, keepPoison: false, turn: 0, enraged: 0,
    revived: false, charged: false, hitThisTurn: 0,
    manual: true,
    ...over,
  };
}

function stubBattle({ player = {}, enemy, deck = [] } = {}) {
  return createBattle({
    player: { hp: 100, maxHp: 100, atk: 10, energy: 6, ...player },
    enemy: enemy ?? stubEnemy(),
    deck: deck.length ? deck : ['focus'],
    relics: [],
    rng: new Rng(42),
  });
}

/** 把某张牌塞进手里并打出去（不依赖抽牌顺序） */
function socket(b, key) {
  b.hand = [key];
  b.player.energy = 6;
  playCard(b, 0);
}

/* ---------------- 牌表 ---------------- */

test('五张宝石都在通用池里，且都是 kind=gem / 1 费 / 消耗', () => {
  for (const id of GEMS) {
    const c = CARDS[id];
    assert.ok(c, `${id} 存在`);
    assert.equal(c.kind, 'gem');
    assert.equal(c.cost, 1);
    assert.equal(c.exhaust, true);
    assert.ok(GENERIC_CARD_IDS.includes(id), `${id} 在通用池`);
    assert.ok(c.gem && Object.keys(c.gem).length, `${id} 有镶嵌效果`);
  }
});

test('卡面文案由 gemText 生成，不再写"打出后移除"', () => {
  assert.equal(cardText('gem_topaz'), '镶嵌进状态栏，本场战斗生效：每回合能量 +1');
  assert.ok(!cardText('gem_ruby').includes('打出后移除'));
  assert.equal(gemText({ atkBonus: 0.1 }), '攻击牌伤害 +10%');
  assert.equal(gemText(CARDS.gem_sapphire.gem), '每回合开始 +3 护甲');
});

test('宝石不能强化 / 不能合成', () => {
  for (const id of GEMS) assert.equal(upgradable(id), false);
  assert.equal(upgradable('guard'), true);
  assert.equal(canForge(['gem_ruby', 'gem_ruby'], 'gem_ruby'), false);
  assert.equal(forgeTargets(['gem_ruby', 'gem_ruby']).length, 0);
});

/* ---------------- 镶嵌 ---------------- */

test('打出宝石 = 镶进状态栏：进 gems、进消耗堆、不进弃牌堆', () => {
  const b = stubBattle();
  socket(b, 'gem_topaz');
  assert.equal(b.gems.length, 1);
  assert.equal(b.gems[0].id, 'gem_topaz');
  assert.equal(b.gems[0].name, '琥珀宝石');
  assert.deepEqual(b.exhaust, ['gem_topaz']);
  assert.deepEqual(b.discard, []);
  /** 状态栏要能读到效果说明 */
  const view = battleView(b);
  assert.equal(view.gems.length, 1);
  assert.equal(view.gems[0].text, '每回合能量 +1');
});

test('同名宝石可叠：两颗琥珀 = 能量上限 +2', () => {
  const b = stubBattle({ player: { energy: 5 } });
  socket(b, 'gem_topaz');
  socket(b, 'gem_topaz');
  assert.equal(gemSum(b, 'energyPerTurn'), 2);
  /** 回合切换后按 "角色上限 5 + 2" 回能 */
  b.player.energy = 0;
  endTurn(b);
  assert.equal(b.player.energy, 7);
});

test('琥珀宝石：下回合能量 = 角色上限 + 颗数', () => {
  const b = stubBattle({ player: { energy: 4 } });
  socket(b, 'gem_topaz');
  b.player.energy = 0;
  endTurn(b);
  /** 角色上限 4（本次招募掷到的）+ 1 颗琥珀 */
  assert.equal(b.player.energy, 5);
});

/* ---------------- 五种效果各自生效 ---------------- */

test('苍蓝宝石：每回合开始 +3 护甲', () => {
  const b = stubBattle();
  assert.equal(b.player.armor, 0);
  b.gems.push({ id: 'gem_sapphire', name: '苍蓝宝石', armorPerTurn: 3 });
  endTurn(b);
  /** 木桩手上没牌，不会打人 —— 护甲原样留着 */
  assert.equal(b.player.armor, 3);
});

test('赤红宝石：攻击牌伤害 +10%', () => {
  const plain = stubBattle({ deck: ['jab'] });
  const gem = stubBattle({ deck: ['jab'] });
  gem.gems.push({ id: 'gem_ruby', name: '赤红宝石', atkBonus: 0.1 });

  const hit = (b) => {
    b.hand = ['jab'];
    b.player.energy = 6;
    b.events = [];
    playCard(b, 0);
    const dmg = b.events.find((e) => e.type === 'damage');
    return dmg?.value ?? 0;
  };
  const a = hit(plain);
  const g = hit(gem);
  /** 伤害在 hitEnemy 里取整，所以只比对"落在 +10% 的取整区间内" */
  assert.ok(g > a, `镶宝石必须更疼（${a} → ${g}）`);
  assert.ok(Math.abs(g / a - 1.1) < 0.08, `应约等于 +10%（${a} → ${g}）`);
});

test('翠绿宝石：每次施加中毒 +2 层', () => {
  const plain = stubBattle({ enemy: stubEnemy(), deck: ['toxin'] });
  const gem = stubBattle({ enemy: stubEnemy(), deck: ['toxin'] });
  gem.gems.push({ id: 'gem_emerald', name: '翠绿宝石', poisonBonus: 2 });

  plain.hand = ['toxin'];
  plain.player.energy = 6;
  playCard(plain, 0);

  gem.hand = ['toxin'];
  gem.player.energy = 6;
  playCard(gem, 0);

  /** 淬毒短刀 3 层毒：没宝石 3 层，镶了翠绿 5 层 */
  assert.equal(plain.enemy.poison, 3);
  assert.equal(gem.enemy.poison, 5);
});

test('紫晶宝石：暴击率按点加，撞上限就封顶', () => {
  const b = stubBattle({ deck: ['jab'] });
  /** 10 颗 = +60 点，正好撞 CRIT_CAP —— 之后每张攻击牌必爆 */
  for (let i = 0; i < 10; i++) b.gems.push({ id: 'gem_amethyst', name: '紫晶宝石', critBonus: 6 });
  assert.equal(gemSum(b, 'critBonus'), 60);

  b.hand = ['jab'];
  b.player.energy = 6;
  b.events = [];
  playCard(b, 0);
  assert.ok(b.events.some((e) => e.type === 'crit'), '60% 暴击上限下必爆');
});

test('宝石只在本场战斗生效：新开一场 gems 为空', () => {
  const b = stubBattle();
  socket(b, 'gem_ruby');
  assert.equal(b.gems.length, 1);

  const fresh = stubBattle();
  assert.deepEqual(fresh.gems, []);
  assert.equal(gemSum(fresh, 'atkBonus'), 0);
});
