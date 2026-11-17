/**
 * v2.1 卡牌决策机制测试
 *
 * 覆盖四块：
 *   1. 手牌上限 10
 *   2. 代价字段（costHp / energyPenalty / discardRandom）
 *   3. 连击（perAttack）与净化（cleanseBlock）
 *   4. 状态牌「伤口」：不可打出、占手牌位、来源（陷阱事件 / 污染词条）、战斗内限定
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../src/core/rng.js';
import { CARDS, cardText, cardOf, GENERIC_CARD_IDS, POOL_EXCLUDED_IDS } from '../src/core/cards.js';
import { HAND_LIMIT, MAX_ENERGY, DRAW_PER_TURN } from '../src/core/combat.js';
import { atkMul } from '../src/core/leveling.js';
import { createBattle, playCard, endTurn, canPlay, battleView, damagePlayer } from '../src/core/combat.js';
import { MUTATIONS } from '../src/core/enemyTraits.js';
import { makeEnemy, CURVE } from '../src/core/enemies.js';
import { createRun, triggerCell, enterUpgradeAltar, chooseUpgradeCard } from '../src/core/run.js';
import { createCharacter } from '../src/core/roster.js';
import { RACES, CLASSES, ENERGY_MIN, ENERGY_MAX } from '../src/core/characters.js';
import { makeShop } from '../src/core/shop.js';
import { RELICS } from '../src/core/relics.js';

/* ---------------- 工具（与 engine.test.mjs 同款桩） ---------------- */

function stubEnemy(over = {}) {
  const base = {
    id: 'dummy', name: '木桩', tier: 'normal', floor: 1,
    core: null, mutations: [], traits: [],
    deck: [], hand: [], draw: [], discard: [],
    energy: 5,
    hp: 300, maxHp: 300, atk: 0, baseAtk: 0, armor: 0, poison: 0,
    weakTurns: 0, keepPoison: false, turn: 0, enraged: 0,
    revived: false, charged: false, hitThisTurn: 0,
    manual: true,
  };
  return { ...base, ...over };
}

function stubBattle({ deck, enemy, hand, racePerk } = {}) {
  const b = createBattle({
    player: { hp: 100, maxHp: 100, atk: 10 },
    enemy: enemy ?? stubEnemy(),
    deck: deck ?? Array(5).fill('strike'),
    relics: [],
    rng: new Rng(42),
    racePerk: racePerk ?? {},
  });
  if (hand) {
    // 测试需要精确控制手牌时：先清空自动抽的手牌再塞
    b.hand.length = 0;
    b.hand.push(...hand);
  }
  return b;
}

/* ---------------- 1. 手牌上限 ---------------- */

test('手牌上限为 8（v3.82：出牌区两排 × 4 张）', () => {
  assert.equal(HAND_LIMIT, 8);
});

test('手牌到上限就不再抽：上回合剩牌会顶掉新抽的', () => {
  const b = stubBattle({ deck: Array(40).fill('brace') }); // 0 费不打出也行
  endTurn(b); endTurn(b); endTurn(b);
  assert.ok(b.hand.length <= HAND_LIMIT);
  assert.equal(b.hand.length, DRAW_PER_TURN, '每回合抽 DRAW_PER_TURN 张，不超上限');
});

/* ---------------- 2. 代价字段 ---------------- */

test('costHp：打出失去生命，但绝不致死（最低留 1）', () => {
  const b = stubBattle({ deck: Array(5).fill('strike') });
  b.hand.length = 0;
  b.hand.push('bloodPact', 'strike');
  b.player.hp = 50;
  const events = playCard(b, 0);
  assert.equal(b.player.hp, 42, '失去 8% 最大生命 = 8 点');
  assert.ok(events.some((e) => e.type === 'note' && /失去/.test(e.text)));

  // 濒死时代价不杀人
  const b2 = stubBattle({ deck: Array(5).fill('strike') });
  b2.hand.length = 0;
  b2.hand.push('bloodPact', 'strike');
  b2.player.hp = 1;
  playCard(b2, 0);
  assert.equal(b2.player.hp, 1, '代价不该杀人');
  assert.equal(b2.phase, 'player');
});

test('energyPenalty：下回合能量被扣减，之后恢复', () => {
  const b = stubBattle({ deck: Array(5).fill('strike') });
  b.hand.length = 0;
  b.hand.push('gamble', 'strike', 'strike', 'strike', 'strike');
  playCard(b, 0); // 孤注一掷：下回合 -2
  endTurn(b);
  assert.equal(b.player.energy, MAX_ENERGY - 2, `下回合 ${MAX_ENERGY} - 2`);
  endTurn(b);
  assert.equal(b.player.energy, MAX_ENERGY, '只罚一回合');
});

/* v3.58：能量上限成了角色属性（招募掷 5~8），战斗必须按角色值回能 */
test('能量上限跟角色走：5 点能量每回合只回 5，超载扣减也在 5 的基础上算', () => {
  const b = createBattle({
    player: { hp: 100, maxHp: 100, atk: 10, energy: 5 },
    enemy: stubEnemy(),
    deck: Array(5).fill('strike'),
    relics: [],
    rng: new Rng(42),
  });
  assert.equal(b.player.energyCap, 5, 'energyCap 取角色能量');
  assert.equal(b.player.energy, 5, '首回合回能按 5');
  b.hand.length = 0;
  b.hand.push('gamble', 'strike', 'strike', 'strike', 'strike');
  playCard(b, 0);
  endTurn(b);
  assert.equal(b.player.energy, 3, '5 - 2');
});

