import test from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../src/core/rng.js';
import { CARDS, ALL_CARD_IDS, cardText, cardView, cardOf, GENERIC_CARD_IDS } from '../src/core/cards.js';
import {
  RELICS, RELIC_MAX_LV, resolveRelics, parseRelic, relicKey, relicLevelFor,
} from '../src/core/relics.js';
import { relicShopPrice } from '../src/core/shop.js';
import { CLASSES, RACES, buildCharacter, LIVES_MIN, LIVES_MAX } from '../src/core/characters.js';
import {
  createCharacter, wipeOnDeath, loseArenaLife, onExploreReturn, onExploreDeath, abandonOnExplore,
  activateRelic, canEnterArena, canExplore, reviveCharacter, recoverOrphanedRun,
  arenaState, tickArena, spendArena, hasRoom, PROBATION_LIMIT, VETERAN_LIMIT,
  ARENA_MAX,
} from '../src/core/roster.js';
import { dayKey } from '../src/core/arena-rank.js';
import { forge, canForge } from '../src/core/forge.js';
import {
  createMeta, recruitCandidate, hireCandidate, dismissCandidate, refreshCandidate,
  tickRecruit, nextTicketIn, SAVE_VERSION, RUN_SAVE_VERSION,
  RECRUIT_COST, RECRUIT_CAP, RECRUIT_REGEN_MS, REFRESH_COST,
} from '../src/core/meta.js';
import { makeEnemy, CURVE, MAX_FLOOR, floorTier, ENEMY_POOL, BOSS_POOL, drawEnemyHand, pickEnemyCard, enemyEnergyOf } from '../src/core/enemies.js';
import { ENEMY_CARDS, ALL_ENEMY_CARD_IDS, enemyCardText, enemyHit } from '../src/core/enemyCards.js';
import { CORE_TRAITS, MUTATIONS, rollMutations } from '../src/core/enemyTraits.js';
import { enterFirstBattle } from './_helpers.mjs';
import { createBattle, playCard, endTurn, endPlayerPhase, enemyStep, canPlay, settleBattle, damagePlayer, battleView, MAX_ENERGY, HAND_LIMIT, DRAW_PER_TURN } from '../src/core/combat.js';
import { createRun, applyReward, pass, play, writeBackToCharacter, buildReward, MAX_FLOOR as RUN_MAX, enterUpgradeAltar, chooseUpgradeCard, cancelUpgrade, reopenAltar } from '../src/core/run.js';
import { gainExp, expToNext, markMultiplier, GROWTH, levelProgress, MAX_LEVEL, DEF_CAP, CRIT_CAP, DODGE_CAP, atkMul } from '../src/core/leveling.js';
import { serializeRun, loadMeta } from '../src/core/save.js';

/* ---------------- 工具 ---------------- */

/**
 * 敌人桩：默认是「每回合打一张挥击」的木桩。
 * manual = true 让它不自动抽牌，测试才能真正控制它这回合手上有什么。
 */
function stubEnemy(over = {}) {
  const base = {
    id: 'dummy', name: '木桩', tier: 'normal', floor: 1,
    core: null, mutations: [], traits: [],
    deck: [], hand: ['e_strike'], draw: [], discard: [],
    energy: 5,
    hp: 100, maxHp: 100, atk: 10, baseAtk: 10, armor: 0, poison: 0,
    weakTurns: 0, keepPoison: false, turn: 0, enraged: 0,
    revived: false, charged: false, hitThisTurn: 0,
    manual: true,
  };
  return { ...base, ...over };
}

/** 让敌人这回合手上只有某几张牌（能量按 CURVE 每回合回满） */
function stubAction(ids, over = {}) {
  return stubEnemy({ hand: ids.slice(), ...over });
}

function stubBattle({ deck, enemy, relics = [], perk = {}, racePerk = {}, player = {} } = {}) {
  return createBattle({
    player: { hp: 100, maxHp: 100, atk: 10, ...player },
    enemy: enemy ?? stubEnemy(),
    deck: deck ?? Array(5).fill('strike'),
    relics: resolveRelics(relics),
    rng: new Rng(42),
    perk,
    racePerk,
  });
}

/* ---------------- RNG ---------------- */

test('rng 同种子完全可复现', () => {
  const a = new Rng(123);
  const b = new Rng(123);
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
});

test('rng 存档续流后序列一致', () => {
  const a = new Rng(7);
  a.next();
  a.next();
  const mid = a.save();
  const tail = [a.next(), a.next(), a.next()];

  const b = new Rng(mid);
  assert.deepEqual([b.next(), b.next(), b.next()], tail);
});

test('rng.shuffle 不丢牌', () => {
  const rng = new Rng(9);
  const arr = Array.from({ length: 20 }, (_, i) => i);
  const out = rng.shuffle(arr.slice());
  assert.equal(out.length, 20);
  assert.deepEqual([...out].sort((x, y) => x - y), arr);
});

/* ---------------- 卡牌数据 ---------------- */

test('卡牌 id 唯一且字段合法', () => {
  assert.equal(new Set(ALL_CARD_IDS).size, ALL_CARD_IDS.length);
  for (const id of ALL_CARD_IDS) {
    const c = CARDS[id];
    assert.ok(c.name, `${id} 缺 name`);
    assert.ok(Number.isInteger(c.cost) && c.cost >= 0, `${id} 费用非法`);
    assert.ok(['attack', 'skill', 'power', 'gem', 'status'].includes(c.kind), `${id} kind 非法`);
    if (c.unplayable) {
      assert.equal(c.kind, 'status', `${id} 只有状态牌可以 unplayable`);
    }
  }
});

test('每张卡都能生成非空文案', () => {
  for (const id of ALL_CARD_IDS) {
    const text = cardText(id, 10);
    assert.ok(text.length > 0, `${id} 文案为空`);
    assert.ok(!text.includes('undefined'), `${id} 文案含 undefined`);
    assert.ok(!text.includes('NaN'), `${id} 文案含 NaN`);
  }
});

test('卡面数字随攻击力变化，不是写死的', () => {
  const low = cardText('strike', 10);
  const high = cardText('strike', 100);
  assert.notEqual(low, high);
  // v3.21：攻击力线性（atkMul），攻击 10 → ×1.10
  assert.match(low, new RegExp(String(Math.round(1.2 * atkMul(10)))));
});

test('cardView 带出完整字段', () => {
  const v = cardView('m_fireball', 20);
  assert.equal(v.name, '火球');
  assert.equal(v.cost, 2);
  /** 卡面数字必须与 cardText 同源：走 CARDS 的真实 dmg，别再写死旧倍率 */
  assert.match(v.text, new RegExp(String(Math.round(CARDS.m_fireball.dmg * atkMul(20)))));
});

/* ---------------- 角色 ---------------- */

test('四个职业的保底牌都是 5 张，且卡都存在', () => {
  for (const id of Object.keys(CLASSES)) {
    assert.equal(CLASSES[id].core.length, 5, `${id} 保底牌不是 5 张`);
    for (const cardId of CLASSES[id].core) {
      assert.ok(CARDS[cardId], `${id} 引用了不存在的卡 ${cardId}`);
    }
  }
});

test('16 个组合招募出来的卡组都是 10 张', () => {
  for (const classId of Object.keys(CLASSES)) {
    for (const raceId of Object.keys(RACES)) {
      const ch = createCharacter({ classId, raceId, seed: 7 });
      assert.equal(ch.deck.length, 10, `${raceId}/${classId} 卡组不是 10 张`);
      for (const key of ch.deck) {
        assert.ok(CARDS[key.split('+')[0]], `${raceId}/${classId} 引用了不存在的卡 ${key}`);
      }
    }
  }
});

test('职业卡池里的卡都存在', () => {
  for (const id of Object.keys(CLASSES)) {
    for (const cardId of CLASSES[id].pool) {
      assert.ok(CARDS[cardId], `${id} 卡池引用了不存在的卡 ${cardId}`);
    }
  }
});

test('角色自带宝物都存在', () => {
  for (const id of Object.keys(CLASSES)) {
    assert.ok(RELICS[CLASSES[id].relic], `${id} 初始宝物不存在`);
  }
});

test('种族天赋机制化：初始属性不再乘数值，天赋字段就位（v2.2）', () => {
  const base = buildCharacter('warrior', 'stone');
  // v2.2：种族不再改面板 —— 玩法差异全部由战斗机制承担
  assert.equal(base.maxHp, CLASSES.warrior.baseHp);
  assert.equal(base.atk, CLASSES.warrior.baseAtk);
  assert.equal(base.racePerk.armorStart, 3);
  assert.equal(base.racePerk.armorPerTurn, 1);
  const ember = buildCharacter('warrior', 'ember');
  assert.equal(ember.racePerk.burnOnHit, 1);
  const moss = buildCharacter('warrior', 'moss');
  assert.equal(moss.racePerk.energyToArmor, 1);
  const shade = buildCharacter('warrior', 'shade');
  assert.equal(shade.racePerk.firstHitReduce, 0.3);
});

test('16 个组合全部可创建', () => {
  for (const c of Object.keys(CLASSES)) {
    for (const r of Object.keys(RACES)) {
      const ch = buildCharacter(c, r);
      assert.ok(ch.maxHp > 0 && ch.atk > 0);
      assert.equal(ch.deck.length, 10);
    }
  }
});

/* ---------------- 战斗基础 ---------------- */

test('开局按 DRAW_PER_TURN 抽牌、能量满', () => {
  const b = stubBattle();
  assert.equal(b.hand.length, DRAW_PER_TURN);
  assert.equal(b.player.energy, MAX_ENERGY);
  assert.equal(b.draw.length, 5 - DRAW_PER_TURN); // 桩牌组 5 张，抽完剩下的留在抽牌堆
});

test('出牌扣能量并进弃牌堆', () => {
  const b = stubBattle({ deck: Array(10).fill('strike') });
  const before = b.player.energy;
  assert.ok(b.hand.includes('strike'));
  playCard(b, 0);
  assert.equal(b.player.energy, before - 1);
  assert.equal(b.discard.length, 1);
  assert.equal(b.hand.length, DRAW_PER_TURN - 1);
});

test('能量不够不能出牌', () => {
  const b = stubBattle({ deck: Array(10).fill('w_execute') }); // 3 费
  b.player.energy = 2;
  const events = playCard(b, 0);
  assert.deepEqual(events, []);
  assert.equal(b.hand.length, DRAW_PER_TURN);
  assert.equal(b.player.energy, 2);
});

test('手牌上限生效', () => {
  const b = stubBattle({ deck: Array(30).fill('focus') }); // 0 费抽 2
  playCard(b, 0);
  assert.ok(b.hand.length <= HAND_LIMIT);
});

test('护甲吸收伤害后才掉血', () => {
  // v3.22 敌我同构：敌人伤害也走 系数 × atkMul(攻击力)，桩不能再拿 atk 当伤害
  const hit = Math.round(enemyHit(200));
  const b = stubBattle({ enemy: stubAction(['e_strike'], { hp: 100, atk: 200 }) });
  b.player.armor = hit - 5;
  endTurn(b);
  assert.equal(b.player.hp, 95);
  assert.equal(b.player.armor, 0);
});

test('护甲在战斗内跨回合保留', () => {
  const b = stubBattle({
    deck: ['strike', 'strike', 'strike', 'strike', 'strike'],
    enemy: stubAction(['e_guard']),
  });
  b.player.armor = 20;
  endTurn(b);
  // 敌人这回合防御，没打人；护甲不清零
  assert.equal(b.player.armor, 20);
});

test('中毒无视护甲', () => {
  const b = stubBattle({ enemy: stubAction([], { hp: 100, armor: 50, poison: 8 }) });
  endTurn(b);
  assert.equal(b.enemy.hp, 92);
  assert.equal(b.enemy.armor, 50);
});

test('中毒每回合衰减一层', () => {
  const b = stubBattle({ enemy: stubAction([], { hp: 200, poison: 5 }) });
  endTurn(b);
  assert.equal(b.enemy.poison, 4);
});

test('敌人血量归零判胜', () => {
  const b = stubBattle({ enemy: stubEnemy({ hp: 5 }) });
  const idx = b.hand.findIndex((c) => c === 'strike');
  playCard(b, idx);
  assert.equal(b.phase, 'won');
});

test('玩家血量归零判负', () => {
  const b = stubBattle({ player: { hp: 2 }, enemy: stubAction(['e_strike'], { atk: 10 }) });
  endTurn(b);
  assert.equal(b.phase, 'lost');
  assert.equal(b.player.hp, 0);
});

test('超过 12 回合敌人狂暴增伤', () => {
  const e = stubAction(['e_guard'], { atk: 10 });
  const b = stubBattle({ enemy: e });
  b.enemy.turn = CURVE.enrageTurn;
  endTurn(b);
  // v3.22：狂暴乘的是伤害乘区（乘 atk 在线性模型下只值 +0.x%）
  assert.ok(b.enemy.dmgMul > 1);
});

/* ---------------- 天赋与宝物 ---------------- */

test('战士护甲加成生效', () => {
  const plain = stubBattle({ deck: Array(10).fill('guard') });
  const warrior = stubBattle({ deck: Array(10).fill('guard'), perk: { armorGain: 0.25 } });
  playCard(plain, 0);
  playCard(warrior, 0);
  // 圆整发生在 gainArmor 里（先乘加成再取整），不能拿已取整的甲再乘
  assert.equal(warrior.player.armor, Math.round(CARDS.guard.block * atkMul(10) * 1.25));
  assert.ok(warrior.player.armor > plain.player.armor);
});