test('能量上限缺失（旧存档）退回 8，不因升级被打折', () => {
  const b = stubBattle({ deck: Array(5).fill('strike') });
  assert.equal(b.player.energyCap, MAX_ENERGY);
  assert.equal(b.player.energy, MAX_ENERGY);
});

test('discardRandom：打出后随机弃牌，弃的进弃牌堆', () => {
  const b = stubBattle({ deck: Array(6).fill('strike') });
  b.hand.length = 0;
  b.hand.push('reckless', 'strike', 'strike', 'guard', 'guard');
  const before = b.hand.length; // 5
  playCard(b, 0);
  assert.equal(b.hand.length, before - 2, '弃 1 张 + 打出 1 张');
  assert.ok(b.discard.length >= 1, '被弃的那张在弃牌堆');
  assert.ok(b.exhaust.includes('reckless'), '蛮勇本身是消耗牌');
});

/* ---------------- 3. 连击与净化 ---------------- */

test('perAttack：本回合第 2 张攻击牌起伤害递增', () => {
  const b = stubBattle({ deck: Array(8).fill('strike'), enemy: stubEnemy({ hp: 5000 }) });
  b.hand.length = 0;
  b.hand.push('flurry', 'strike', 'strike', 'strike', 'strike');
  b.player.atk = 100; // 放大差异好断言

  const am = atkMul(100); // v3.21 线性模型：攻击 100 → ×2
  const hpBefore = b.enemy.hp;
  playCard(b, 0); // 连打：第 1 张攻击牌，吃 0 层 → 0.5 × am
  assert.equal(hpBefore - b.enemy.hp, Math.round(CARDS.flurry.dmg * am));

  const hp2 = b.enemy.hp;
  /** 打击带同袍（v3.18）：四个牌堆里的同名张数 —— 打出前数已含手上这张，不再 +1 */
  const copies = [...b.draw, ...b.hand, ...b.discard, ...b.exhaust]
    .filter((k) => k === 'strike').length;
  playCard(b, 0);
  assert.equal(hp2 - b.enemy.hp, Math.round((CARDS.strike.dmg + CARDS.strike.perCopy * copies) * am));

  const hp3 = b.enemy.hp;
  // 连打已进弃牌堆；再从弃牌堆洗回来不现实，直接手动验证第 2 层连击
  b.hand.push('flurry');
  playCard(b, b.hand.length - 1); // 本回合第 3 张攻击牌 → (0.5 + 0.3×2) × am
  assert.equal(hp3 - b.enemy.hp, Math.round((CARDS.flurry.dmg + CARDS.flurry.perAttack * 2) * am));
});

test('perAttack 连击层数每回合清零', () => {
  const b = stubBattle({ deck: Array(8).fill('strike'), enemy: stubEnemy({ hp: 5000 }) });
  b.player.atk = 100;
  playCard(b, 0);
  endTurn(b);
  const hpBefore = b.enemy.hp;
  // 新回合第一张攻击牌：吃 0 层
  const idx = b.hand.findIndex((k) => k === 'strike');
  const copies = [...b.draw, ...b.hand, ...b.discard, ...b.exhaust]
    .filter((k) => k === 'strike').length;
  playCard(b, idx);
  // strike 带同袍：四个牌堆同名张数（打出前数，已含手上这张）（v3.18/3.21）
  assert.equal(hpBefore - b.enemy.hp, Math.round((CARDS.strike.dmg + CARDS.strike.perCopy * copies) * atkMul(100)));
});

test('cleanseBlock：净化移除手牌伤口并按张数给甲', () => {
  const b = stubBattle({ deck: Array(5).fill('guard') });
  b.hand.length = 0;
  b.hand.push('purify', 'wound', 'wound', 'guard', 'guard');
  playCard(b, 0);
  assert.equal(b.hand.filter((k) => k === 'wound').length, 0, '伤口应被移除');
  assert.equal(b.exhaust.filter((k) => k === 'wound').length, 2, '伤口进消耗堆');
  // 基础 block + 伤口 2 × cleanseBlock，各自 ×atkMul 后**分别取整再相加**
  // （gainArmor 是分两次调用的，v3.59 调低数值后合并取整会差 1 点）
  const am = atkMul(10);
  assert.equal(
    b.player.armor,
    Math.round(CARDS.purify.block * am) + Math.round(2 * CARDS.purify.cleanseBlock * am),
  );
});

/* ---------------- 4. 状态牌「伤口」 ---------------- */

test('伤口不可打出，即使能量充足', () => {
  const b = stubBattle({ deck: Array(5).fill('strike') });
  b.hand.length = 0;
  b.hand.push('wound', 'strike');
  assert.equal(canPlay(b, 0), false, '能量够也不能打');
  assert.equal(canPlay(b, 1), true);
  const events = playCard(b, 0);
  assert.deepEqual(events, [], '强行打出必须是无操作');
  assert.equal(b.hand.length, 2, '伤口留在手里');
});

test('伤口占手牌位：上限内挤占可抽张数', () => {
  const b = stubBattle({ deck: Array(5).fill('wound') });
  // 开局抽 5 张全是伤口 → 手牌 5 张全是死的
  assert.ok(b.hand.every((k) => k === 'wound'));
  assert.equal(b.hand.length, 5);
});

test('伤口不进任何奖励/商店池', () => {
  assert.ok(POOL_EXCLUDED_IDS.includes('wound'));
  assert.ok(!GENERIC_CARD_IDS.includes('wound'));
  for (const id of GENERIC_CARD_IDS) assert.ok(CARDS[id] && !CARDS[id].unplayable, `${id} 不该是不可用牌`);
});

test('污染词条存在且每次命中塞 1 张伤口进牌堆循环', () => {
  const mut = MUTATIONS.mut_curse;
  assert.ok(mut, '污染词条应存在');
  assert.equal(mut.kind, 'curseOnHit');

  const enemy = stubEnemy({
    traits: [{ id: mut.id, kind: 'curseOnHit', value: 1 }],
    hand: ['e_strike'], atk: 10,
  });
  const b = stubBattle({ enemy, deck: Array(8).fill('guard') });
  b.player.armor = 0;
  b.player.dodge = 0;
  endTurn(b); // 敌人命中 → 伤口进抽牌堆 → 回合开始又被抽/洗进循环
  const all = [...b.draw, ...b.hand, ...b.discard];
  assert.equal(all.filter((k) => k === 'wound').length, 1, '伤口应已进入牌堆循环');
});

test('伤口回合末脱落：只惩罚当回合，不滚雪球', () => {
  const enemy = stubEnemy({ traits: [{ id: 'mut_curse', kind: 'curseOnHit', value: 1 }], hand: ['e_strike'], atk: 10 });
  const b = stubBattle({ enemy, deck: Array(3).fill('guard') });
  b.draw.length = 0;
  b.draw.push('wound');
  b.hand.length = 0;
  b.hand.push('guard');
  endTurn(b); // 敌人命中 → 伤口进抽牌堆 → 回合开始抽到 → 回合末脱落进消耗堆
  // 无论伤口此刻在手牌/抽牌堆/弃牌堆，它绝不该重复积累：多打几个回合后应全部进消耗堆
  for (let i = 0; i < 3; i++) endTurn(b);
  assert.ok(b.exhaust.filter((k) => k === 'wound').length >= 1, '伤口应脱落进消耗堆');
  const alive = b.hand.filter((k) => k === 'wound').length + b.draw.filter((k) => k === 'wound').length + b.discard.filter((k) => k === 'wound').length;
  assert.equal(alive, 0, '伤口不该在牌堆里无限循环');
});

/* ---------------- 卡面文案 ---------------- */

test('代价与条件字段都有生成文案，伤口写明不可打出', () => {
  assert.match(cardText('gamble', 10), /下回合能量 -2/);
  assert.match(cardText('bloodPact', 10), /失去 8% 最大生命/);
  assert.match(cardText('flurry', 10), /攻击牌/);
  assert.match(cardText('purify', 10), /伤口/);
  assert.equal(cardText('wound', 10), '无法打出；回合末脱落');
  assert.ok(!cardText('gamble', 10).includes('undefined'));
});

/**
 * v3.59：战旗/战吼/狂化/奥术强化/瞄准/回响 的 `strength` 只写进 `b.player.strength`，
 * 战斗结束随 run.player 一起消失。旧文案写「永久 +N 点攻击」，玩家以为是养成资产。
 */
test('力量牌文案必须写明「本场战斗」，不得出现「永久」', () => {
  let n = 0;
  for (const [id, c] of Object.entries(CARDS)) {
    if (c.strength == null) continue;
    n++;
    const t = cardText(id, 10);
    assert.ok(t.includes('本场战斗'), `${id} 文案应写本场战斗，实际：${t}`);
    assert.ok(!t.includes('永久'), `${id} 文案不该写永久，实际：${t}`);
  }
  assert.ok(n >= 5, `至少 5 张力量牌，实际 ${n}`);
});

/**
 * 护甲效率护栏（v3.59 立，v3.64 收紧到 12）：叠甲太容易的直接原因是"每点能量换多少甲"。
 * 纯护甲牌（没有附带伤害/效果）1 费封顶 12 甲 —— 再往上就是一张牌顶一整轮攻击。
 * 带别的字段的牌（荆棘/消耗/代价/治疗）不设这条线，它们的强度由附带效果定价。
 */
test('纯护甲牌每费不超过 12 点护甲', () => {
  const extra = ['dmg', 'heal', 'poison', 'weak', 'draw', 'thorns', 'exhaust', 'costHp',
    'cleanseBlock', 'race', 'energy', 'strength', 'amplifyPoison', 'unplayedArmor'];
  for (const [id, c] of Object.entries(CARDS)) {
    if (c.block == null) continue;
    if (extra.some((f) => c[f] != null && c[f] !== false)) continue;
    const limit = c.cost === 0 ? 4 : c.cost * 12;
    assert.ok(c.block <= limit, `${id} 护甲 ${c.block} 超出 ${c.cost} 费上限 ${limit}`);
  }
});

test('新增决策卡都进了通用池或对应职业池可达范围', () => {
  for (const id of ['gamble', 'bloodPact', 'flurry', 'purify']) {
    assert.ok(GENERIC_CARD_IDS.includes(id), `${id} 应在通用池`);
  }
  for (const id of ['w_bloodShield', 'w_berserk', 'm_overload', 'm_bloodScribe', 'h_burst', 'h_explosive', 't_sapLife', 't_bog']) {
    assert.ok(CARDS[id], `${id} 卡牌应存在`);
  }
});

/* ---------------- 陷阱事件 → 下一场战斗 ---------------- */