test('猎人前 2 张攻击牌翻倍，第 3 张恢复正常', () => {
  const b = stubBattle({
    deck: Array(10).fill('strike'),
    enemy: stubEnemy({ hp: 1000 }),
    perk: { firstAttackDouble: 2 },
  });
  const raw = CARDS.strike.dmg + CARDS.strike.perCopy * 10;
  const single = Math.round(raw * atkMul(10));
  const doubled = Math.round(raw * atkMul(10) * 2); // 同袍 + 首击翻倍
  playCard(b, 0);
  assert.equal(b.enemy.hp, 1000 - doubled);
  playCard(b, 0);
  assert.equal(b.enemy.hp, 1000 - doubled * 2); // 第 2 击也翻倍（天赋前 2 张）
  playCard(b, 0);
  /** 第 3 击不翻倍：每张独立取整，别拿 base/2 反推（会差 1 点） */
  assert.equal(b.enemy.hp, 1000 - doubled * 2 - single);
});

test('铁砧在有护甲时给能量', () => {
  // 敌人这回合防御，护甲不会被消耗，才能验证"回合开始时有护甲 → +2 能量"
  const b = stubBattle({
    deck: Array(10).fill('strike'),
    relics: ['anvil'],
    enemy: stubAction(['e_guard']),
  });
  b.player.armor = 10;
  b.player.energy = 0;
  endTurn(b);
  assert.equal(b.player.energy, MAX_ENERGY + 2);
});

test('毒龙宝石按毒层给护甲', () => {
  const b = stubBattle({ enemy: stubAction(['e_guard'], { hp: 500, poison: 6 }), relics: ['poisonGem'] });
  endTurn(b);
  assert.ok(b.player.armor >= 6);
});

test('植物精华让施加的毒 +2', () => {
  const b = stubBattle({ deck: Array(10).fill('t_venom'), relics: ['plantEssence'] });
  playCard(b, 0);
  assert.equal(b.enemy.poison, 8); // v3.15 涂毒 6 + 2
});

/* ---------------- 爬塔流程 ---------------- */

test('createRun 能正常开局：落在地图上，翻到敌人才开打', () => {
  const run = createRun({ classId: 'warrior', raceId: 'stone', seed: 1 });
  assert.equal(run.floor, 1);
  assert.equal(run.phase, 'map', 'v2.0 起开局是迷宫地图，不是直接进战斗');
  assert.ok(run.floorMap);
  assert.equal(run.floorMap.cells.length, 9, '3×3 = 9 格（v3.12 收紧）');
  assert.ok(run.floorMap.cells[run.floorMap.entry].revealed, '入口格开局就是明的');
  assert.ok(run.player.hp > 0);

  assert.ok(enterFirstBattle(run), '应该能翻到敌人并开打');
  assert.equal(run.phase, 'battle');
  assert.ok(run.battle);
});

test('16 个组合都能开局并打完第一场', () => {
  for (const c of Object.keys(CLASSES)) {
    for (const r of Object.keys(RACES)) {
      const run = createRun({ classId: c, raceId: r, seed: 5 });
      for (let i = 0; i < 60 && run.phase === 'battle'; i++) {
        const played = run.battle.hand.findIndex((_, idx) => {
          const id = run.battle.hand[idx];
          return CARDS[id].cost <= run.battle.player.energy;
        });
        if (played >= 0) play(run, played);
        else pass(run);
      }
      assert.notEqual(run.phase, 'battle', `${c}/${r} 第一场没能结束`);
    }
  }
});

test('三选一至少给一张卡', () => {
  const run = createRun({ classId: 'warrior', raceId: 'stone', seed: 3 });
  // 手动打穿第 1 层
  for (let i = 0; i < 80 && run.phase === 'battle'; i++) {
    const idx = run.battle.hand.findIndex((id) => CARDS[id].cost <= run.battle.player.energy);
    if (idx >= 0) play(run, idx);
    else pass(run);
  }
  if (run.phase !== 'reward') return;
  assert.ok(run.reward.options.length === 3);
  assert.ok(run.reward.options.some((o) => o.kind === 'card'));
});

test('选卡奖励会进入卡组', () => {
  const run = createRun({ classId: 'warrior', raceId: 'stone', seed: 4 });
  const before = run.deck.length;
  run.reward = { options: [{ kind: 'card', id: 'heavy', label: '重击' }], tier: 'normal' };
  run.phase = 'reward';
  applyReward(run, 0);
  assert.equal(run.deck.length, before + 1);
  assert.ok(run.deck.includes('heavy'));
});

test('选宝物奖励会进入宝物栏', () => {
  const run = createRun({ classId: 'warrior', raceId: 'stone', seed: 4 });
  run.reward = { options: [{ kind: 'relic', id: 'anvil', label: '铁砧' }], tier: 'normal' };
  run.phase = 'reward';
  applyReward(run, 0);
  assert.ok(run.relics.includes('anvil'));
});

test('三选一不再出属性项：成长改由升级负责', () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const run = createRun({ classId: 'warrior', raceId: 'stone', seed });
    if (!enterFirstBattle(run)) continue;
    let guard = 0;
    while (run.phase === 'battle' && guard++ < 300) {
      const b = run.battle;
      const idx = b.hand.findIndex((_, i) => canPlay(b, i));
      if (idx >= 0) play(run, idx);
      else pass(run);
    }
    for (const o of run.reward?.options || []) kinds.add(o.kind);
  }
  assert.ok(kinds.size > 0, '应该至少产出了一批奖励');
  assert.ok(!kinds.has('stat'), `属性项应该被移除，实际出现：${[...kinds].join(',')}`);
});

test('奖励选完回到本层地图，不推进层数（v2.0）', () => {
  const run = createRun({ classId: 'warrior', raceId: 'stone', seed: 4 });
  run.reward = { options: [{ kind: 'heal', id: 'heal', label: '治疗' }], tier: 'normal' };
  run.phase = 'reward';
  applyReward(run, 0);
  assert.equal(run.floor, 1, '一层还没清完，楼层不该动');
  assert.equal(run.phase, 'map');
  assert.equal(run.reward, null);
});

test('层节点类型符合设计（5/15/25 精英，10/20/30 BOSS）', () => {
  assert.equal(floorTier(5), 'elite');
  assert.equal(floorTier(10), 'boss');
  assert.equal(floorTier(15), 'elite');
  assert.equal(floorTier(20), 'boss');
  assert.equal(floorTier(30), 'boss');
  assert.equal(floorTier(7), 'normal');
});

test('敌人随层数变强', () => {
  const rng = new Rng(1);
  const e1 = makeEnemy(1, rng);
  const e20 = makeEnemy(20, rng);
  assert.ok(e20.hp > e1.hp);
  assert.ok(e20.atk > e1.atk);
});

test('BOSS 层血量明显高于普通层', () => {
  const rng = new Rng(1);
  const normal = makeEnemy(9, rng);
  const boss = makeEnemy(10, rng);
  assert.ok(boss.hp > normal.hp * 1.8);
});

/* ---------------- 敌人的构筑 ---------------- */

test('敌人行动牌文案全部由数值生成', () => {
  for (const id of ALL_ENEMY_CARD_IDS) {
    const text = enemyCardText(id, 10, 100);
    assert.ok(text.length > 0, `${id} 文案为空`);
    assert.ok(!text.includes('undefined') && !text.includes('NaN'), `${id} 文案异常`);
  }
  assert.notEqual(enemyCardText('e_slam', 10, 100), enemyCardText('e_slam', 40, 100));
});

test('所有模板的牌库引用都合法', () => {
  for (const tpl of [...ENEMY_POOL, ...BOSS_POOL]) {
    assert.ok(CORE_TRAITS[tpl.id], `${tpl.id} 缺核心词条`);
    for (const id of tpl.deck) assert.ok(ENEMY_CARDS[id], `${tpl.id} 引用了不存在的牌 ${id}`);
  }
});

test('普通怪 1 个变异，精英与首领 2 个', () => {
  const rng = new Rng(3);
  assert.equal(makeEnemy(3, rng).mutations.length, 1);
  assert.equal(makeEnemy(5, rng).mutations.length, 2);
  assert.equal(makeEnemy(10, rng).mutations.length, 2);
});

test('同一个敌人不会出现两个同效果族的词条', () => {
  const rng = new Rng(11);
  for (let f = 1; f <= MAX_FLOOR; f++) {
    const e = makeEnemy(f, rng);
    const keys = e.traits.map((t) => t.key);
    assert.equal(new Set(keys).size, keys.length, `第 ${f} 层词条重复`);
  }
});

test('变异词条会被威胁值折回基础属性', () => {
  // 同样的模板与层数，词条越强，基础攻击不应更高
  const tpl = ENEMY_POOL[0];
  const none = makeEnemy(6, new Rng(20));
  const heavy = makeEnemy(6, new Rng(20));
  heavy.mutations = [MUTATIONS.mut_swift, MUTATIONS.mut_armored];
  assert.ok(none.atk > 0 && heavy.atk > 0);
  // 直接验证折算公式本身
  const damp = 1 - (MUTATIONS.mut_swift.power + MUTATIONS.mut_armored.power) * CURVE.threatDamp;
  assert.ok(damp < 1 && damp > 0.6, `折算系数 ${damp} 越界`);
  assert.ok(tpl.hpMul > 0);
});

test('敌人挑牌只看手里的牌，且一定买得起', () => {
  const rng = new Rng(5);
  for (let f = 1; f <= MAX_FLOOR; f++) {
    const e = makeEnemy(f, rng);
    drawEnemyHand(e, rng);
    e.energy = enemyEnergyOf(e);
    const pick = pickEnemyCard(e, rng);
    if (!pick) continue;
    assert.ok(e.hand.includes(pick.id), `第 ${f} 层挑了不在手里的牌`);
    assert.ok(ENEMY_CARDS[pick.id].cost <= e.energy, `第 ${f} 层挑了买不起的牌`);
  }
});

test('能量不够就一张也挑不出来 —— 敌人就此结束回合', () => {
  // 重砸要 2 点，只给它 1 点
  const e = stubEnemy({ hand: ['e_slam'], energy: 1, manual: true });
  assert.equal(pickEnemyCard(e, new Rng(1)), null);

  // 手牌为空同理
  const empty = stubEnemy({ hand: [], energy: 5, manual: true });
  assert.equal(pickEnemyCard(empty, new Rng(1)), null);
});

test('敌人抽牌不会凭空造牌或丢牌', () => {
  const rng = new Rng(9);
  const e = makeEnemy(7, rng);
  for (let i = 0; i < 20; i++) drawEnemyHand(e, rng);
  const total = e.hand.length + e.draw.length + e.discard.length;
  assert.equal(total, e.deck.length);
});

test('敌人按能量出牌，伤害倍率正确', () => {
  const b = stubBattle({ enemy: stubAction(['e_slam'], { atk: 10 }) });
  endTurn(b);
  // 1.75 × enemyHit(10)
  assert.equal(b.player.hp, 100 - Math.round(1.75 * enemyHit(10)));
});

test('覆甲词条开场给护甲', () => {
  const b = stubBattle({
    enemy: stubAction(['e_guard'], { traits: [{ kind: 'openArmor', value: 0.2, key: 'openArmor', name: '覆甲', text: '' }] }),
  });
  assert.equal(b.enemy.armor, 20);
});

test('再生词条每回合回血', () => {
  const b = stubBattle({
    enemy: stubAction(['e_guard'], { hp: 50, maxHp: 100, traits: [{ kind: 'regen', value: 0.1, key: 'regen', name: '再生', text: '' }] }),
  });
  endTurn(b);
  assert.equal(b.enemy.hp, 60);
});

test('缚网让玩家下回合少 1 点能量', () => {
  const b = stubBattle({ enemy: stubAction(['e_web']) });
  endTurn(b);
  assert.equal(b.player.energy, MAX_ENERGY - 1);
});

test('骸兵第一次死亡会站起来', () => {
  const b = stubBattle({
    deck: Array(10).fill('strike'),
    enemy: stubEnemy({ hp: 5, maxHp: 400, traits: [{ kind: 'revive', value: 0.4, key: 'revive', name: '不散', text: '' }] }),
  });
  playCard(b, 0);
  assert.equal(b.phase, 'player');
  assert.equal(b.enemy.hp, 160);
  playCard(b, 0);
  assert.equal(b.phase, 'player'); // 复活后这一下打不死
});

/* ---------------- 存档 ---------------- */

test('run 序列化后可重建关键字段', () => {
  const run = createRun({ classId: 'mage', raceId: 'shade', seed: 11 });
  const data = serializeRun(run);
  assert.equal(data.classId, 'mage');
  assert.equal(data.raceId, 'shade');
  assert.equal(data.floor, 1);
  assert.equal(data.deck.length, 10);
  assert.equal(typeof data.rngState, 'number');
  // 序列化结果必须是纯 JSON，不能带函数
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(data)));
});

test('战斗中的 rng 状态能回写到 run', () => {
  const run = createRun({ classId: 'hunter', raceId: 'moss', seed: 12 });
  assert.ok(enterFirstBattle(run), '先翻到敌人');
  const before = run.rngState;
  run.battle.rng.next();
  run.battle.rng.next();
  // 通过一次 pass 触发 sync
  pass(run);
  assert.notEqual(run.rngState, before);
});

/* ---------------- v0.4 元游戏 ---------------- */