test('陷阱事件把伤口混入下一场战斗，打完即清', async () => {
  const character = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 7 });
  const run = createRun({ character, seed: 7 });

  // 找一个事件格强制改成陷阱，直接结算
  const map = run.floorMap;
  const evIdx = map.cells.findIndex((c) => c.kind === 'event');
  assert.ok(evIdx >= 0, '本层应有事件格');
  map.cells[evIdx].revealed = true; // 测试绕过迷雾相邻规则
  map.cells[evIdx].data.event = 'trap';

  const res = triggerCell(run, evIdx);
  assert.ok(res.ok);
  assert.equal(run.pendingWounds, 1, '陷阱应攒 1 张伤口');
  assert.match(res.text, /伤口/);

  // 模拟开战：伤口应进战斗牌库（battle 内部 draw）
  const { startCellBattle } = await import('../src/core/run.js');
  const enemyIdx = map.cells.findIndex((c) => c.kind === 'enemy' && !c.done);
  assert.ok(enemyIdx >= 0);
  startCellBattle(run, enemyIdx);
  const b = run.battle;
  const total = b.draw.length + b.hand.length;
  const woundCount = [...b.draw, ...b.hand].filter((k) => k === 'wound').length;
  assert.equal(woundCount, 1, '战斗牌库应有 1 张伤口');
  assert.ok(total > run.deck.length, '伤口是叠加在卡组之外的战斗内限定');
});


/* ---------- v2.2 种族天赋机制 ---------- */

test('磐石（石头人）：战斗开始 6 甲，每回合开始再 +2', () => {
  const b = stubBattle({ deck: Array(5).fill('brace'), racePerk: { armorStart: 6, armorPerTurn: 2 } });
  assert.equal(b.player.armor, 8, '首回合 = 开场 6 + 回合开始 2');
  endTurn(b); // 敌人 no-op，新回合开始再 +2
  assert.equal(b.player.armor, 10, '甲跨回合保留，累计 10');
});

test('光合（青苔族）：回合结束时剩余能量 ×2 化为护甲', () => {
  const b = stubBattle({ deck: Array(5).fill('brace'), racePerk: { energyToArmor: 2 } });
  assert.equal(b.player.energy, MAX_ENERGY);
  endTurn(b); // 一张没打，能量全剩
  assert.equal(b.player.armor, MAX_ENERGY * 2, `剩余 ${MAX_ENERGY} × 2 甲`);
  assert.equal(b.player.energy, MAX_ENERGY, '新回合能量照常重置');
});

test('光合：把能量花光就没有甲 —— 这是个真决策', () => {
  const b = stubBattle({ deck: Array(5).fill('strike'), racePerk: { energyToArmor: 2 } });
  while (b.hand.length && canPlay(b, 0)) playCard(b, 0);
  const left = b.player.energy;
  endTurn(b);
  assert.equal(b.player.armor, left * 2, `只把剩下的 ${left} 点化成甲`);
});

test('残影（影族）：每回合第一次受击 -35%，第二次全额', () => {
  const b = stubBattle({ deck: Array(5).fill('brace'), racePerk: { firstHitReduce: 0.3 } });
  damagePlayer(b, 40);
  assert.equal(b.player.hp, 72, '首击 40 → 28（-30%）');
  damagePlayer(b, 40);
  assert.equal(b.player.hp, 32, '第二击全额 40');
  endTurn(b); // 新回合标记重置
  damagePlayer(b, 20);
  assert.equal(b.player.hp, 18, '新回合首击再次减伤：20 → 14');
});

test('余烬（余烬族）：每回合只有第一张攻击牌附灼烧，技能不触发', () => {
  const b = stubBattle({ deck: Array(8).fill('strike'), racePerk: { burnOnHit: 1 } });
  b.hand.length = 0;
  b.hand.push('strike', 'strike', 'guard');
  playCard(b, 0); // 第一张攻击
  assert.equal(b.enemy.poison, 1, '首张攻击 +1 灼烧');
  playCard(b, 0); // 第二张攻击，同回合不再附
  assert.equal(b.enemy.poison, 1, '第二张攻击不触发余烬');
  playCard(b, 0); // 技能
  assert.equal(b.enemy.poison, 1, '技能不触发');
  endTurn(b); // 新回合
  b.hand.length = 0;
  b.hand.push('strike');
  playCard(b, 0);
  assert.equal(b.enemy.poison, 1, '新回合重新触发（上回合底毒衰减 1，再 +1）');
});

test('强化祭坛：入口在 run 层，与奖励/铁匠共用（engine.test 已覆盖主流程）', () => {
  // 这里只验证导出存在且行为闭环：进 → 选 → 回地图
  const run = createRun({ classId: 'warrior', raceId: 'stone', seed: 5 });
  run.deck = ['strike', 'guard'];
  assert.ok(enterUpgradeAltar(run));
  assert.equal(run.phase, 'upgrade');
  assert.ok(chooseUpgradeCard(run, 'strike'));
  assert.equal(run.phase, 'map');
  assert.deepEqual(run.deck, ['strike+1', 'guard']);
});

/* ------------------------------------------------------------------ *
 * v3.18 机制套路化：鏖战 / 收势 / 同袍
 * ------------------------------------------------------------------ */

test('鏖战：同一场里第二打开始伤害递增（奥术弹 +18%/次）', () => {
  const b = stubBattle({ deck: Array(8).fill('guard'), enemy: stubEnemy({ hp: 5000 }) });
  b.hand.length = 0;
  b.hand.push('m_bolt', 'm_bolt');
  b.player.atk = 100;

  const am = atkMul(100); // v3.21：攻击 100 → ×2
  playCard(b, 0); // 第一打：1.5 × am，无加成
  assert.equal(b.enemy.hp, 5000 - Math.round(CARDS.m_bolt.dmg * am));

  playCard(b, 0); // 第二打：1.5 × am × 1.18
  assert.equal(b.enemy.hp, 5000 - Math.round(CARDS.m_bolt.dmg * am) - Math.round(CARDS.m_bolt.dmg * am * 1.18));
});

test('收势护甲：固守结算「未打出的手牌数 × 0.25 × 攻击力」', () => {
  const b = stubBattle({ deck: Array(8).fill('guard'), enemy: stubEnemy({ hp: 5000 }) });
  b.hand.length = 0;
  b.hand.push('w_fortify', 'guard', 'guard', 'guard'); // 打 1 张，剩 3 张
  playCard(b, 0);
  const armorAfterPlay = b.player.armor; // 固守本体 1.2 × atkMul(10)
  endTurn(b);
  // 收势：3 张未打出 × 0.25 × atkMul(10)（v3.21 与攻击力同口径）
  assert.equal(b.player.armor, armorAfterPlay + Math.round(3 * CARDS.w_fortify.unplayedArmor * atkMul(10)));
});

test('收势毒：菌丝结算「未打出的手牌数 × unplayedPoison」并记到敌人头上', () => {
  const b = stubBattle({ deck: Array(8).fill('guard'), enemy: stubEnemy({ hp: 5000 }) });
  b.hand.length = 0;
  b.hand.push('t_fungus', 'guard', 'guard');
  playCard(b, 0);
  const poisonAfterPlay = b.enemy.poison; // 菌丝本体 3（它的 draw:1 又抽回 1 张 → 未打出 3 张）
  endTurn(b);
  // 收势 +unplayedPoison×3，回合末毒发后衰减 1
  assert.equal(b.enemy.poison, poisonAfterPlay + Math.round(CARDS.t_fungus.unplayedPoison * 3) - 1);
});

test('收势只在打出过的回合结算，下一回合不再触发', () => {
  const b = stubBattle({ deck: Array(8).fill('guard'), enemy: stubEnemy({ hp: 5000 }) });
  b.hand.length = 0;
  b.hand.push('w_fortify', 'guard');
  playCard(b, 0);
  endTurn(b);
  const armorAfterT1 = b.player.armor;
  endTurn(b); // 第二回合什么都没打
  assert.equal(b.player.armor, armorAfterT1);
});

test('同袍：牌组里同名牌越多打击越疼（含打出的这张）', () => {
  const b = stubBattle({ deck: Array(8).fill('guard'), enemy: stubEnemy({ hp: 5000 }) });
  b.hand.length = 0;
  b.hand.push('strike', 'strike'); // 打出 1 张，手里还留 1 张同名牌
  b.player.atk = 100;
  // 同袍 = 手里 1 张 + 打出的这张 = 2 → (1.2 + 0.2×2) × atkMul(100)
  playCard(b, 0);
  assert.equal(b.enemy.hp, 5000 - Math.round((CARDS.strike.dmg + CARDS.strike.perCopy * 2) * atkMul(100)));
});

/* ---------------- 7. 职业基础攻击牌（v3.25，GAME_DESIGN §4.16） ---------------- */

/**
 * 四个职业各有一张自己的 1 费基础攻击牌：劈砍 / 法球 / 放箭 / 毒牙。
 *
 * v3.24 试过"同一张「打击」，效果由职业天赋追加"，但图鉴和背包里四个职业
 * 看到的都是同一张牌 —— 用户的口径更直接：名字变了就是另一张牌，
 * 效果就该写在卡上。这组测试钉住三件事：
 *   ① 起始卡组用的是各自的牌，且不再出现 strike；
 *   ② 劈砍带甲、毒牙带毒是卡牌数据，不是职业天赋；
 *   ③ 卡面文案中性口径就能读出差异（图鉴不传 perk 也看得出职业不同）。
 */
function playFresh(cardKey, extra = {}) {
  const b = createBattle({
    player: { hp: 100, maxHp: 100, atk: 10 },
    enemy: stubEnemy({ hp: 9000, atk: 0 }),
    deck: Array(5).fill('guard'),
    relics: [],
    rng: new Rng(7),
    racePerk: {},
    ...extra,
  });
  b.hand.length = 0;
  b.hand.push(cardKey);
  const before = b.enemy.hp;
  playCard(b, 0);
  return { dmg: before - b.enemy.hp, armor: b.player.armor, poison: b.enemy.poison };
}

test('职业基础牌：起始卡组各用自己的牌，strike 已退出所有卡池与起始卡组', () => {
  const basics = { warrior: 'w_chop', mage: 'm_orb', hunter: 'h_arrow', traveler: 't_fang' };
  for (const [id, basic] of Object.entries(basics)) {
    const cls = CLASSES[id];
    assert.ok(cls.core.includes(basic), `${cls.name} 的起始卡组应含 ${basic}`);
    assert.ok(!cls.core.includes('strike'), `${cls.name} 不该再带通用打击`);
    assert.ok(!cls.pool.includes('strike'), `${cls.name} 的职业池不该有打击`);
    assert.notEqual(CARDS[basic].name, '打击');
  }
  // 通用池也不再发打击（v3.25 退出），但定义保留给老存档/竞技场快照
  assert.ok(!GENERIC_CARD_IDS.includes('strike'), '通用池不该再发打击');
  assert.ok(CARDS.strike, '定义必须保留，否则老存档里的 strike 读不出来');
  // 同袍载体：四张基础牌都要带 perCopy
  for (const basic of Object.values(basics)) {
    assert.equal(CARDS[basic].perCopy, CARDS.strike.perCopy, `${CARDS[basic].name} 应带同袍系数`);
    assert.equal(CARDS[basic].cost, 1);
    assert.equal(CARDS[basic].dmg, CARDS.strike.dmg);
  }
});