test('招募：属性落在 ±8% 区间内，命数按种族', () => {
  for (const classId of Object.keys(CLASSES)) {
    for (const raceId of Object.keys(RACES)) {
      const ch = createCharacter({ classId, raceId, seed: 33 });
      const cls = CLASSES[classId];
      const race = RACES[raceId];
      const expectHp = cls.baseHp * (race.perk.hpMul ?? 1);
      const expectAtk = cls.baseAtk * (race.perk.atkMul ?? 1);
      assert.ok(ch.maxHp >= Math.floor(expectHp * 0.92), `${raceId}/${classId} 生命偏低 ${ch.maxHp}`);
      assert.ok(ch.maxHp <= Math.ceil(expectHp * 1.08), `${raceId}/${classId} 生命偏高 ${ch.maxHp}`);
      assert.ok(ch.atk >= Math.floor(expectAtk * 0.92), `${raceId}/${classId} 攻击偏低 ${ch.atk}`);
      assert.ok(ch.atk <= Math.ceil(expectAtk * 1.08), `${raceId}/${classId} 攻击偏高 ${ch.atk}`);
      assert.ok(ch.lives >= LIVES_MIN && ch.lives <= LIVES_MAX,
        `${raceId} 命数 ${ch.lives} 超出 ${LIVES_MIN}~${LIVES_MAX}`);
      assert.equal(ch.maxLives, ch.lives, `${raceId} 满命数应等于初始命数`);
      assert.equal(ch.relicSlots.length, 2, `${raceId} 应该带 2 件未激活宝物`);
      assert.ok(ch.deck.includes(race.card), `${raceId} 卡组里应有种族卡`);
    }
  }
});

test('起始卡组不含 power 牌（否则随机白送永久成长）', () => {
  for (const classId of Object.keys(CLASSES)) {
    for (const raceId of Object.keys(RACES)) {
      for (let seed = 1; seed <= 6; seed++) {
        const ch = createCharacter({ classId, raceId, seed });
        for (const key of ch.deck) {
          const c = CARDS[key.split('+')[0]];
          assert.notEqual(c.kind, 'power', `${raceId}/${classId} 起始卡组混入了 power 牌 ${key}`);
        }
      }
    }
  }
});

test('探险阵亡：扣 1 命，属性/卡组/宝物完全回滚到初始', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  const initialHp = ch.maxHp;
  const initialDeck = ch.deck.slice();
  const initialRelics = ch.relics.slice();

  // 模拟一次探险的成长
  ch.maxHp += 40;
  ch.atk += 5;
  ch.deck.push('w_execute', 'w_execute');
  ch.relics.push('anvil');
  ch.relicSlots = [];
  ch.materials = 7;

  const res = wipeOnDeath(ch);

  assert.equal(res.dead, false);
  assert.equal(ch.lives, ch.maxLives - 1);
  assert.equal(ch.maxHp, initialHp, '最大生命应该回滚');
  assert.deepEqual(ch.deck, initialDeck, '卡组应该回滚');
  assert.deepEqual(ch.relics, initialRelics, '宝物应该回滚');
  assert.equal(ch.materials, 0, '材料应该清零');
  assert.equal(ch.relicSlots.length, 2, '未激活宝物槽应该恢复');
});

test('命数扣光后角色变成 dead', () => {
  const ch = createCharacter({ classId: 'mage', raceId: 'ember', seed: 6 });
  /** 命数是招募时随机掷的（v3.93：5~8），这里钉成 3 条方便数 */
  ch.lives = 3;
  ch.maxLives = 3;
  wipeOnDeath(ch);
  wipeOnDeath(ch);
  const last = wipeOnDeath(ch);
  assert.equal(ch.lives, 0);
  assert.equal(ch.status, 'dead');
  assert.equal(last.dead, true);
});

test('竞技场失败只扣命，不回滚成长', () => {
  const ch = createCharacter({ classId: 'hunter', raceId: 'shade', seed: 7 });
  ch.maxHp += 30;
  ch.deck.push('h_snipe');
  const grownHp = ch.maxHp;
  const grownDeck = ch.deck.length;

  loseArenaLife(ch);

  assert.equal(ch.lives, ch.maxLives - 1);
  assert.equal(ch.maxHp, grownHp, '竞技场不该回滚属性');
  assert.equal(ch.deck.length, grownDeck, '竞技场不该回滚卡组');
});

test('探险归来：成果保留、材料清空、竞技场额度刷新', () => {
  const ch = createCharacter({ classId: 'traveler', raceId: 'moss', seed: 8 });
  ch.materials = 5;
  ch.arenaLeft = 0;
  onExploreReturn(ch, 22);
  assert.equal(ch.status, 'idle');
  assert.equal(ch.materials, 0);
  assert.equal(ch.arenaLeft, ARENA_MAX);
  assert.equal(ch.record.bestFloor, 22);
});

test('合成：两张同名 → 强化版 + 1 材料，卡组 -1', () => {
  const deck = ['strike', 'strike', 'strike', 'guard'];
  const res = forge(deck, 'strike');
  assert.equal(res.ok, true);
  assert.equal(res.key, 'strike+1');
  assert.equal(deck.filter((k) => k === 'strike').length, 1);
  assert.equal(deck.filter((k) => k === 'strike+1').length, 1);
  assert.equal(deck.length, 3);
});

test('合成：逐级升到 +3，满级后拒绝', () => {
  const deck = Array(8).fill('strike');

  assert.equal(forge(deck, 'strike').key, 'strike+1');
  assert.equal(forge(deck, 'strike').key, 'strike+1');
  assert.equal(forge(deck, 'strike+1').key, 'strike+2');

  assert.ok(deck.includes('strike+2'), '应该得到 +2');
  assert.equal(forge(deck, 'strike+2').ok, false, '只有一张 +2，不该能合');

  // 直接验证满级上限
  const maxed = ['strike+3', 'strike+3'];
  assert.equal(canForge(maxed, 'strike+3'), false, '+3 是上限');
  assert.equal(forge(maxed, 'strike+3').ok, false);
});

test('合成：不同等级的同类卡不能合', () => {
  const deck = ['strike', 'strike+1'];
  assert.equal(canForge(deck, 'strike'), false);
  assert.equal(canForge(deck, 'strike+1'), false);
});

test('强化卡数值按 +50% 基础值线性放大', () => {
  const b0 = CARDS.strike.dmg;
  assert.equal(cardOf('strike').dmg, b0);
  assert.equal(cardOf('strike+1').dmg, Math.round(b0 * 1.5));
  assert.equal(cardOf('strike+2').dmg, Math.round(b0 * 2));
  assert.equal(cardOf('strike+3').dmg, Math.round(b0 * 2.5));
  // 抽牌/能量不该被放大
  assert.equal(cardOf('guard+3').cost, 1);
});

test('宝物激活消耗材料，激活后进 relics', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 9 });
  const target = ch.relicSlots[0];
  ch.materials = 2;
  assert.equal(activateRelic(ch, target, 3), false, '材料不足不该成功');
  ch.materials = 3;
  assert.equal(activateRelic(ch, target, 3), true);
  assert.equal(ch.materials, 0);
  assert.ok(ch.relics.includes(target));
  assert.equal(ch.relicSlots.includes(target), false);
});

test('招募消耗 1 个名额、出一个人；没处理掉之前不能再点', () => {
  const meta = createMeta(3);
  const T0 = 1_000_000;
  const gold = meta.gold;

  assert.equal(meta.tickets, RECRUIT_CAP, '开局名额给满');

  const res = recruitCandidate(meta, T0);
  assert.equal(res.ok, true, '应该能招');
  assert.ok(meta.candidate, '眼前应该站着一个人');
  assert.equal(meta.tickets, RECRUIT_CAP - 1, '消耗 1 个名额');
  assert.equal(meta.gold, gold, '看人不要钱 —— 金币在雇佣那一步才花');

  const again = recruitCandidate(meta, T0 + 60_000);
  assert.equal(again.ok, false, '眼前还有一位，不能继续抽');
  assert.equal(meta.tickets, RECRUIT_CAP - 1, '被拒时不能白扣名额');
});

test('雇佣：扣金币、进营地，候选人清空', () => {
  const meta = createMeta(4);
  const T0 = 2_000_000;
  const before = meta.gold;
  const cand = recruitCandidate(meta, T0).character;

  const baseCount = meta.roster.length; /** v3.35 起新档自带初始角色 */
  const res = hireCandidate(meta);
  assert.equal(res.ok, true);
  assert.equal(meta.gold, before - RECRUIT_COST);
  assert.equal(meta.candidate, null, '雇下之后眼前应该空了');
  assert.equal(meta.roster.length, baseCount + 1);
  const hired = meta.roster.find((c) => c.id === cand.id);
  assert.ok(hired, '雇的人要在营地');
  assert.equal(hired.veteran, false, '新人是实习生');
  assert.equal(hired.arenaLeft, 0, '实习生没有竞技场额度');
});

test('金币不足时雇不下来，人还站在那儿（名额不白烧）', () => {
  const meta = createMeta(5);
  meta.gold = RECRUIT_COST - 1;
  recruitCandidate(meta, 1_000_000);

  const res = hireCandidate(meta);
  assert.equal(res.ok, false);
  assert.ok(meta.candidate, '雇不起不代表人走了');
  assert.equal(meta.gold, RECRUIT_COST - 1, '不该扣钱');
});

test('婉拒：不花钱、不退名额、眼前清空', () => {
  const meta = createMeta(6);
  const before = meta.gold;
  const cand = recruitCandidate(meta, 1_000_000).character;
  const tickets = meta.tickets;

  const res = dismissCandidate(meta);
  assert.equal(res.ok, true);
  assert.equal(res.character.id, cand.id);
  assert.equal(meta.candidate, null);
  assert.equal(meta.gold, before, '离开是免费的');
  assert.equal(meta.tickets, tickets, '名额不退 —— 否则可以零成本无限刷');
});

test('名额每 10 分钟恢复 1 个，存满 10 个就停产', () => {
  const meta = createMeta(7);
  const T0 = 5_000_000;
  /** 把名额花光：每次招一个、让他走 */
  for (let i = 0; i < RECRUIT_CAP; i++) {
    assert.equal(recruitCandidate(meta, T0).ok, true, `第 ${i + 1} 次招募应该能点`);
    dismissCandidate(meta);
  }
  assert.equal(meta.tickets, 0, '名额应该花光了');

  assert.equal(tickRecruit(meta, T0 + RECRUIT_REGEN_MS - 1), 0, '差 1 毫秒还不能恢复');
  assert.equal(tickRecruit(meta, T0 + RECRUIT_REGEN_MS), 1, '到点恢复 1 个');
  assert.equal(meta.tickets, 1);

  assert.equal(tickRecruit(meta, T0 + RECRUIT_REGEN_MS * 100), RECRUIT_CAP - 1, '一次补齐但不超过上限');
  assert.equal(meta.tickets, RECRUIT_CAP);
  assert.equal(tickRecruit(meta, T0 + RECRUIT_REGEN_MS * 200), 0, '存满就不再生效');
});

test('名额耗尽时不能招募，并给出恢复时间', () => {
  const meta = createMeta(8);
  const T0 = 6_000_000;
  for (let i = 0; i < RECRUIT_CAP; i++) {
    recruitCandidate(meta, T0);
    dismissCandidate(meta);
  }
  const res = recruitCandidate(meta, T0 + 60_000);
  assert.equal(res.ok, false);
  assert.match(res.reason, /名额/, '理由要提到名额');
  assert.equal(nextTicketIn(meta, T0 + 60_000), RECRUIT_REGEN_MS - 60_000);
});

test('满额期间时间不累积：离线一天回来还是 10 个', () => {
  const meta = createMeta(9);
  assert.equal(tickRecruit(meta, 86_400_000), 0);
  assert.equal(meta.tickets, RECRUIT_CAP);
  assert.equal(nextTicketIn(meta, 86_400_000), 0, '满额时没有"下一个"');
});

test('换一位：花 20 金重掷眼前这位，不消耗名额', () => {
  const meta = createMeta(10);
  const T0 = 7_000_000;
  const before = meta.gold;
  const first = recruitCandidate(meta, T0).character;
  const tickets = meta.tickets;

  const res = refreshCandidate(meta);
  assert.equal(res.ok, true);
  assert.equal(meta.gold, before - REFRESH_COST);
  assert.equal(meta.tickets, tickets, '换人不吃名额');
  assert.notEqual(meta.candidate.id, first.id, '应该换了一个人');

  meta.gold = 0;
  assert.equal(refreshCandidate(meta).ok, false, '没钱不能换');
  assert.ok(meta.candidate, '换失败时原来的候选人还在');
});

test('实习位满（200）时不能招募，也不扣名额', () => {
  const meta = createMeta(11);
  meta.gold = 100_000;
  const T0 = 8_000_000;
  /**
   * 直接铺满实习位，不再真的招 200 次 —— hasRoom 只看 status / veteran，
   * 而招募本身要掷种子、生成卡组，200 轮纯属磨时间。
   */
  meta.roster = Array.from({ length: PROBATION_LIMIT }, (_, i) => ({
    id: `p${i}`, status: 'idle', veteran: false,
  }));

  const tickets = meta.tickets;
  const res = recruitCandidate(meta, T0);
  assert.equal(res.ok, false);
  assert.match(res.reason, /满/);
  assert.equal(meta.tickets, tickets, '被拒不能扣名额');
});

test('营地容量：实习 200 / 转正 60 分开算，互不挤占', () => {
  /** 60 个转正老人不能把招募堵死 —— 他们不占实习位 */
  const vets = Array.from({ length: VETERAN_LIMIT }, (_, i) => ({ id: `v${i}`, status: 'idle', veteran: true }));
  assert.equal(hasRoom(vets), true, '转正满员不影响招实习生');
  assert.equal(hasRoom(vets, true), false, '转正位自己满了');

  const interns = Array.from({ length: PROBATION_LIMIT }, (_, i) => ({ id: `i${i}`, status: 'idle', veteran: false }));
  assert.equal(hasRoom(interns), false, '实习位满了');
  assert.equal(hasRoom(interns, true), true, '实习满员不影响转正位');

  /** 已死的人不占位（两条线都一样） */
  const dead = Array.from({ length: PROBATION_LIMIT }, (_, i) => ({ id: `d${i}`, status: 'dead', veteran: false }));
  assert.equal(hasRoom(dead), true);
  assert.equal(hasRoom(dead.map((c) => ({ ...c, veteran: true })), true), true);
});