test('职业基础牌：劈砍出手带甲、毒牙带毒，都写在卡牌数据里', () => {
  const w = playFresh('w_chop', { perk: CLASSES.warrior.perk });
  const t = playFresh('t_fang', { perk: CLASSES.traveler.perk });
  const m = playFresh('m_orb', { perk: CLASSES.mage.perk });
  const h = playFresh('h_arrow', { perk: CLASSES.hunter.perk });

  assert.ok(w.armor >= 1, `劈砍应带护甲，实际 ${w.armor}`);
  assert.equal(t.poison, 1, '毒牙应附带 1 层中毒');
  assert.equal(m.armor, 0, '法球不带甲');
  assert.equal(h.poison, 0, '放箭不带毒');
  // 法师的法术加成仍在天赋里，法球因此比劈砍/毒牙疼
  assert.ok(m.dmg > w.dmg, `法球吃 +34%，伤害应更高：${m.dmg} vs ${w.dmg}`);
  assert.equal(w.dmg, t.dmg, '劈砍与毒牙本体伤害相同（差异在附加效果）');
});

test('职业基础牌：卡面中性口径就写得出差异，强化版同样生效', () => {
  const chop = cardText('w_chop', 10);
  const fang = cardText('t_fang', 10);
  const orb = cardText('m_orb', 10);
  const arrow = cardText('h_arrow', 10);

  assert.match(chop, /护甲/, `劈砍卡面应写护甲：${chop}`);
  assert.match(fang, /中毒/, `毒牙卡面应写中毒：${fang}`);
  assert.ok(!orb.includes('护甲') && !orb.includes('中毒'), `法球卡面应干净：${orb}`);
  assert.ok(!arrow.includes('护甲') && !arrow.includes('中毒'), `放箭卡面应干净：${arrow}`);
  // 图鉴不传 perk，四张牌读起来就是四张不同的牌
  assert.ok(chop !== orb && orb !== arrow && arrow !== fang);

  // 强化版 +N 一样带效果（效果写在卡牌数据里，不依赖 id 判定）
  const up = playFresh('t_fang+2', { perk: CLASSES.traveler.perk });
  assert.ok(up.poison >= 1, `毒牙 +2 也应带毒，实际 ${up.poison}`);
  const upChop = playFresh('w_chop+2', { perk: CLASSES.warrior.perk });
  assert.ok(upChop.armor >= 1, `劈砍 +2 也应带甲，实际 ${upChop.armor}`);
});

/* ---------------- v3.50 能量对账 ---------------- */

test('实验之眼不重复计数：法术循环每 2 张才回 1，不是每张', () => {
  /**
   * v3.50 回归。旧版 expEye.onCardPlayed 里自己又 ++ 了一次 cardsPlayed，
   * 而 playCard 已经加过 —— 法师起手就带这件，计数永远停在偶数上，
   * 「每 2 张回 1 能量」于是变成每张都回：0 费牌打完 +1、1 费不消耗、2 费只扣 1。
   * 用户报的就是这个"能量对不上账"。
   */
  const b = stubBattle({ hand: Array(6).fill('strike') });
  b.player.energy = 8;
  b.perk = { energyPerCards: 2 };
  b.relics = [RELICS.expEye];

  const trail = [];
  for (let i = 0; i < 4; i++) {
    b.player.energy = trail.length ? b.player.energy : 8;
    const evs = playCard(b, 0);
    trail.push({ energy: b.player.energy, loop: evs.some((e) => e.type === 'energy') });
  }

  assert.equal(b.cardsPlayed, 4, `出 4 张牌，计数就该是 4（宝物不能重复加）：实际 ${b.cardsPlayed}`);
  assert.deepEqual(trail.map((t) => t.energy), [7, 7, 6, 6],
    `1 费牌节奏应为 -1 / ±0 / -1 / ±0，实际 ${trail.map((t) => t.energy)}`);
  assert.deepEqual(trail.map((t) => t.loop), [false, true, false, true],
    `法术循环只该落在第 2、4 张：实际 ${trail.map((t) => t.loop)}`);
});

test('法术循环的回能带来源标注（飘字与记录要看得出原因）', () => {
  const b = stubBattle({ hand: Array(4).fill('strike') });
  b.player.energy = 8;
  b.perk = { energyPerCards: 2 };
  playCard(b, 0);
  const evs = playCard(b, 0);
  const energy = evs.find((e) => e.type === 'energy');
  assert.ok(energy, '第 2 张应有回能事件');
  assert.equal(energy.label, '法术循环 +1 能量');
  const last = b.log[b.log.length - 1];
  assert.match(last.detail, /能量 \+1/, `战斗记录应写明回能：${last.detail}`);
});

/* ---------------- v3.52 反伤口径 ---------------- */