test('转正席位满时活着回来：成果保留，但人还是实习生', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 3 });
  assert.equal(ch.veteran, false);
  const roster = Array.from({ length: VETERAN_LIMIT }, (_, i) => ({ id: `v${i}`, status: 'idle', veteran: true }));
  roster.push(ch);
  /** 这一趟的成果已经由 writeBackToCharacter 写进 ch 了，这里只关心"有没有转正" */
  const res = onExploreReturn(ch, 9, roster);
  assert.equal(res.promoted, false);
  assert.equal(res.promoteBlocked, true);
  assert.equal(ch.veteran, false, '席位满了不该硬塞进去');
  assert.equal(ch.status, 'idle');
  assert.equal(ch.record.bestFloor, 9, '成果与记录照样保留');
  assert.equal(ch.arenaLeft ?? 0, 0, '没转正就没有竞技场额度');

  /** 腾出一个转正位后，再爬一次就转正 */
  const res2 = onExploreReturn(ch, 10, roster.slice(0, VETERAN_LIMIT - 1));
  assert.equal(res2.promoted, true);
  assert.equal(ch.veteran, true);
  assert.equal(ch.arenaLeft, ARENA_MAX);
});

test('候选人不会重复，也不会同时出现在营地里', () => {
  const meta = createMeta(12);
  meta.gold = 100_000;
  let clock = 9_000_000;
  const seen = new Set();

  for (let i = 0; i < 12; i++) {
    clock += 60_000;
    tickRecruit(meta, clock);
    const r = recruitCandidate(meta, clock);
    if (!r.ok) continue;
    const ch = r.character;
    assert.ok(!seen.has(ch.id), '同一个角色不该被抽出两次');
    seen.add(ch.id);
    /** 一半雇下、一半放走 —— 两条出口都不该把同一个 id 留在台上 */
    if (i % 2 === 0) hireCandidate(meta);
    else dismissCandidate(meta);
    assert.equal(meta.candidate, null);
  }

  const ids = meta.roster.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, '营地不该有重复 id');
  /** v3.68：上限拆成两本账，这里雇进来的都是实习生 */
  assert.ok(meta.roster.filter((c) => !c.veteran).length <= PROBATION_LIMIT, '实习位不超过上限');
});

test('存档 v4 → v7：金币 / 名册 / 墓地 / 候选 全部保留', () => {
  // save.js 依赖 localStorage，这里临时挂一个桩
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 21 });
    const cand = createCharacter({ classId: 'mage', raceId: 'moss', seed: 22 });
    store.set('ruin-spire/hall', JSON.stringify({
      version: 4,
      seed: 31,
      gold: 888,
      roster: [ch],
      candidates: [cand, null, cand],
      ghosts: [],
      graveyard: [{ id: 'g1', name: '旧人', bestFloor: 9 }],
      counter: 3,
      log: [],
    }));

    const meta = loadMeta(8_000_000_000_000);
    assert.equal(meta.version, SAVE_VERSION, '版本应该升到当前版本');
    assert.equal(meta.gold, 888, '金币不能丢');
    assert.equal(meta.roster.length, 1, '名册不能丢');
    assert.equal(meta.graveyard.length, 1, '墓地不能丢');
    assert.equal(meta.candidate.id, cand.id, '旧档的第一个候选接过来，不是凭空清空');
    assert.equal(meta.candidate.veteran, false, '候选永远是实习生');
    assert.equal(meta.tickets, RECRUIT_CAP, '旧档没有名额字段，按满额补');
    assert.equal(meta.candidates, undefined, '旧席位字段该清掉，别再写回存档');
  } finally {
    delete globalThis.localStorage;
  }
});

test('存档 v6 → v7：席位全部冷却的空档不会崩', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    store.set('ruin-spire/hall', JSON.stringify({
      version: 6, seed: 41, gold: 300, roster: [],
      candidates: [null, null, null, null, null, null],
      slotReadyAt: [1, 2, 3, 4, 5, 6],
      equipment: [], stardust: 0, shards: 0, manors: [],
      ghosts: [], graveyard: [], counter: 0, log: [],
    }));
    const meta = loadMeta(9_000_000_000_000);
    assert.equal(meta.version, SAVE_VERSION);
    assert.equal(meta.candidate, null);
    assert.equal(meta.tickets, RECRUIT_CAP);
    assert.equal(meta.gold, 300);
  } finally {
    delete globalThis.localStorage;
  }
});

test('大厅升版不影响局内存档版本', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 23 });
  const run = createRun({ character: ch, seed: 2 });
  const data = serializeRun(run);
  assert.equal(data.version, RUN_SAVE_VERSION);
  assert.ok(RUN_SAVE_VERSION < SAVE_VERSION, '局内版本独立，不跟着大厅一起跳');
});

test('升级按职业成长：战士每级只加最大生命', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 10 });
  const run = createRun({ character: ch, seed: 1 });
  const beforeHp = run.player.maxHp;
  const beforeAtk = run.player.atk;

  const res = gainExp(run.player, 'warrior', expToNext(1));
  assert.equal(res.levels, 1);
  assert.equal(run.player.maxHp, beforeHp + GROWTH.warrior.value, '战士升级加最大生命');
  assert.equal(run.player.atk, beforeAtk, '战士升级不该加攻击');
  assert.equal(run.player.knowledge, 0, '战士不该有知识');
});

/**
 * v1.1：难度只跟层数有关。
 *
 * 原来这里断言的是「探险次数越多，敌人越强」（diffMul = 1 + 次数 × 0.55）。
 * 但转正之后角色不能再进塔，那个机制就没有对象了 —— 它剩下的唯一效果是
 * 惩罚"试用期失败过的人"：失败两次后，第三次进塔敌人凭空强 2.1 倍。
 * 所以整条曲线删掉，改成正向断言：同样的层数，敌人属性必须一致。
 */
test('难度只由层数决定，跟角色的探险次数无关', () => {
  const ch = createCharacter({ classId: 'mage', raceId: 'moss', seed: 12 });
  const run1 = createRun({ character: ch, seed: 2 });
  assert.ok(enterFirstBattle(run1));
  const hp1 = run1.battle.enemy.maxHp;
  const atk1 = run1.battle.enemy.atk;

  ch.record.exploreCount = 4;
  const run2 = createRun({ character: ch, seed: 2 });
  assert.ok(enterFirstBattle(run2));

  assert.equal(run2.battle.enemy.maxHp, hp1, '同一个种子、同一层，血量不该变');
  assert.equal(run2.battle.enemy.atk, atk1, '攻击也不该变');
  assert.equal('diffMul' in run2, false, 'diffMul 这个字段应该已经不存在了');
});

/* ---------------- v0.5：升级系统 ---------------- */

test('四职业升级各自只涨自己那一项', () => {
  // v3.23：猎人成长轴从攻击换成暴击（暴击才是它的职业身份）
  const expectKey = { warrior: 'maxHp', mage: 'knowledge', hunter: 'crit', traveler: 'luck' };

  for (const classId of Object.keys(expectKey)) {
    const ch = createCharacter({ classId, raceId: 'moss', seed: 7 });
    const run = createRun({ character: ch, seed: 3 });
    const before = {
      maxHp: run.player.maxHp,
      atk: run.player.atk,
      knowledge: run.player.knowledge,
      luck: run.player.luck,
      crit: run.player.crit,
    };

    gainExp(run.player, classId, expToNext(1));

    const changed = Object.keys(before).filter((k) => run.player[k] !== before[k]);
    assert.deepEqual(changed, [expectKey[classId]], `${classId} 只应该涨 ${expectKey[classId]}`);
  }
});

test('知识只放大印记（中毒），不放大护甲 —— v0.6 对齐原作', () => {
  const playOnce = (knowledge, hand) => {
    const run = createRun({ classId: 'mage', raceId: 'moss', seed: 9 });
    run.player.knowledge = knowledge;
    const b = createBattle({
      player: run.player,
      enemy: stubEnemy(),
      deck: run.deck,
      relics: [],
      rng: new Rng(1),
      perk: run.perk,
      racePerk: {},
    });
    b.hand = hand.slice();
    b.player.energy = 10;
    playCard(b, 0);
    return b;
  };

  const armorBase = playOnce(0, ['guard']).player.armor;
  const armorBoosted = playOnce(30, ['guard']).player.armor;
  assert.ok(armorBase > 0, '不带知识也该有护甲');
  assert.equal(armorBoosted, armorBase, '护甲不是叠层，不该吃知识加成');

  const poisonBase = playOnce(0, ['t_venom']).enemy.poison;
  const poisonBoosted = playOnce(30, ['t_venom']).enemy.poison;
  assert.equal(poisonBase, 6, 'v3.15 基础 6 层毒');
  assert.ok(poisonBoosted > poisonBase, `知识 30 时毒层数应更多，实际 ${poisonBoosted} vs ${poisonBase}`);
});

test('markMultiplier 随知识线性增长', () => {
  assert.equal(markMultiplier({ knowledge: 0 }), 1);
  assert.equal(markMultiplier({ knowledge: 100 }), 2);
  assert.ok(markMultiplier({ knowledge: 10 }) > markMultiplier({ knowledge: 5 }));
});

/* ---------------- v0.6：属性面板 ---------------- */

test('招募掷定四项面板属性，且进 initial 快照', () => {
  const ch = createCharacter({ classId: 'hunter', raceId: 'shade', seed: 42 });
  for (const k of ['def', 'crit', 'dodge', 'recovery']) {
    assert.equal(ch[k], ch.initial[k], `${k} 应该在 initial 快照里`);
    assert.ok(ch[k] >= 0);
  }
  assert.ok(ch.crit >= 7 && ch.crit <= 9, `猎人暴击基础 8±1（v3.58 上调），实际 ${ch.crit}`);
  /** v3.58：能量上限也是招募掷定的角色属性（5~8），同样必须进 initial */
  assert.ok(ch.energy >= 5 && ch.energy <= 8, `能量上限应掷在 5~8，实际 ${ch.energy}`);
  assert.equal(ch.energy, ch.initial.energy, '能量上限应该在 initial 快照里');
});

test('阵亡回滚后面板属性不变（它们本来就不随成长变化）', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 5 });
  const before = { def: ch.def, crit: ch.crit, dodge: ch.dodge, recovery: ch.recovery };
  ch.level = 9;
  ch.knowledge = 30;
  wipeOnDeath(ch);
  assert.equal(ch.def, before.def);
  assert.equal(ch.crit, before.crit);
  assert.equal(ch.dodge, before.dodge);
  assert.equal(ch.recovery, before.recovery);
  assert.equal(ch.level, 1);
});

test('防御：每点降低 1% 受到的直接伤害，封顶 40', () => {
  const run = createRun({ classId: 'warrior', raceId: 'stone', seed: 9 });
  const mk = (def) => {
    run.player.def = def;
    run.player.armor = 0;
    const b = createBattle({
      player: run.player,
      enemy: stubEnemy(),
      deck: run.deck,
      relics: [],
      rng: new Rng(1),
      perk: run.perk,
      racePerk: {},
    });
    return b;
  };

  const b0 = mk(0);
  const hp0 = b0.player.hp;
  damagePlayer(b0, 50);
  const lost0 = hp0 - b0.player.hp;

  const b40 = mk(40);
  const hp40 = b40.player.hp;
  damagePlayer(b40, 50);
  const lost40 = hp40 - b40.player.hp;

  assert.ok(lost0 > 0 && lost40 > 0, '两边都要真实掉血');
  assert.equal(lost40, Math.round(lost0 * 0.6), `防御 40 应该减伤 40%：${lost40} vs ${lost0}`);
  assert.equal(DEF_CAP, 40);
});

test('暴击：封顶 60%，触发时按职业倍率', () => {
  const run = createRun({ classId: 'hunter', raceId: 'shade', seed: 9 });
  run.player.crit = 100; // 期望 100%，但被封顶到 60%（v3.23：50 → 60）
  const b = createBattle({
    player: run.player,
    enemy: stubEnemy(),
    deck: run.deck,
    relics: [],
    rng: new Rng(1),
    perk: run.perk,
    racePerk: {},
  });
  let crits = 0;
  for (let i = 0; i < 20; i++) {
    b.player.energy = 10;
    b.hand = ['strike'];
    const ev = playCard(b, 0);
    if (ev.some((e) => e.type === 'crit')) crits++;
  }
  assert.ok(crits > 0, `60% 暴击率打 20 次应该出暴击，实际 ${crits} 次`);
  assert.ok(crits < 20, '封顶 60% 就不可能全暴击');
  assert.equal(CRIT_CAP, 60);

  /**
   * v3.23：暴伤是**职业专属**的 —— 猎人 2.0，其余 1.5。
   * 这条断言把"身份差异"钉在代码里，免得以后被随手改回全局常数。
   */
  const dmgOf = (critDmg) => {
    const bb = createBattle({
      player: { hp: 500, maxHp: 500, atk: 10, crit: 60 },
      enemy: stubEnemy({ hp: 99999, maxHp: 99999 }),
      deck: ['strike', 'strike', 'strike'],
      relics: [],
      rng: new Rng(4),
      perk: { critDmg },
      racePerk: {},
    });
    // crit 60 = 上限，但仍有 40% 不爆；反复打到出一次暴击为止
    let base = 0;
    for (let i = 0; i < 40; i++) {
      bb.player.energy = 10;
      bb.hand = ['guard']; // 填桩，不动血
      const before = bb.enemy.hp;
      bb.hand = ['strike'];
      playCard(bb, 0);
      const dealt = before - bb.enemy.hp;
      if (bb.events.some((e) => e.type === 'crit')) return { dealt, base };
      base = before;
    }
    return null;
  };
  const h = dmgOf(2);
  const o = dmgOf(1.5);
  assert.ok(h && o, '都应该能打出暴击');
  assert.ok(h.dealt > o.dealt, `猎人暴伤更高：${h.dealt} vs ${o.dealt}`);
});