test('尖刺/荆棘按本体生命百分比反弹，层数不直接进公式', () => {
  /**
   * 旧口径 value + scale×层数（尖刺 2+0.3/层）已废弃：用户要求"跟某个属性挂钩，
   * 不要用层数计算"。现在是 本体生命(baseHp) × 2%（尖刺）/ 3%（荆棘）。
   * 同一只 200 血的怪，无论站在第 1 层还是第 20 层，反弹都该是 4 点。
   */
  const trait = { id: 'mut_thorns', name: '尖刺', kind: 'thorns', value: 0.02, text: '' };
  const reflectAt = (floor) => {
    const b = stubBattle({
      enemy: stubEnemy({ floor, baseHp: 200, maxHp: 200, traits: [trait] }),
      hand: ['strike'],
    });
    const before = b.player.hp;
    playCard(b, 0);
    return before - b.player.hp;
  };

  assert.equal(reflectAt(1), 4);
  assert.equal(reflectAt(20), 4, '层数不同但本体生命相同 → 反弹相同');
});

test('精英/首领的难度倍率不放大反伤：看 baseHp 而不是 maxHp', () => {
  const trait = { id: 'core_thorns', name: '荆棘', kind: 'thorns', value: 0.03, text: '' };
  const b = stubBattle({
    // 精英生命 ×1.7：340，但本体仍是 200 → 反弹 6 而不是 10
    enemy: stubEnemy({ tier: 'elite', baseHp: 200, maxHp: 340, traits: [trait] }),
    hand: ['strike'],
  });
  const before = b.player.hp;
  playCard(b, 0);
  assert.equal(before - b.player.hp, 6, '反弹按本体生命 200×3% = 6');
});

/* ---------------- v3.53 荆棘层数 buff ---------------- */

test('荆棘是层数 buff：受击反弹等于层数，与护甲无关', () => {
  /**
   * 旧口径是「护甲 × 比例」，护甲被打空反伤就归零。v3.53 改成层数：
   * 每层每次受击反弹 1 点，层数本场累计。用户：「受到荆棘层数的伤害」。
   */
  const b = stubBattle({ hand: ['w_counter'] });
  b.player.energy = 8;
  playCard(b, 0);
  assert.equal(b.player.thorns, 4, '反击给 4 层');

  b.player.armor = 0;
  const ehp = b.enemy.hp;
  damagePlayer(b, 20);
  assert.equal(ehp - b.enemy.hp, 4, '没有护甲也照反 4 点');

  const ehp2 = b.enemy.hp;
  damagePlayer(b, 20);
  assert.equal(ehp2 - b.enemy.hp, 4, '层数不衰减，第二次受击照样反');
});

test('荆棘层数吃知识：每点知识 +1% 层数', () => {
  const b = stubBattle({ hand: ['w_counter'] });
  b.player.knowledge = 50;
  b.player.energy = 8;
  playCard(b, 0);
  assert.equal(b.player.thorns, 6, '4 层 × (1 + 50×1%) = 6 层');
});

test('荆棘背心：战斗开始给 4 层（与牌面同口径）', () => {
  const b = createBattle({
    player: { hp: 100, maxHp: 100, atk: 10 },
    enemy: stubEnemy(),
    deck: Array(5).fill('strike'),
    relics: [RELICS.thornsVest],
    rng: new Rng(42),
  });
  assert.equal(b.player.thorns, 4, '开局 4 层，不再走「护甲 30%」');
  const ehp = b.enemy.hp;
  damagePlayer(b, 20);
  assert.equal(ehp - b.enemy.hp, 4);
});

/* ---------------- v3.55 敌人也吃暴击 / 闪避 / 知识 ---------------- */

test('敌人暴击：命中后 ×1.5，记录写「它暴击」', () => {
  /**
   * 用户：「暴击，闪避，知识敌人也可以吃到」。暴击走独立的 foeCritRng，
   * 不能和玩家暴击共用一条流 —— 否则玩家堆暴击会连带改变敌人何时暴击。
   */
  const hitOnce = (crit, roll) => {
    const b = stubBattle({ enemy: stubEnemy({ atk: 60, crit, hand: ['e_strike'], energy: 5 }) });
    b.foeCritRng = { next: () => roll };
    const before = b.player.hp;
    endTurn(b);
    return { lost: before - b.player.hp, log: b.log.map((l) => l.detail).join(' | ') };
  };

  const plain = hitOnce(0, 0);          // 没这项属性
  const crit = hitOnce(30, 0);          // 有 30 点、判定必定命中
  const miss = hitOnce(30, 1);          // 同样有暴击，但这次没掷中

  assert.ok(crit.lost > plain.lost, `暴击伤害 ${crit.lost} 应高于普通 ${plain.lost}`);
  assert.ok(crit.lost / plain.lost > 1.35 && crit.lost / plain.lost < 1.65,
    `倍率应接近 ×1.5：${plain.lost} → ${crit.lost}`);
  assert.equal(miss.lost, plain.lost, '没掷中就跟普通一击一样');
  assert.match(crit.log, /它暴击/, `战斗记录要写明它暴击了：${crit.log}`);
});

test('敌人闪避：完全躲开一次攻击，卡白打；中毒 tick 不受影响', () => {
  const b = stubBattle({ enemy: stubEnemy({ dodge: 30 }), hand: ['strike'] });
  b.player.energy = 8;
  const orig = b.rng.next.bind(b.rng);
  b.rng.next = () => 0;                 // 必定闪避
  const hpBefore = b.enemy.hp;
  const evs = playCard(b, 0);
  b.rng.next = orig;

  assert.equal(b.enemy.hp, hpBefore, '闪开了就一点血都不掉');
  assert.equal(evs.filter((e) => e.type === 'dodge').length, 1, '要有闪避事件给 UI 飘字');
  assert.match(b.log[b.log.length - 1].detail, /被它闪开/, '记录要写清是被它闪开，不是自己没打中');
});