test('闪避：封顶 30%，触发时完全免伤', () => {
  const run = createRun({ classId: 'mage', raceId: 'moss', seed: 9 });
  run.player.dodge = 100; // 期望 100%，但被封顶到 30%
  const b = createBattle({
    player: run.player,
    enemy: stubEnemy(),
    deck: run.deck,
    relics: [],
    rng: new Rng(1),
    perk: run.perk,
    racePerk: {},
  });
  const hp0 = b.player.hp;
  let dodges = 0;
  for (let i = 0; i < 100; i++) {
    const before = b.player.hp;
    damagePlayer(b, 1, { noReflect: true });
    if (b.player.hp === before) dodges++;
    if (b.player.hp === 0) b.player.hp = hp0; // 防止打死，只统计闪避次数
  }
  assert.ok(dodges > 5, `30% 闪避率打 100 次应该闪掉一些，实际 ${dodges} 次`);
  assert.ok(dodges < 70, '封顶 30% 不可能闪掉大半');
  assert.equal(DODGE_CAP, 30);
});

test('恢复：胜利后每点回 1 血，失败不回', () => {
  const run = createRun({ classId: 'traveler', raceId: 'moss', seed: 9 });
  run.player.recovery = 4;
  run.player.hp = run.player.maxHp - 30;
  const b = createBattle({
    player: run.player,
    enemy: stubEnemy(),
    deck: run.deck,
    relics: [],
    rng: new Rng(1),
    perk: run.perk,
    racePerk: {},
  });
  b.enemy.hp = 1;
  b.hand = ['strike'];
  b.player.energy = 10;
  playCard(b, 0);
  assert.equal(b.phase, 'won');
  const settled = settleBattle(b);
  assert.equal(settled.hp, run.player.maxHp - 30 + 4, '胜利回 4 点');

  b.phase = 'lost';
  b.player.hp = 10;
  const lost = settleBattle(b);
  assert.equal(lost.hp, 10, '失败不回血');
});

test('敌人防御：普通 0 / 精英 2 / BOSS 4，与 floorTier 对齐', () => {
  for (const floor of [1, 2, 3, 5, 7, 10, 15, 20, 30]) {
    const e = makeEnemy(floor, new Rng(floor));
    const tier = floorTier(floor);
    const want = tier === 'boss' ? 4 : tier === 'elite' ? 2 : 0;
    assert.equal(e.def, want, `第 ${floor} 层（${tier}）敌人防御应为 ${want}，实际 ${e.def}`);
  }
});

test('升级经验需求随等级递增', () => {
  assert.ok(expToNext(5) > expToNext(1));
  assert.ok(expToNext(20) > expToNext(10));
});

test('等级封顶后不再涨，经验清零', () => {
  const run = createRun({ classId: 'hunter', raceId: 'moss', seed: 5 });
  const res = gainExp(run.player, 'hunter', 1e9);
  assert.equal(run.player.level, MAX_LEVEL);
  assert.equal(run.player.exp, 0);
  assert.ok(res.levels > 0);
});

test('阵亡回滚：等级 / 经验 / 知识 / 幸运全部归零', () => {
  const ch = createCharacter({ classId: 'mage', raceId: 'moss', seed: 11 });
  ch.level = 6;
  ch.exp = 20;
  ch.knowledge = 5;
  ch.luck = 9;

  wipeOnDeath(ch);

  assert.equal(ch.level, 1);
  assert.equal(ch.exp, 0);
  assert.equal(ch.knowledge, 0);
  assert.equal(ch.luck, 0);
});

test('活着回来把等级写回角色实体', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 13 });
  const run = createRun({ character: ch, seed: 2 });
  gainExp(run.player, 'warrior', expToNext(1) + expToNext(2));

  const before = ch.level;
  writeBackToCharacter(run, ch);
  assert.ok(ch.level > before, '等级应该被写回');
  assert.equal(ch.level, run.player.level);
});

/* ------------------------------------------------------------------ *
 * 转正机制（v0.8）
 *
 * 新招的人只能探险；活着从塔里回来一次才转正，才允许参加竞技场。
 * 这条规则必须能在 core 层被验证 —— 只写在按钮的 disabled 上等于没有规则。
 * ------------------------------------------------------------------ */

test('新招的角色是试用期：没有竞技场次数，也不能进竞技场', () => {
  const meta = createMeta(21);
  const cand = recruitCandidate(meta, 1000).character; /** 先花名额抽一位 */
  const res = hireCandidate(meta);
  assert.equal(res.ok, true);

  const ch = meta.roster.find((c) => c.id === cand.id);
  assert.equal(ch.veteran, false, '刚招进来不该是已转正');
  assert.equal(ch.arenaLeft, 0, '试用期不该发竞技场次数');

  const check = canEnterArena(ch);
  assert.equal(check.ok, false);
  assert.match(check.reason, /试用期/);
});

test('活着回来一次即转正，并拿到当天全部竞技场次数', () => {
  const ch = createCharacter({ classId: 'hunter', raceId: 'shade', seed: 31 });
  assert.equal(ch.veteran, false);

  onExploreReturn(ch, 7);

  assert.equal(ch.veteran, true);
  assert.equal(ch.arenaLeft, ARENA_MAX);
  assert.equal(canEnterArena(ch).ok, true);
});

test('阵亡不转正：第一次探险就死，仍然是试用期', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'ember', seed: 41 });
  onExploreDeath(ch, 4);

  assert.equal(ch.veteran, false);
  assert.equal(ch.arenaLeft, 0, '试用期阵亡也不该有竞技场次数');
  assert.equal(canEnterArena(ch).ok, false);
});

test('中途放弃与阵亡同一结算：扣 1 命 + 这一趟成果全部回滚', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 81 });
  const lives = ch.lives;
  const starterDeck = ch.initial.deck.slice();
  const starterRelics = ch.initial.relics.slice();

  /** 模拟"已经爬到第 6 层"的状态：升级、换血、多拿牌、多拿宝物、攒材料 */
  ch.level = 5;
  ch.maxHp = ch.initial.maxHp + 40;
  ch.deck.push(ch.deck[0]);
  ch.relics.push(ch.relics[0]);
  ch.materials = 7;

  const res = abandonOnExplore(ch, 6);

  assert.equal(ch.lives, lives - 1, '放弃要扣命，和死在塔里一样');
  assert.equal(res.wiped, true);
  assert.equal(ch.level, ch.initial.level, '等级回滚');
  assert.equal(ch.maxHp, ch.initial.maxHp, '成长回滚');
  assert.deepEqual(ch.deck, starterDeck, '这一趟加的牌不能留下');
  assert.deepEqual(ch.relics, starterRelics, '这一趟拿的宝物不能留下');
  assert.equal(ch.materials, 0);
  assert.equal(ch.veteran, false, '放弃不算活着回来，不该转正');
  assert.equal(ch.status, 'idle');
});

test('放弃扣光最后一条命：角色永久消失', () => {
  const ch = createCharacter({ classId: 'mage', raceId: 'moss', seed: 82 });
  ch.lives = 1;

  const res = abandonOnExplore(ch, 3);
  assert.equal(ch.lives, 0);
  assert.equal(res.dead, true);
  assert.equal(ch.status, 'dead');
});

test('转正是身份，不跟着阵亡回滚', () => {
  const ch = createCharacter({ classId: 'traveler', raceId: 'moss', seed: 51 });
  onExploreReturn(ch, 12);
  assert.equal(ch.veteran, true);

  onExploreDeath(ch, 3);
  assert.equal(ch.veteran, true, '已经转正的人死一次不该被打回试用期');
});

test('竞技场次数用完时也进不去，但原因不是试用期', () => {
  const ch = createCharacter({ classId: 'mage', raceId: 'stone', seed: 61 });
  const now = Date.now();
  onExploreReturn(ch, 9, null, now);
  for (let i = 0; i < ARENA_MAX; i++) spendArena(ch, now);
  assert.equal(ch.arenaLeft, 0);

  const check = canEnterArena(ch, now);
  assert.equal(check.ok, false);
  assert.match(check.reason, /次数/);
});

test('读档：旧档角色按已转正补，显式 false 的保持试用期', () => {
  const legacy = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 71 });
  const raw = JSON.parse(JSON.stringify(legacy));
  delete raw.veteran; // 模拟 v0.7 存档：没有这个字段

  const revived = reviveCharacter(raw);
  assert.equal(revived.veteran, true, '旧档名册不该被整体打回试用期');

  const fresh = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 72 });
  fresh.veteran = false;
  const kept = reviveCharacter(JSON.parse(JSON.stringify(fresh)));
  assert.equal(kept.veteran, false, '新档里明确是试用期的要保留');
});

/* ------------------------------------------------------------------ *
 * 敌人同构重构（v1.0）
 *
 * 敌人不再"预演意图再执行"，而是和玩家一样：回合开始抽牌、回满能量，
 * 买得起就打、买不起就结束回合。玩家侧的补偿是战斗记录。
 * ------------------------------------------------------------------ */

test('敌人回合开始能量回满，不是累加', () => {
  const b = stubBattle({ enemy: stubAction([], { energy: 0 }) });
  b.enemy.energy = 0;
  endTurn(b);
  assert.equal(b.enemy.energy, enemyEnergyOf(b.enemy));
});

test('能量用完就打不动了，不会超支', () => {
  // 4 张重砸各 2 点，总能量 5 → 只能打 2 张（4 点），第 3 张差 1 点
  const b = stubBattle({ enemy: stubAction(['e_slam', 'e_slam', 'e_slam', 'e_slam'], { atk: 10 }) });
  endTurn(b);

  assert.equal(b.player.hp, 100 - Math.round(1.75 * enemyHit(10)) * 2);
  assert.equal(b.enemy.hand.length, 2, '打不起的牌留在手上');
  assert.ok(b.enemy.energy >= 0, '能量不该为负');
});

test('敌人不再受每回合张数上限约束（v3.64）：6 张挥击 + 5 能量打 5 张', () => {
  // 6 张挥击各 1 点：旧规则打 2 张；现在能量够就打，剩 1 张留到下一回合
  const b = stubBattle({ enemy: stubAction(Array(6).fill('e_strike'), { atk: 10 }) });
  endTurn(b);
  assert.equal(b.enemy.hand.length, 1, '打 5 张花光 5 能量，剩 1 张');
});

test('战斗记录：玩家和敌人的出牌都留痕，且带实际结果', () => {
  const b = stubBattle({ deck: ['strike'], enemy: stubAction(['e_strike']) });

  playCard(b, 0);
  const mine = b.log.filter((r) => r.side === 'player');
  assert.equal(mine.length, 1);
  assert.ok(mine[0].name, '要记卡名');
  assert.ok(mine[0].detail.includes('-'), '要记实际造成的伤害');

  endTurn(b);
  const theirs = b.log.filter((r) => r.side === 'enemy');
  assert.ok(theirs.some((r) => r.detail.startsWith('你 -')), '敌人打玩家要写清楚扣的是你的血');
  assert.ok(b.log.some((r) => r.side === 'turn'), '要有回合分隔');
});

test('能量不足会写进记录，玩家能看到它为什么停手', () => {
  // 崩塌 3 费，5 能量只够打一张，第二张就卡住了
  const b = stubBattle({ enemy: stubAction(['e_collapse', 'e_collapse'], { atk: 10 }) });
  endTurn(b);
  const rows = b.log.filter((r) => r.side === 'enemy' && !r.name);
  assert.ok(rows.some((r) => r.detail.includes('能量不足')), '应该记一条"能量不足，结束回合"');
  assert.equal(b.enemy.hand.length, 1, '买不起的那张留在手上');
});

/* ---------------- v3.37 敌人回合逐张播放 ---------------- */

test('交互路径（endPlayerPhase + enemyStep）与同步 endTurn 结果完全一致', () => {
  for (const seed of [3, 17, 66, 409]) {
    const mk = () => stubBattle({
      deck: ['strike', 'strike', 'block', 'bash', 'strike'],
      enemy: stubEnemy({ manual: false, hp: 200, maxHp: 200, atk: 10 }),
    });
    const snap = (b) => JSON.stringify({
      php: b.player.hp, par: b.player.armor, ehp: b.enemy.hp, epo: b.enemy.poison,
      turn: b.turn, phase: b.phase, hand: b.hand.length, draws: b.draw.length,
    });

    const a = mk();
    endTurn(a);

    const c = mk();
    endPlayerPhase(c);
    let guard = 0;
    while (c.phase === 'enemy' && guard++ < 20) enemyStep(c);

    assert.equal(snap(c), snap(a), `seed ${seed} 两条路径不一致`);
  }
});