test('敌人闪避值不超过玩家闪避上限（不能堆到必闪）', () => {
  const b = stubBattle({ enemy: stubEnemy({ dodge: 999 }), hand: ['strike'] });
  b.player.energy = 8;
  let dodged = 0;
  for (let i = 0; i < 200; i++) {
    b.enemy.hp = 300;
    b.hand = ['strike'];
    b.player.energy = 8;
    if (playCard(b, 0).some((e) => e.type === 'dodge')) dodged++;
  }
  /** 上限 30%，200 次应当落在 20%~42%，绝不能接近 100% */
  assert.ok(dodged < 84, `200 次里闪了 ${dodged} 次，超过了 30% 上限`);
  assert.ok(dodged > 0, '至少该闪几次（否则属性没生效）');
});

test('敌人知识：每点 +1% 它施加的虚弱回合数', () => {
  const weakLine = (knowledge) => {
    const b = stubBattle({ enemy: stubEnemy({ knowledge, hand: ['e_roar'], energy: 5 }) });
    b.foeCritRng = { next: () => 1 };
    endTurn(b);
    return b.log.map((l) => l.detail).join(' | ');
  };
  assert.match(weakLine(0), /虚弱 2/, `没有知识：咆哮给 2 回合 —— ${weakLine(0)}`);
  assert.match(weakLine(50), /虚弱 3/, `知识 50：2 × 1.5 = 3 回合 —— ${weakLine(50)}`);
});

test('敌人属性随层数与档位增长，但封顶（不越过玩家上限）', () => {
  const e1 = makeEnemy(1, new Rng(7), 'normal');
  const e30 = makeEnemy(30, new Rng(7), 'boss');
  assert.ok(e30.crit > e1.crit, `第 30 层首领暴击 ${e30.crit} 应高于第 1 层 ${e1.crit}`);
  assert.ok(e30.crit <= CURVE.enemyCritCap, `暴击封顶 ${CURVE.enemyCritCap}，实际 ${e30.crit}`);
  assert.ok(e30.dodge <= CURVE.enemyDodgeCap, `闪避封顶 ${CURVE.enemyDodgeCap}，实际 ${e30.dodge}`);
  assert.ok(e30.knowledge > e1.knowledge, '知识随层数增长');
});

/* ------------------------------------------------------------------ *
 * 6. v3.87：回合结束保留手牌 / 能量与费用收紧
 * ------------------------------------------------------------------ */

test('回合结束不丢手牌：没打出的牌留在手里，弃牌堆只收真的打出去的', () => {
  const b = stubBattle({ deck: Array(20).fill('guard') });
  b.hand.length = 0;
  b.hand.push('guard', 'guard');
  endTurn(b);
  assert.equal(b.hand.length, DRAW_PER_TURN, '两张留着 + 补抽到 5 张');
  assert.equal(b.discard.length, 0, '没打出的两张没进弃牌堆');
});

test('回合开始只补抽到 DRAW_PER_TURN：手里够数就不抽', () => {
  const b = stubBattle({ deck: Array(30).fill('guard') });
  b.hand.length = 0;
  b.hand.push(...Array(DRAW_PER_TURN).fill('guard'));
  const before = b.hand.slice();
  endTurn(b);
  assert.deepEqual(b.hand, before, '手里 5 张没动，新回合不再抽');
  assert.equal(b.draw.length, 30 - DRAW_PER_TURN, '牌堆没被白抽走');
});

test('收势只算本回合摸进来的牌 —— 留着的老牌不重复吃', () => {
  const ratio = CARDS.w_fortify.unplayedArmor;
  const b = stubBattle({ deck: Array(30).fill('w_fortify'), enemy: stubEnemy({ hp: 5000 }) });
  b.hand.length = 0;
  b.hand.push(...Array(DRAW_PER_TURN).fill('w_fortify'));

  playCard(b, 0);
  const armorAfterPlay = b.player.armor;
  endTurn(b);
  assert.equal(b.player.armor, armorAfterPlay + Math.round((DRAW_PER_TURN - 1) * ratio * atkMul(10)),
    '第一回合：摸 5 打 1 → 4 张未打出');

  // 第二回合：手里还有 4 张老牌，只补抽 1 张、打 1 张 → 收势按 0 张算
  playCard(b, 0);
  const armorAfterPlay2 = b.player.armor;
  endTurn(b);
  assert.equal(b.player.armor, armorAfterPlay2, '留着的老牌不能再吃一次收势');
});

test('能量区间收紧到 4~6（v3.87），兜底上限同步', () => {
  assert.equal(ENERGY_MIN, 4);
  assert.equal(ENERGY_MAX, 6);
  assert.equal(MAX_ENERGY, 6);
});

test('0 费只给过牌 / 能量 / 带代价的牌（纯产出牌一律 1 费起）', () => {
  const justified = (c) => c.unplayable || c.draw != null || c.energy != null
    || c.costHp != null || c.energyPenalty != null || c.exhaust;
  for (const [id, c] of Object.entries(CARDS)) {
    if (c.cost !== 0) continue;
    assert.ok(justified(c), `${id}（${c.name}）是 0 费纯产出牌，应按新口径涨到 1 费`);
  }
  /** 曾经的白嫖牌现在都要收费 */
  for (const id of ['jab', 'brace', 'smoke', 'w_taunt', 'h_step', 'h_quickdraw', 't_fungus', 'h_aim']) {
    assert.equal(CARDS[id].cost, 1, `${id} 应已涨到 1 费`);
  }
});