test('enemyStep 一次只出一张牌，手牌逐步减少', () => {
  const b = stubBattle({ enemy: stubAction(['e_strike', 'e_strike'], { atk: 10 }) });
  const r = endPlayerPhase(b);
  assert.equal(r.phase, 'enemy', '结束玩家回合后进入敌人相位');
  assert.equal(b.enemy.hand.length, 2);

  const s1 = enemyStep(b);
  assert.equal(s1.done, false, '还有牌要出');
  assert.ok(s1.card?.name, '要带牌名给 UI 显示');
  assert.ok(s1.line?.detail, '要带结算摘要给 UI 显示');
  assert.equal(b.enemy.hand.length, 1, '手牌少一张');

  const s2 = enemyStep(b);
  assert.equal(s2.done, false);
  assert.equal(b.enemy.hand.length, 0);

  const s3 = enemyStep(b);
  assert.equal(s3.done, true, '没牌了就收场');
  assert.equal(s3.phase, 'player', '回合交回玩家');
  assert.equal(b.phase, 'player');
});

/**
 * v3.64（用户：「敌人每次只能行动两次吗？不要增加这个限制，根据费用抽到的实际牌
 * 可实际使用，跟玩家同样的机制」）：出牌张数不设上限，能量是唯一约束 ——
 * 手牌上限 4 顺带兜住上界，不必再单设一条"最多 2 张"。
 */
test('敌人出牌张数不设上限：能量够就一直打（4 张 1 费 = 打 4 张）', () => {
  const b = stubBattle({ enemy: stubAction(Array(4).fill('e_strike'), { atk: 5 }) });
  const r = endPlayerPhase(b);
  assert.equal(r.phase, 'enemy');

  let plays = 0;
  let guard = 0;
  while (b.phase === 'enemy' && guard++ < 10) {
    const s = enemyStep(b);
    if (!s.done) plays++;
  }
  assert.equal(plays, 4, '4 张 1 费牌 + 5 能量应打满 4 张，不再被「2 张」卡住');
  assert.equal(b.phase, 'player', '打不起了才收场');
});

test('敌人出牌仍受能量约束：5 能量只够两张 2 费', () => {
  const b = stubBattle({ enemy: stubAction(Array(4).fill('e_slam'), { atk: 5 }) });
  endPlayerPhase(b);

  let plays = 0;
  let guard = 0;
  while (b.phase === 'enemy' && guard++ < 10) {
    const s = enemyStep(b);
    if (!s.done) plays++;
  }
  assert.equal(plays, 2, '5 能量打 2 张 2 费后剩 1 点，第三张打不起');
  assert.ok(b.log.some((l) => /能量不足/.test(l.detail || '')), '停手原因要写进战斗记录');
});

test('敌人不再暴露意图：battleView 没有 plan，只给能量上限与手牌数', () => {
  const v = battleView(stubBattle());
  assert.equal('plan' in v.enemy, false);
  assert.ok(v.enemy.energyCap > 0);
  assert.equal(typeof v.enemy.handCount, 'number');
  assert.ok(Array.isArray(v.log));
});

/* ------------------------------------------------------------------ *
 * 转正即封塔 + 竞技场额度计时恢复（v1.1）
 *
 * 用户指出：转正之后就不该再进塔了。那么"同一角色第 N 次进塔敌人更强"
 * 这条曲线也就没有存在意义 —— 两件事必须一起改，否则规则自相矛盾。
 * 额度原来只能靠探险归来重置，封塔之后必须换成另一条恢复途径，否则
 * 3 次打完角色就永久废掉。
 * ------------------------------------------------------------------ */

test('转正之后塔就关上了：canExplore 拒绝，且理由是"已转正"', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 81 });
  assert.equal(canExplore(ch).ok, true, '试用期就该能进塔');

  onExploreReturn(ch, 9);

  const check = canExplore(ch);
  assert.equal(check.ok, false);
  assert.match(check.reason, /转正/);
});

test('试用期失败可以重来：阵亡不封塔，还能再爬一次', () => {
  const ch = createCharacter({ classId: 'hunter', raceId: 'moss', seed: 82 });
  onExploreDeath(ch, 5);

  assert.equal(ch.veteran, false);
  assert.equal(canExplore(ch).ok, true, '还没转正，得让他再试');
  assert.equal(ch.lives, ch.maxLives - 1);
});

/**
 * 用户原话：「没转正之前只要有命就还可以进去，难度应该是差不多的，
 * 只是因为 roguelike 随机生成的敌人可能会有一定的差异」。
 *
 * 所以连死三次之后的第四次进塔，跟第一次必须是同一个起点：
 * 属性回滚到招募状态 + 同样种子下第 1 层敌人一模一样。
 */
test('试用期可以连死连爬：命没耗尽就一直能进，且每次起点与第一次相同', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 86 });
  const first = createRun({ character: ch, seed: 2 });
  assert.ok(enterFirstBattle(first), '先翻到敌人');
  const firstEnemy = { hp: first.battle.enemy.maxHp, atk: first.battle.enemy.atk };

  for (let i = 0; i < 3; i++) {
    onExploreDeath(ch, 4 + i);
    assert.equal(ch.veteran, false, '阵亡不该触发转正');
    assert.equal(canExplore(ch).ok, true, `第 ${i + 2} 次也该能进`);

    const again = createRun({ character: ch, seed: 2 });
    assert.ok(enterFirstBattle(again));
    assert.equal(again.player.maxHp, ch.initial.maxHp, '阵亡回滚后属性回到招募状态');
    assert.equal(again.battle.enemy.maxHp, firstEnemy.hp, '同层同种子：敌人血量不该随失败次数变');
    assert.equal(again.battle.enemy.atk, firstEnemy.atk, '同层同种子：敌人攻击不该随失败次数变');
  }

  assert.equal(ch.lives, ch.maxLives - 3);
});

test('命耗尽之后塔也进不去：canExplore 拒绝', () => {
  const ch = createCharacter({ classId: 'traveler', raceId: 'ember', seed: 87 });
  for (let i = 0; i < ch.maxLives; i++) onExploreDeath(ch, 1);

  assert.equal(ch.lives, 0);
  assert.equal(ch.status, 'dead');
  assert.equal(canExplore(ch).ok, false);
  assert.match(canExplore(ch).reason, /命/);
});

/**
 * 用户原话：「有人在探险了不应该可以直接开新的冒险。」
 *
 * meta.run 挂着 = 塔里有人。这时任何人都不能再开局：
 *   - 派别人 → 两个人的 run 互相覆盖，先进场那位直接人间蒸发；
 *   - 派自己 → 把他正在爬的这一趟整个重来，进度凭空蒸发。
 * 塔的门只在 meta.run 清空（结算/放弃）之后才重新打开。
 */
test('有人在塔里就不能再开局：canExplore 拒绝，且派自己也一样', () => {
  const a = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 90 });
  const b = createCharacter({ classId: 'hunter', raceId: 'moss', seed: 91 });
  const run = createRun({ character: a, seed: 9 });
  const activeRun = { characterId: a.id, floor: run.floor };

  assert.equal(canExplore(b, activeRun).ok, false, '派别人要拒绝');
  assert.match(canExplore(b, activeRun).reason, /一次只能派一个人/);
  assert.equal(canExplore(a, activeRun).ok, false, '派自己也要拒绝（会覆盖自己的进度）');
  assert.match(canExplore(a, activeRun).reason, /继续/);
  assert.equal(canExplore(a, null).ok, true, 'meta.run 清空后恢复准入');
});

/**
 * 用户反馈：「点继续显示战斗已结束」。
 *
 * 根因是局内档读不出来（版本不符/被清）时 meta.run 还留着，点「回塔」
 * 渲染了一个没有战斗对象的战斗页。这趟本来就没落地任何数据，所以按没发生过算：
 * 只把 status 放回 idle —— 不扣命、不转正、不回滚属性。
 */
test('探险记录丢失：孤儿角色放回待命，不扣命也不转正', () => {
  const ch = createCharacter({ classId: 'traveler', raceId: 'ember', seed: 92 });
  ch.status = 'exploring';
  const lives = ch.lives;

  assert.equal(recoverOrphanedRun(ch), true);
  assert.equal(ch.status, 'idle', '人回营地待命');
  assert.equal(ch.lives, lives, '记录丢了不是阵亡，不该扣命');
  assert.equal(ch.veteran, false, '没从塔里出来就不算转正');
  assert.equal(recoverOrphanedRun(ch), false, '已经待命的人不该再被改动');
  assert.equal(recoverOrphanedRun(null), false, '角色不存在时安全返回');
});

/**
 * 用户原话：「进塔不会扣命，死了才会扣」。
 *
 * 这条规则必须钉死：进塔、准入判定、建 run 全程不许碰 lives，
 * 命数**只在 wipeOnDeath 里**扣一次。否则"反复爬塔"的成本模型就崩了。
 */
test('进塔不扣命：准入判定与建 run 都不改命数', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 88 });
  const before = ch.lives;

  assert.equal(canExplore(ch).ok, true);
  assert.equal(ch.lives, before, 'canExplore 是只读判定，不该扣命');

  createRun({ character: ch, seed: 5 });
  assert.equal(ch.lives, before, '进塔（createRun）不该扣命');
  assert.equal(ch.status !== 'dead', true);
});

test('阵亡只扣 1 命：爬得再深也只扣一次', () => {
  const ch = createCharacter({ classId: 'hunter', raceId: 'shade', seed: 89 });
  const before = ch.lives;

  onExploreDeath(ch, 27);

  assert.equal(ch.lives, before - 1, '一次阵亡只该扣 1 条命，和层数无关');
});

test('没命的角色既不能进塔也不能打竞技场', () => {
  const ch = createCharacter({ classId: 'mage', raceId: 'shade', seed: 83 });
  ch.lives = 0;
  ch.status = 'dead';

  assert.equal(canExplore(ch).ok, false);
  assert.equal(canEnterArena(ch).ok, false);
});

/** 竞技场次数（v3.93：每天 8 次，跨天回满 —— 不再是 3 次/30 分钟计时恢复） */

const T0 = new Date(2026, 10, 17, 10, 0, 0).getTime();

test('转正后当天给满 8 次，且 arenaState 不落盘', () => {
  const ch = createCharacter({ classId: 'traveler', raceId: 'ember', seed: 84 });
  onExploreReturn(ch, 11, null, T0);

  const before = JSON.stringify(ch);
  const s = arenaState(ch, T0);
  assert.equal(s.left, ARENA_MAX, `每天 ${ARENA_MAX} 次`);
  assert.equal(s.full, true);
  assert.equal(s.fresh, true);
  assert.equal(s.day, dayKey(T0));
  assert.equal(JSON.stringify(ch), before, '只读函数不能改存档');
});

test('花一次就记当天，同一天不会自己回填', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 85 });
  onExploreReturn(ch, 8, null, T0);

  assert.equal(spendArena(ch, T0), true);
  assert.equal(ch.arenaLeft, ARENA_MAX - 1);
  assert.equal(ch.arenaDay, dayKey(T0));

  // 同一天稍晚（13 小时后 = 当天 23 点）也不会恢复
  const later = T0 + 13 * 3600_000;
  assert.equal(dayKey(later), dayKey(T0), '还在同一天');
  assert.equal(arenaState(ch, later).left, ARENA_MAX - 1, '次数只在跨天时恢复，不看小时');
});

test('花光 8 次之后不能进竞技场，理由指向明天', () => {
  const ch = createCharacter({ classId: 'hunter', raceId: 'ember', seed: 87 });
  onExploreReturn(ch, 6, null, T0);

  let n = 0;
  while (spendArena(ch, T0)) n += 1;
  assert.equal(n, ARENA_MAX, `一共能打 ${ARENA_MAX} 次（实际 ${n}）`);
  assert.equal(ch.arenaLeft, 0);
  assert.equal(spendArena(ch, T0), false, '没次数了不该扣成负数');

  const gate = canEnterArena(ch, T0);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /明天/, `理由该说清是明天的次数（${gate.reason}）`);
});

test('跨天回满：第二天 arenaState 又是 8 次，tickArena 把日期落盘', () => {
  const ch = createCharacter({ classId: 'mage', raceId: 'stone', seed: 86 });
  onExploreReturn(ch, 10, null, T0);
  for (let i = 0; i < ARENA_MAX; i++) spendArena(ch, T0);
  assert.equal(ch.arenaLeft, 0);

  const nextDay = T0 + 24 * 3600_000;
  assert.notEqual(dayKey(nextDay), dayKey(T0), '跨了本地日历日');
  assert.equal(arenaState(ch, nextDay).left, ARENA_MAX);
  assert.equal(canEnterArena(ch, nextDay).ok, true);

  assert.equal(tickArena(ch, nextDay).left, ARENA_MAX);
  assert.equal(ch.arenaDay, dayKey(nextDay), '跨天重置必须落盘，否则每次出牌都白送一次');
});

test('阵亡完全不碰竞技场次数（次数是每日资源，跟生死无关）', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'ember', seed: 89 });
  onExploreReturn(ch, 9, null, T0);
  spendArena(ch, T0);
  const left = ch.arenaLeft;
  const day = ch.arenaDay;

  onExploreDeath(ch, 2);

  assert.equal(ch.arenaLeft, left);
  assert.equal(ch.arenaDay, day);
});

test('试用期拿不到次数，跨天也不会给它补', () => {
  const ch = createCharacter({ classId: 'mage', raceId: 'moss', seed: 90 });
  const s = arenaState(ch, 9e12);
  assert.equal(s.left, 0);
  assert.equal(s.full, false);
  assert.equal(tickArena(ch, 9e12).left, 0);
});

test('读档：旧档缺 arenaLeft / arenaDay 时按满额补，日期键留空等首次结算', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 91 });
  onExploreReturn(ch, 9, null, T0);
  const raw = JSON.parse(JSON.stringify(ch));
  delete raw.arenaDay;
  delete raw.arenaLeft; // 更早的档：连次数字段都没有

  const revived = reviveCharacter(raw);
  assert.equal(revived.arenaLeft, ARENA_MAX, '远古档的转正角色按满额补');
  assert.equal(revived.arenaDay, '', '日期键空串 = 今天还没结算过');
  assert.equal(arenaState(revived, T0).left, ARENA_MAX);
});

/* ------------------------------------------------------------------ *
 * v1.2：三选一的三个真 bug（用户实测反馈）
 *
 *   1. 后期经常出现「三个都是治疗」
 *   2. 选了「最大生命 +18」的铁环，血量没变
 *   3. 局内卡池混进了别的职业的牌
 * ------------------------------------------------------------------ */

/** 造一个"已经走到中后期"的 run 桩，专门喂 buildReward */
function rewardStub({ classId = 'warrior', deck = null, relics = [], hp = 50, maxHp = 100, seed = 1 } = {}) {
  const cls = CLASSES[classId];
  return {
    rngState: new Rng(seed).save(),
    classId,
    player: { hp, maxHp, atk: 10 },
    deck: deck ?? [...cls.core, ...cls.pool.slice(0, 5)],
    relics: [...relics],
    materials: 0,
  };
}

test('卡池只出本职业 + 通用卡，绝不混进别的职业', () => {
  const allowed = new Set([...GENERIC_CARD_IDS, ...CLASSES.warrior.pool]);
  const foreign = new Set([
    ...CLASSES.mage.pool, ...CLASSES.hunter.pool, ...CLASSES.traveler.pool,
  ]);

  for (let seed = 1; seed <= 60; seed++) {
    const stub = rewardStub({ seed });
    for (let n = 0; n < 6; n++) {
      const { options } = buildReward(stub, 'normal');
      for (const o of options) {
        if (o.kind !== 'card') continue; // v2.2：upgrade 选项是祭坛门票（id 'altar'），不是卡
        assert.equal(allowed.has(o.id), true, `战士抽到了 ${o.id}`);
        assert.equal(foreign.has(o.id), false, `${o.id} 是别的职业的牌`);
      }
    }
  }
});

/**
 * v1.3：卡组不再有张数上限。
 *
 * 用户原话「卡组不加上限的」。原来 20 张封顶，第 10 层之后奖励位就被堵死，
 * 三选一必然退化成治疗 —— 那才是"后期三个都是治疗"的真正来源。
 * 现在 30 张也照样能拿牌，一屏最多仍是 1 个治疗。
 */
test('卡组没有张数上限：已经 30 张仍然正常出牌，不会退化成治疗', () => {
  const cls = CLASSES.warrior;
  const big = [];
  // 造一个 30 张、但每个 id 都还没拿满 2 张的卡组
  for (const id of [...GENERIC_CARD_IDS, ...cls.pool]) {
    big.push(id);
    if (big.length >= 30) break;
  }

  for (let seed = 1; seed <= 40; seed++) {
    const stub = rewardStub({ deck: big.slice(0, 30), hp: 40, maxHp: 100, seed });
    const { options } = buildReward(stub, 'normal');

    assert.equal(options.length, 3);
    assert.equal(options.filter((o) => o.kind === 'heal').length <= 1, true);
    assert.equal(options.some((o) => o.kind === 'card'), true, '30 张了也该还能拿新牌');
  }
});

/**
 * v1.5：强化是**常规选项**，不是"卡池抽空后的兜底"。
 *
 * 用户原话「没拿满也可能出强化的」。之前 upgradePool 只在 cardPool 空掉时才被读到，
 * 而卡池正常打到 30 层都不会空 —— 等于整局见不到一次强化。
 */
test('没拿满也会出强化：卡池还充裕时强化就该出现在三选一里', () => {
  let screens = 0;
  let withUpgrade = 0;

  for (let seed = 1; seed <= 120; seed++) {
    const stub = rewardStub({ seed });
    const { options } = buildReward(stub, 'normal');
    screens++;
    if (options.some((o) => o.kind === 'upgrade')) withUpgrade++;
  }

  const rate = withUpgrade / screens;
  assert.ok(rate > 0.15, `强化出现率 ${(rate * 100).toFixed(0)}% 太低，等于还是兜底`);
});

test('强化祭坛：列出所有可强化的卡，选中后 +1', () => {
  const run = createRun({ character: createCharacter({ classId: 'warrior', raceId: 'stone', seed: 7 }), seed: 1 });
  run.deck = ['strike', 'strike+1', 'guard'];

  assert.ok(enterUpgradeAltar(run));
  assert.equal(run.phase, 'upgrade');
  assert.deepEqual([...run.upgradeTargets].sort(), ['guard', 'strike', 'strike+1']);

  assert.ok(chooseUpgradeCard(run, 'strike+1'));
  assert.equal(run.phase, 'map');
  assert.ok(run.deck.includes('strike+2'), '选中的那张升到 +2');
  assert.ok(run.deck.includes('strike'), '别的卡不动');
});

test('强化祭坛：种族卡也能强化到 +3（v2.2 取消出身牌限制）', () => {
  const run = createRun({ character: createCharacter({ classId: 'warrior', raceId: 'stone', seed: 8 }), seed: 1 });
  run.deck = ['r_stoneSkin', 'r_stoneSkin+2', 'guard'];

  enterUpgradeAltar(run);
  assert.ok(run.upgradeTargets.includes('r_stoneSkin+2'), '满 3 之前的种族卡都在列表里');
  assert.ok(run.upgradeTargets.includes('guard'), '普通卡照常出现');
  chooseUpgradeCard(run, 'r_stoneSkin+2');
  assert.ok(run.deck.includes('r_stoneSkin+3'));

  // +3 封顶：满级卡不再出现在祭坛里
  enterUpgradeAltar(run);
  assert.ok(!run.upgradeTargets.includes('r_stoneSkin+3'), '+3 不能再升');
  cancelUpgrade(run);
});

test('强化祭坛：可以取消，卡组原封不动', () => {
  const run = createRun({ character: createCharacter({ classId: 'warrior', raceId: 'stone', seed: 9 }), seed: 1 });
  run.deck = ['strike', 'guard'];
  enterUpgradeAltar(run);
  assert.ok(cancelUpgrade(run));
  assert.equal(run.phase, 'map');
  assert.deepEqual(run.deck, ['strike', 'guard']);
});

test('同名卡拿满 2 张之后该卡不再作为新牌出现，只剩强化', () => {
  const cls = CLASSES.warrior;
  // 每个可用 id 各 2 张 = 卡池彻底空掉，但都还是 +0，可以强化
  const doubled = [...GENERIC_CARD_IDS, ...cls.pool].flatMap((id) => [id, id]);

  const stub = rewardStub({ deck: doubled, hp: 40, maxHp: 100, seed: 5 });
  const { options } = buildReward(stub, 'normal');

  assert.equal(options.some((o) => o.kind === 'card'), false, '同名 2 张之后不该再出这张卡');
  assert.equal(options.filter((o) => o.kind === 'heal').length <= 1, true, '最多一个治疗');
  assert.ok(
    options.some((o) => o.kind === 'upgrade' || o.kind === 'material'),
    '卡池空了必须还有构筑/资源出口',
  );
});

test('满血时不出治疗：回了也是溢出', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const stub = rewardStub({ hp: 100, maxHp: 100, seed });
    const { options } = buildReward(stub, 'normal');
    assert.equal(options.some((o) => o.kind === 'heal'), false);
  }
});

test('宝物抽空、卡池抽空且全满强化之后兜底成材料，而不是第三个治疗', () => {
  /**
   * v3.12：基础属性宝物是 1~5 级的，"全拿到"= 全升到 5 级。
   * 只塞纯 id 的话它们还是 1 级，池子里照样能出（用来升级），这条断言就假红了。
   */
  const allRelics = Object.keys(RELICS).map((id) =>
    (RELICS[id].levels ? `${id}+${RELIC_MAX_LV}` : id));
  // 每个可用 id 两张且都是 +3：既加不进新卡，也没有可强化的对象
  const maxed = [...GENERIC_CARD_IDS, ...CLASSES.warrior.pool].flatMap((id) => [`${id}+3`, `${id}+3`]);
  const stub = rewardStub({ relics: allRelics, deck: maxed, hp: 30, maxHp: 100, seed: 9 });
  const { options } = buildReward(stub, 'normal');

  assert.equal(options.filter((o) => o.kind === 'heal').length <= 1, true, '最多一个治疗');
  assert.equal(options.some((o) => o.kind === 'relic'), false, '全拿到了就不该再出宝物');
  assert.equal(options.some((o) => o.kind === 'material'), true, '没有卡/没有宝物时该给材料');
  assert.equal(options.some((o) => o.kind === 'card' || o.kind === 'upgrade'), false);
});

test('铁环的「最大生命 +18」真的落到数值上', () => {
  const run = createRun({ character: createCharacter({ classId: 'warrior', raceId: 'stone', seed: 91 }), seed: 4 });
  const beforeMax = run.player.maxHp;
  const beforeHp = run.player.hp;

  run.reward = { options: [{ kind: 'relic', id: 'ironRing', label: '铁环' }] };
  applyReward(run, 0);

  assert.equal(run.player.maxHp, beforeMax + 18);
  assert.equal(run.player.hp, beforeHp + 18, '上限涨了，当前血量也要跟上');

  /** v2.0：奖励选完回地图，得再开一场才能看到战斗里的玩家副本 */
  assert.ok(enterFirstBattle(run));
  assert.equal(run.battle.player.maxHp, beforeMax + 18, '下一场战斗要用新的上限');
});

test('磨石的「攻击 +10%」真的落到数值上', () => {
  const run = createRun({ character: createCharacter({ classId: 'hunter', raceId: 'moss', seed: 92 }), seed: 4 });
  const before = run.player.atk;

  run.reward = { options: [{ kind: 'relic', id: 'whetstone', label: '磨石' }] };
  applyReward(run, 0);

  assert.equal(run.player.atk, Math.round(before * 1.1));
});

test('基础属性宝物（v3.11）的加成真的落到面板上', () => {
  /**
   * 这一组全部是"面板型"：文案写了 +3 防御 / +4% 闪避，就必须真加进去。
   * v1.2 曾经栽在"字段写了没人读"上，所以每个字段都要有断言兜着。
   */
  const run = createRun({ character: createCharacter({ classId: 'warrior', raceId: 'stone', seed: 95 }), seed: 4 });
  const p = run.player;
  const before = {
    atk: p.atk, def: p.def || 0, crit: p.crit || 0,
    dodge: p.dodge || 0, knowledge: p.knowledge || 0, recovery: p.recovery || 0,
  };
  /** 角色自带一件职业起始宝物，所以比的是"多了几件"，不是绝对数 */
  const beforeRelics = run.relics.length;

  const take = (id) => {
    run.reward = { options: [{ kind: 'relic', id, label: RELICS[id].name }] };
    applyReward(run, 0);
  };
  take('ironBracer');
  take('swiftBoots');
  take('fangPendant');
  take('powerGauntlet');
  take('scholarNotes');
  take('mendingCharm');

  assert.equal(p.def, before.def + 3, '铁鳞护腕：防御 +3');
  assert.equal(p.dodge, before.dodge + 4, '疾风靴：闪避 +4');
  assert.equal(p.crit, before.crit + 4, '锐牙坠：暴击 +4');
  assert.equal(p.atk, before.atk + 6, '巨力护腕：攻击 +6');
  assert.equal(p.knowledge, before.knowledge + 3, '学者手记：知识 +3');
  assert.equal(p.recovery, before.recovery + 2, '愈合护符：胜利回血 +2');
  assert.equal(run.relics.length, beforeRelics + 6);
});

test('宝物等级（v3.12）：重复获得是升级，面板按档位涨，5 级封顶', () => {
  const run = createRun({ character: createCharacter({ classId: 'warrior', raceId: 'stone', seed: 96 }), seed: 4 });
  const before = run.player.def || 0;

  const take = (lv) => {
    run.reward = { options: [{ kind: 'relic', id: 'ironBracer', lv, label: '铁鳞护腕' }] };
    applyReward(run, 0);
  };

  take(2);
  assert.ok(run.relics.includes('ironBracer+2'), '2 级要写成 ironBracer+2');
  assert.equal(run.player.def, before + 4, '2 级防御 +4');

  /** 再抽到一张 1 级的：规则是"至少 +1"，所以升到 3 级而不是原地不动 */
  take(1);
  assert.ok(run.relics.includes('ironBracer+3'));
  assert.equal(run.relics.filter((k) => k.startsWith('ironBracer')).length, 1, '不能叠成两件');
  assert.equal(run.player.def, before + 6, '3 级防御 +6（只补差值 2）');

  for (let i = 0; i < 6; i++) take(1);
  assert.ok(run.relics.includes(`ironBracer+${RELIC_MAX_LV}`), '封顶 5 级');
  assert.equal(run.player.def, before + 10, '5 级防御 +10');
});

test('宝物等级编码：旧存档的纯 id 就是 1 级', () => {
  assert.deepEqual(parseRelic('anvil'), { id: 'anvil', lv: 1 });
  assert.deepEqual(parseRelic('ironBracer+3'), { id: 'ironBracer', lv: 3 });
  assert.equal(relicKey('ironBracer', 1), 'ironBracer', '1 级不带后缀，和旧存档一致');
  assert.equal(relicKey('ironBracer', 4), 'ironBracer+4');
  assert.equal(relicKey('ironBracer', 99), 'ironBracer+5', '封顶');
  /** resolveRelics 必须按等级取值，否则战斗里拿到的还是 1 级数值 */
  assert.equal(resolveRelics(['ironBracer+4'])[0].defFlat, 8);
  assert.equal(resolveRelics(['ironBracer'])[0].defFlat, 3);
});

test('幸运/生命宝物（v3.39）：1~5 级数值与面板落地', () => {
  const run = createRun({ character: createCharacter({ classId: 'traveler', raceId: 'moss', seed: 96 }), seed: 4 });
  const p = run.player;
  const before = {
    luck: p.luck || 0,
    maxHp: p.maxHp,
    hp: p.hp,
  };

  const take = (id, lv) => {
    run.reward = { options: [{ kind: 'relic', id, lv, label: RELICS[id].name }] };
    applyReward(run, 0);
  };

  take('cloverCharm', 1);
  assert.ok(run.relics.includes('cloverCharm'), '1 级不带后缀');
  assert.equal(p.luck, before.luck + 2, '1 级幸运 +2');

  take('cloverCharm', 5);
  assert.ok(run.relics.includes('cloverCharm+5'), '5 级写成 cloverCharm+5');
  assert.equal(p.luck, before.luck + 10, '5 级幸运 +10（升级只补差值）');
  assert.equal(run.relics.filter((k) => k.startsWith('cloverCharm')).length, 1, '不叠成两件');

  take('vitalHeart', 3);
  assert.ok(run.relics.includes('vitalHeart+3'), '3 级写成 vitalHeart+3');
  assert.equal(p.maxHp, before.maxHp + 15, '3 级生命上限 +15');
  assert.equal(p.hp, before.hp + 15, '上限涨多少、当前血量跟着涨多少');
});

test('带等级宝物定价（v3.40）：等级 = 水晶数，无等级件不涨价', () => {
  assert.equal(relicShopPrice('cloverCharm', 1), 1);
  assert.equal(relicShopPrice('cloverCharm', 5), 5, '5 级 5 个水晶');
  assert.equal(relicShopPrice('vitalHeart', 4), 4);
  assert.equal(relicShopPrice('ironBracer', 3), 3, '基础属性件同口径');
  assert.equal(relicShopPrice('cloverCharm+3', 3), 3, '带等级后缀的 key 也认得出');
  /** 无等级机制宝物：链条基础价，不随等级/层数浮动 */
  assert.equal(relicShopPrice('anvil', 1), 3);
  assert.equal(relicShopPrice('anvil', 5), 3, '机制宝物没有等级，不该随层数涨价');
  assert.equal(relicShopPrice('ironRing', 4), 5, 'X 链无等级件仍是 5');
});

test('掉落等级随层数抬：1 层只有 1 级，第 30 层至少 4 级', () => {
  const rng = new Rng(3);
  const sample = (floor) => Array.from({ length: 200 }, () => relicLevelFor(floor, rng));

  const f1 = sample(1);
  assert.equal(Math.max(...f1), 1, '第 1 层不该掉 2 级');

  const f30 = sample(30);
  assert.equal(Math.min(...f30), 4, '第 30 层最低也是 4 级');
  assert.equal(Math.max(...f30), RELIC_MAX_LV);
});

test('带宝物活着回来：面板加成写回角色，阵亡则跟着回滚', () => {
  const ch = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 97 });
  const run = createRun({ character: ch, seed: 4 });
  run.reward = { options: [{ kind: 'relic', id: 'ironBracer', lv: 3 }] };
  applyReward(run, 0);

  const defBefore = ch.def || 0;
  writeBackToCharacter(run, ch);
  assert.equal(ch.def, defBefore + 6, '3 级护腕的 6 点防御要跟着人回大厅');

  wipeOnDeath(ch);
  assert.equal(ch.def, ch.initial.def, '阵亡时面板必须回滚 —— 否则人死了反而白赚 6 点防御');
});

test('强化奖励：选中后进祭坛，自选目标 +1', () => {
  const run = createRun({ character: createCharacter({ classId: 'warrior', raceId: 'stone', seed: 93 }), seed: 4 });
  run.deck = ['strike', 'strike', 'guard'];

  run.reward = { options: [{ kind: 'upgrade', id: 'altar', label: '强化祭坛' }] };
  applyReward(run, 0);

  assert.equal(run.phase, 'upgrade', '选了强化应该进祭坛');
  assert.ok(run.upgradeTargets.includes('strike'));
  chooseUpgradeCard(run, 'strike');
  assert.deepEqual(run.deck, ['strike+1', 'strike', 'guard']);
});

test('材料奖励：加进这一趟的 materials', () => {
  const run = createRun({ character: createCharacter({ classId: 'mage', raceId: 'shade', seed: 94 }), seed: 4 });
  const before = run.materials;

  run.reward = { options: [{ kind: 'material', id: 'material', amount: 2, label: '材料 +2' }] };
  applyReward(run, 0);

  assert.equal(run.materials, before + 2);
});

/* ------------------------------------------------------------------ *
 * v1.6：卡池扩充
 *
 * 通用 8 → 14（加了 6 张一次性道具），每职业 12 → 15。
 * 新增的牌全部只用**已有字段**组合，不引入新机制 ——
 * 这个项目在 `thorns` / `ironRing.hpFlat` 上吃够了"字段写了没人读"的亏。
 * ------------------------------------------------------------------ */

test('通用池 23 张，全部存在且不是种族卡', () => {
  /** v3.25：打击退出通用池（四职业各有自己的基础攻击牌），19 → 18
   *  v3.91：+5 张宝石牌，18 → 23（抽取权重 0.7，见 cards.cardDrawWeight） */
  assert.equal(GENERIC_CARD_IDS.length, 23);
  for (const id of GENERIC_CARD_IDS) {
    assert.ok(CARDS[id], `通用池里的 ${id} 不存在`);
    assert.equal(CARDS[id].race, undefined, `${id} 是种族卡，不该出现在通用池`);
  }
});

test('每个职业 17 张专属卡，全部存在且不与通用池重复', () => {
  for (const cls of Object.values(CLASSES)) {
    assert.equal(cls.pool.length, 17, `${cls.name} 的池子 ${cls.pool.length} 张`); // v2.1：+2 决策卡
    for (const id of cls.pool) {
      assert.ok(CARDS[id], `${cls.name} 的 ${id} 不存在`);
      assert.equal(CARDS[id].race, undefined, `${id} 是种族卡`);
      assert.equal(GENERIC_CARD_IDS.includes(id), false, `${id} 同时出现在通用池，重复了`);
    }
  }
});

test('魔力宝石：0 费换 2 点能量', () => {
  const b = stubBattle({ deck: Array(5).fill('gem') });
  const before = b.player.energy;
  playCard(b, 0);
  assert.equal(b.player.energy, before + 2);
});

test('火药炸弹：穿甲打满，护甲一点不掉', () => {
  const b = stubBattle({
    deck: Array(5).fill('bomb'),
    enemy: stubEnemy({ hp: 300, armor: 40 }),
  });
  playCard(b, 0);
  assert.equal(b.enemy.armor, 40, '无视护甲就不该消耗护甲');
  assert.equal(b.enemy.hp, 300 - Math.round(CARDS.bomb.dmg * atkMul(10)));
});

test('菌丝：1 费上 5 层毒并抽 1 张（v3.87 从 0 费/3 毒涨价）', () => {
  const b = stubBattle({ deck: Array(10).fill('t_fungus') });
  const handBefore = b.hand.length;
  playCard(b, 0);
  assert.equal(b.enemy.poison, 5);
  assert.equal(b.hand.length, handBefore, '打出 1 张、抽回 1 张，手牌数不变');
});

test('盾墙：给护甲同时挂反伤', () => {
  const b = stubBattle({ deck: Array(5).fill('w_shieldWall') });
  playCard(b, 0);
  assert.equal(b.player.armor, Math.round(CARDS.w_shieldWall.block * atkMul(10)));
  assert.equal(b.player.thorns, 2, 'v3.53：荆棘是层数（盾墙 2 层）');
});

test('绽放：只放大已有毒，不会自己上毒', () => {
  const b = stubBattle({
    deck: Array(5).fill('t_bloom'),
    enemy: stubEnemy({ poison: 10 }),
  });
  playCard(b, 0);
  assert.equal(b.enemy.poison, 18, '10 层 ×1.8');
});

test('职业卡抽取权重高于通用卡：出现率应在 55%~72% 之间', () => {
  let clsCards = 0;
  let genericCards = 0;

  for (let seed = 1; seed <= 150; seed++) {
    const stub = rewardStub({ seed });
    const { options } = buildReward(stub, 'normal');
    for (const o of options) {
      if (o.kind !== 'card') continue;
      if (CLASSES.warrior.pool.includes(o.id)) clsCards++;
      else if (GENERIC_CARD_IDS.includes(o.id)) genericCards++;
    }
  }

  const rate = clsCards / (clsCards + genericCards);
  assert.ok(rate > 0.55 && rate < 0.72, `职业卡占比 ${(rate * 100).toFixed(0)}%，权重没生效`);
});

/* ---------------- v3.15 连携（铺垫 → 兑现） ----------------
 *
 * 用户反馈：「卡牌之间配合还是太少了，没什么套路，都是啪啪啪直接点玩」。
 * 这一组测试守的是"连携真的落到了数值上"：
 * 每一张兑现牌在**条件满足**和**条件不满足**时伤害必须拉开差距，
 * 否则玩家在牌面上读到"每点护甲 +0.3"就只是装饰。
 */

test('连携 · 护甲兑现：护甲越厚，「重砸」打得越沉', () => {
  const hit = (armor) => {
    const b = stubBattle({ deck: Array(10).fill('w_slam') });
    b.player.armor = armor;
    const hp = b.enemy.hp;
    playCard(b, b.hand.findIndex((k) => k === 'w_slam'));
    return hp - b.enemy.hp;
  };
  const bare = hit(0);
  const loaded = hit(30);
  assert.ok(bare > 0);
  assert.ok(loaded > bare * 1.25, `30 甲时该明显更疼：${bare} → ${loaded}`);
  /** 30 甲 × 0.03 × atkMul(10) = +9.9 → 与本体分别圆整后差 10 */
  assert.equal(loaded - bare, Math.round(30 * CARDS.w_slam.dmgPerArmor * atkMul(10)));
});

test('连携 · 法术铺场：先打技能牌，「陨石」才砸得疼', () => {
  const hit = (skillFirst) => {
    const b = stubBattle({ deck: Array(10).fill('m_meteor') });
    b.hand = skillFirst ? ['m_shield', 'm_meteor', 'strike', 'strike', 'strike'] : ['m_meteor', 'strike', 'strike', 'strike', 'strike'];
    b.player.energy = MAX_ENERGY;
    if (skillFirst) playCard(b, 0);
    const hp = b.enemy.hp;
    playCard(b, b.hand.indexOf('m_meteor'));
    return hp - b.enemy.hp;
  };
  const bare = hit(false);
  const combo = hit(true);
  assert.ok(combo > bare, `铺 1 张技能牌后该更高：${bare} → ${combo}`);
  const M = CARDS.m_meteor;
  assert.equal(combo - bare, Math.round((M.dmg + M.perSkill) * atkMul(10)) - Math.round(M.dmg * atkMul(10))); // perSkill × 1 层
});

test('连携 · 猎杀：对虚弱目标，「狙击」整张质变', () => {
  const hit = (weak) => {
    const b = stubBattle({ deck: Array(10).fill('h_snipe') });
    if (weak) b.enemy.weakTurns = 3;
    const hp = b.enemy.hp;
    playCard(b, b.hand.findIndex((k) => k === 'h_snipe'));
    return hp - b.enemy.hp;
  };
  const bare = hit(false);
  const weak = hit(true);
  assert.ok(weak > bare * 1.4, `虚弱时该 ×1.5：${bare} → ${weak}`);
});

test('连携 · 毒爆：毒层越多，「枯萎」炸得越狠', () => {
  const hit = (poison) => {
    const b = stubBattle({ deck: Array(10).fill('t_blight') });
    b.enemy.poison = poison;
    const hp = b.enemy.hp;
    playCard(b, b.hand.findIndex((k) => k === 't_blight'));
    return hp - b.enemy.hp;
  };
  const bare = hit(0);
  const stacked = hit(10);
  assert.ok(stacked > bare * 2, `10 层毒时该翻倍以上：${bare} → ${stacked}`);
});

test('连携 · 计数按"本回合"重置，不会跨回合累积', () => {
  const b = stubBattle({ deck: Array(12).fill('m_meteor') });
  b.hand = ['m_shield', 'm_meteor', 'm_shield', 'm_meteor', 'strike'];
  b.player.energy = MAX_ENERGY;
  playCard(b, 0); // 技能牌 ×1
  assert.equal(b.skillsThisTurn, 1);
  endTurn(b);
  assert.equal(b.skillsThisTurn, 0, '新回合清零');
  assert.equal(b.cardsThisTurn, 0);
});

test('强化祭坛：离开不弃单，回地图还能再进（v3.34）', () => {
  const run = createRun({ character: createCharacter({ classId: 'warrior', raceId: 'stone', seed: 10 }), seed: 1 });
  run.deck = ['strike', 'guard'];

  enterUpgradeAltar(run);
  assert.ok(cancelUpgrade(run));
  assert.equal(run.phase, 'map');
  assert.ok(run.upgradeTargets?.length > 0, '目标列表保留 —— 地图顶栏的「祭坛」按钮靠它出现');

  assert.ok(reopenAltar(run));
  assert.equal(run.phase, 'upgrade');
  assert.deepEqual([...run.upgradeTargets].sort(), ['guard', 'strike'], '重进后还是同一批候选');

  assert.ok(chooseUpgradeCard(run, 'strike'));
  assert.equal(run.upgradeTargets, null, '强化用掉后清空');
  assert.equal(reopenAltar(run), false, '用掉后不能凭空再进');
});
