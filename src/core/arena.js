/**
 * 竞技场 —— 两个真人角色快照的 1:1 镜像对战
 *
 * ## 为什么重写（v1.4）
 *
 * 旧版做的是"折算"：把对手的角色压成敌方规格 —— 卡组换成 `e_*` 敌方行动牌，
 * 攻击力乘一个 4.3 的补偿系数，宝物一件都不生效。
 *
 * 结果是**对手不是你**：界面写着"生命 980、攻击 46"，但它是个披着你名字的怪物，
 * 出的是 e_slam / e_bulwark，没有能量循环、没有中毒、没有护甲牌、没有宝物。
 * 玩家赢了不知道赢在哪，输了也不知道输在哪 —— 而且那个 4.3 是个永远调不准的手感旋钮。
 *
 * 现在改成镜像：**双方各有一套完整的玩家状态**（护甲 / 能量 / 中毒 / 虚弱 / 力量 /
 * 暴击 / 闪避 / 防御 / 治疗 / 宝物钩子 / 职业天赋 / 强化卡 / 种族被动），
 * 共用 combat.js 的同一份出牌结算 `applyCard`。
 * 所以对面真的是"另一个玩家角色"，你看到的重击就是重击，它的铁砧也会真的回能量。
 *
 * ## 为什么不在 combat.js 里做
 *
 * PvE 的 enemy 是怪物：卡池是 ENEMY_CARDS、没有护甲牌、没有宝物、没有能量循环。
 * 让它改打玩家牌，会把"怪物模型"和"角色模型"揉进同一个状态机，
 * 30 层探险的每一处判定都要跟着分叉。镜像战是**独立的第二套回合循环**，
 * 只共用结算函数，不共用状态机 —— 这条边界必须守住。
 *
 * ## 先手
 *
 * 玩家先手（观战体验）。先手优势是卡牌游戏的常态，代价是竞技场胜率会略高于 50%，
 * 这一点用"对手匹配"去平衡，不去篡改先手顺序。
 */

import { Rng } from './rng.js';
import { cardOf, cardName, gemText } from './cards.js';
import { CLASSES, RACES } from './characters.js';
import { resolveRelics } from './relics.js';
import { applyCard, gainArmor, MAX_ENERGY, DRAW_PER_TURN, HAND_LIMIT } from './combat.js';
import { equipBonus } from './equipment.js';
import { atkMul } from './leveling.js';

/**
 * 加时狂暴。
 *
 * PvE 靠敌人的「狂暴」词条收尾，镜像战双方都是角色、没有词条，
 * 两个回复流对撞会互奶到天荒地老。这里用一条**对称**的规则兜底：
 * 第 12 回合起双方同时 +12% 攻击，压力只增不减。
 */
const ENRAGE_TURN = 12;
const ENRAGE_PCT = 0.12;

/** 硬上限。到点还没分出胜负就按剩余生命比例判定 */
export const ARENA_MAX_TURNS = 40;

/**
 * 后手补偿（v1.4）。
 *
 * 镜像战的先手优势比一般卡牌游戏大得多，两个原因叠在一起：
 *   1. **战斗短**（3~8 回合）。先手多打一回合 = 多 30% 输出，
 *      而 TCG 里 10 回合的先手优势只有 10%。
 *   2. **护甲跨回合保留**（叠甲流的前提）。先手先叠甲，就永远领先对方
 *      一个回合的护甲量；后手每回合都得先破甲，越打越亏。
 *
 * 补偿用卡牌游戏最标准的两样：多抽牌 + 多一点首回合资源。
 * 数值由 self-play 扫到 50% 附近（见 tools/arena-sim.mjs）。
 */
export const SECOND_ENERGY = 4;
export const SECOND_DRAW = 2;

/**
 * 竞技场赛制：双方生命同时 ×2.5。
 *
 * **这不是"对手折算"。** 折算是对一方动手脚（旧版把 ghost 的 HP/ATK 拉到
 * 一个目标评级），而这里是**双方同一系数**，相对强度完全不变 —— 两个角色
 * 仍然 1:1，只是把"一场决斗"从 2 回合拉长到 7~9 回合的表演赛。
 *
 * 为什么必须拉长：2 回合的战斗里，"先打死对方"的唯一因素就是先手，
 * 实测先手胜率 100%，后手补偿怎么加都是 82%（手牌上限 7 封顶，再多的能量
 * 也没牌可打）。只有把回合数拉到 8 上下，先手才退回"多打一回合"的
 * 正常量级（约 12%），补偿才抹得平。（v2.1：手牌上限提到 10，补偿数值未变）
 *
 * 为什么不用"给后手加护甲"这类临时手段：那会在观战里凭空出现一坨
 * 没有来源的护甲，玩家看不懂。血量系数至少是"这场比赛的规则"。
 */
export const ARENA_HP_MUL = 3;

/* ------------------------------------------------------------------ *
 * 一"侧"：玩家的完整战斗状态
 * ------------------------------------------------------------------ */

/**
 * 把角色快照摊成战斗状态。
 *
 * 刻意和 run.player 同构（字段名完全一致），这样 applyCard 不用改一行。
 * `relicSlots` 不参与 —— 未激活的种族宝物本来就不该生效，对手也一样。
 */
function makeSide(ch, side) {
  const cls = CLASSES[ch.classId] || CLASSES.warrior;
  /**
   * v2.2：快照缺 raceId 时不再是"默认石头人" —— 无种族 = 无天赋。
   * 旧默认会让所有测试 stub 莫名多出磐石护甲，数值对不上。
   */
  const race = (ch.raceId && RACES[ch.raceId]) || { perk: {} };
  /**
   * 装备加成（v2.3）：快照里带着 `equipped`（`[{defId, lv}]`）。
   *
   * 玩家和幽灵走同一条路 —— 幽灵快照在 pushGhost 时就冻结了当时的装备，
   * 所以镜像战不会出现"我穿着装备、对手脱光"的不对等。
   */
  const eq = equipBonus(ch.equipped || []);
  // 赛制血量系数（双方相同，不动相对强度），见 ARENA_HP_MUL
  const maxHp = Math.max(1, Math.round(((ch.maxHp || 1) + (eq.maxHp || 0)) * ARENA_HP_MUL));
  /** 快照里的真实血量，结果页要显示"他本来是多少血"，而不是被赛制放大后的数 */
  const baseMaxHp = Math.max(1, Math.round((ch.maxHp || 1) + (eq.maxHp || 0)));

  return {
    side, // 'p' 玩家 / 'e' 对手
    id: ch.id,
    name: ch.name || '无名者',
    classId: ch.classId,
    level: ch.level || 1,

    hp: maxHp,
    maxHp,
    baseMaxHp,
    atk: Math.max(1, Math.round((ch.atk || 1) + (eq.atk || 0))),
    knowledge: ch.knowledge || 0,
    luck: ch.luck || 0,
    def: (ch.def || 0) + (eq.def || 0),
    crit: (ch.crit || 0) + (eq.crit || 0),
    dodge: (ch.dodge || 0) + (eq.dodge || 0),
    recovery: (ch.recovery || 0) + (eq.recovery || 0),

    /* 战斗内状态：和 run.player 同名，applyCard 直接写 */
    strength: 0,
    armor: 0,
    poison: 0,
    weakTurns: 0,
    thorns: 0,
    energy: 0,
    /** v3.58：能量上限跟着角色走（招募掷 5~8），旧角色没有字段时按全局 8 */
    energyCap: Math.max(1, Number(ch.energy) || MAX_ENERGY),
    energyDrain: 0,
    keepPoison: false,

    /* 牌堆 */
    deck: [...(ch.deck || ['strike'])],
    draw: [],
    hand: [],
    discard: [],
    exhaust: [],

    /* 宝物与天赋 */
    relics: resolveRelics(ch.relics || []),
    perk: { ...(cls.perk || {}) },
    racePerk: { ...(race.perk || {}) },

    /* 计数：applyCard / 宝物钩子会读写 */
    cardsPlayed: 0,
    pendingDraw: 0,
    firstAttacksUsed: 0,
    /** v2.1：连击乘区。镜像视图必须带上，否则 perAttack 牌会算出 NaN 伤害 */
    attacksThisTurn: 0,
    /** v3.15：法术/终结连携的乘区，同理必须带上（undefined 会算出 NaN） */
    skillsThisTurn: 0,
    cardsThisTurn: 0,
    /** v3.18 机制套路化：鏖战计数 + 收势登记（与 PvE 同口径） */
    played: {},
    turnPayoffs: [],
    /** v2.2：「残影」每回合首受击减伤，回合开始重置 */
    firstHitUsed: false,
    /** v2.2：「余烬」每回合第一张攻击牌附灼烧 */
    burnUsedThisTurn: false,
  };
}

/* ------------------------------------------------------------------ *
 * 视图适配 —— 让 applyCard 认得出"谁是出牌方"
 * ------------------------------------------------------------------ */

/**
 * 把 (me, foe) 摆成 combat.js 期望的 battle 形状。
 *
 * applyCard 只认 `b.player` / `b.enemy` / `b.relics` / `b.perk` / `b.hand` 这些键，
 * 所以不需要真的造一个战斗对象，凑一个视图就够。
 * 视图上的**标量**（firstAttacksUsed / pendingDraw / cardsPlayed / phase）是副本，
 * 结算完必须用 absorbView 写回 —— 对象字段（hp、armor、hand 数组）本来就是引用，不用管。
 */
function combatView(me, foe, ctx) {
  return {
    rng: ctx.rng,
    /** v3.23：暴击判定走独立子流（与 combat.createBattle 同口径） */
    critRng: ctx.critRng,
    player: me,
    enemy: foe,
    relics: me.relics,
    perk: me.perk,
    racePerk: me.racePerk,
    events: ctx.events,
    notes: ctx.notes,
    hand: me.hand,
    draw: me.draw,
    discard: me.discard,
    exhaust: me.exhaust,
    firstAttacksUsed: me.firstAttacksUsed,
    pendingDraw: me.pendingDraw,
    cardsPlayed: me.cardsPlayed,
    attacksThisTurn: me.attacksThisTurn,
    skillsThisTurn: me.skillsThisTurn || 0,
    cardsThisTurn: me.cardsThisTurn || 0,
    played: me.played,
    turnPayoffs: me.turnPayoffs,
    burnUsedThisTurn: me.burnUsedThisTurn,
    phase: 'player',
  };
}

/** 把视图上被改过的标量写回，返回结算后的相位（'player' | 'lost'） */
function absorbView(me, v) {
  me.firstAttacksUsed = v.firstAttacksUsed;
  me.pendingDraw = v.pendingDraw;
  me.cardsPlayed = v.cardsPlayed;
  me.attacksThisTurn = v.attacksThisTurn;
  me.skillsThisTurn = v.skillsThisTurn;
  me.cardsThisTurn = v.cardsThisTurn;
  me.burnUsedThisTurn = v.burnUsedThisTurn;
  return v.phase;
}

/* ------------------------------------------------------------------ *
 * 抽牌 / 日志
 * ------------------------------------------------------------------ */

/** 赛制血量 → 快照真实血量（日志和结果页只认真实数） */
function realHpOf(s) {
  return Math.max(0, Math.round((s.hp / s.maxHp) * s.baseMaxHp));
}

/** 抽牌规则与 PvE 完全一致（手牌上限 10、牌堆空则洗弃牌堆） */
function drawFor(me, n, rng) {
  for (let i = 0; i < n; i++) {
    if (me.hand.length >= HAND_LIMIT) break;
    if (me.draw.length === 0) {
      if (me.discard.length === 0) break;
      me.draw = rng.shuffle(me.discard);
      me.discard = [];
    }
    me.hand.push(me.draw.pop());
  }
}

/**
 * 把一次出牌的 events 压成一句人话。
 *
 * 和 combat.js 的 summarizeEvents 同构，只改了一处：用「对手」而不是「你」，
 * 因为镜像战里同一句话在两侧都要能读（`target: 'enemy'` = 打到了对手）。
 */
function summarize(events) {
  const out = [];
  for (const ev of events) {
    switch (ev.type) {
      case 'damage': {
        const who = ev.target === 'player' ? '自己 ' : '对手 ';
        if (ev.value <= 0 && ev.absorbed > 0) out.push(`${who}被护甲挡住`);
        else if (ev.absorbed > 0) out.push(`${who}-${ev.value}（护甲吃 ${ev.absorbed}）`);
        else out.push(`${who}-${ev.value}`);
        break;
      }
      case 'armor': if (ev.value > 0) out.push(`+${ev.value} 护甲`); break;
      case 'heal': if (ev.value > 0) out.push(`+${ev.value} 生命`); break;
      case 'poison': out.push(`毒 ${ev.value}`); break;
      case 'poisonTick': out.push(`毒发 ${ev.value}`); break;
      case 'weak': out.push(`虚弱 ${ev.value}`); break;
      case 'strength': out.push(`力量 +${ev.value}`); break;
      case 'energy': out.push(`能量 +${ev.value}`); break;
      case 'dodge': out.push('被闪避'); break;
      case 'crit': out.push('暴击'); break;
      case 'note': out.push(ev.text); break;
      default: break;
    }
  }
  return out.join(' · ');
}

/* ------------------------------------------------------------------ *
 * 出牌
 * ------------------------------------------------------------------ */

/**
 * 给一张牌打分 —— 竞技场版的机器人在用。
 *
 * 和 PvE 的机器人（tools/bot.mjs）思路相同，但**护甲的估值必须压下去**：
 * PvE 里护甲能一直扛住怪物的固定输出，慢慢磨死它；PvP 里对面有 5~7 张牌
 * 的输出量，护甲只是把死亡延后一回合，而它自己一分伤害都不产生。
 *
 * 这条不是手感问题，是实测出来的：护甲权重按 PvE 那套（1.0~1.5 倍攻击）时，
 * 战士的机器人每回合都在叠甲，一局下来几乎不出攻击牌，竞技场对谁都是 0 胜。
 * 观战 AI 不会玩，比对手弱得多，测出来的胜率就毫无意义。
 */
function scoreCard(me, foe, key) {
  const c = cardOf(key);
  if (!c) return -1;
  if (c.unplayable) return -100; // 状态牌永不选（v2.1，与 PvE 机器人同口径）

  /** v3.21：与 combat 同口径（攻击力线性 +1%/点），否则观战 AI 会高估高攻卡 */
  const atk = atkMul(me.atk + me.strength);
  const myHp = me.hp / me.maxHp;
  const foeHp = foe.hp / foe.maxHp;
  let s = 0;

  if (c.dmg != null) {
    let d = c.dmg * atk * (c.hits || 1);
    if (c.exec != null && foeHp < c.exec) d *= 2;
    if (c.pierce) d *= 1.1;
    if (c.scaleArmor != null) d *= 1 + me.armor * c.scaleArmor;
    if (c.dmgPerPoison != null) d += foe.poison * c.dmgPerPoison * atk;
    /* v3.15 连携兑现（与 PvE 机器人同口径） */
    if (c.dmgPerArmor != null) d += (me.armor || 0) * c.dmgPerArmor * atk;
    if (c.consumeArmorMul != null) d += (me.armor || 0) * c.consumeArmorMul * atk;
    if (c.poisonBurst != null) d += foe.poison * c.poisonBurst * atk;
    if (c.energyBurst != null) d += (me.energy || 0) * c.energyBurst * atk;
    if (c.perSkill != null) d += (me.skillsThisTurn || 0) * c.perSkill * atk;
    if (c.perCard != null) d += (me.cardsThisTurn || 0) * c.perCard * atk;
    if (c.ifWeakMul != null && foe.weakTurns > 0) d *= c.ifWeakMul;
    if (c.perAttack != null) d += Math.min(me.attacksThisTurn || 0, 4) * c.perAttack * atk;
    // 打死对面永远是最高优先级
    if (d >= foe.hp) d *= 3;
    s += d;
  }
  /**
   * 护甲：只有"这一下能救我的命"时才按全额算，否则按半价。
   * 半价的依据是对手的单回合输出 ≈ 它血量的某个比例，这里用血量比例
   * 粗估危险程度 —— 血多时叠甲是浪费回合，血少时才值得。
   */
  if (c.block != null) s += c.block * atk * (myHp < 0.35 ? 1.2 : 0.5);
  if (c.heal != null) s += c.heal * atk * (myHp < 0.45 ? 1.6 : 0.3);
  if (c.poison != null) s += c.poison * 2.2;
  if (c.amplifyPoison != null) s += foe.poison * c.amplifyPoison * atk * 1.1;
  if (c.draw != null) s += c.draw * 4.5;
  if (c.energy != null) s += c.energy * 4.5;
  if (c.strength != null) s += c.strength * 3.0;
  if (c.weak != null) s += c.weak * 3.2;
  if (c.keepPoison) s += 8;
  /**
   * 荆棘（v3.53）：字段是**层数**，每层每次受击反弹 1 点。
   * 一次战斗大约受击 8~12 次，按每层 ≈ 10 点期望估值（不可能每场都打满）。
   */
  if (c.thorns != null) s += c.thorns * 10;
  /* v2.1：代价类扣分（与 PvE 机器人同口径） */
  if (c.costHp != null) {
    const lost = Math.max(1, Math.round(me.maxHp * c.costHp));
    s -= lost * (myHp < 0.35 ? 3 : 1.2);
  }
  if (c.energyPenalty != null) s -= c.energyPenalty * 6;
  if (c.discardRandom != null) s -= c.discardRandom * 5;
  if (c.cleanseBlock != null) {
    const wounds = (me.hand || []).filter((k) => cardOf(k)?.unplayable).length;
    s += wounds * c.cleanseBlock * atk * 0.8;
  }
  return s;
}

/**
 * 打出一张牌，返回 me 是否被自己的反噬打死（荆棘 / 反伤）。
 *
 * 顺序严格对齐 combat.playCard：扣能量 → 结算 → 记日志 → 天赋 → 宝物钩子 →
 * 补抽 → 进弃牌/消耗堆。任何一处偏差都会让镜像战的胜率和 PvE 不可比。
 *
 * v3.33：ctx 换成整场战斗 b —— 交互出牌和自动出牌共用它，事件流只此一份。
 */
function playOne(me, foe, index, b) {
  const key = me.hand[index];
  const card = cardOf(key);
  if (!card) return false;

  me.hand.splice(index, 1);
  me.energy -= card.cost;
  me.cardsPlayed++;
  /**
   * 计数不要在这里做：applyCard 内部已经按 kind 自增 attacksThisTurn / skillsThisTurn /
   * cardsThisTurn。v3.15 之前这里也自增了一次（perAttack 在镜像战里多吃一层），
   * 属于既有偏差，顺手一起修掉 —— 镜像战的意义就是"和 PvE 同一套规则"。
   */

  b.events.length = 0;
  b.notes.length = 0;
  const v = combatView(me, foe, b);
  applyCard(v, card, key);
  const selfDied = absorbView(me, v) === 'lost';

  b.log.push({ turn: b.turn, side: me.side, name: cardName(key), detail: summarize(b.events) });

  // 法师天赋：每 N 张牌回 1 能量
  if (me.perk.energyPerCards && me.cardsPlayed % me.perk.energyPerCards === 0) me.energy += 1;

  // 宝物钩子（实验之眼：每 3 张抽 1）
  for (const r of me.relics) {
    const v2 = combatView(me, foe, b);
    r.onCardPlayed?.(v2);
    absorbView(me, v2);
  }

  if (me.pendingDraw > 0) {
    drawFor(me, me.pendingDraw, b.rng);
    me.pendingDraw = 0;
  }

  if (card.exhaust) me.exhaust.push(key);
  else me.discard.push(key);

  return selfDied;
}

/**
 * 挑一张"现在最该打"的牌，返回手牌下标；没有打得起的返回 -1。
 *
 * 玩家那侧不用它（人自己决定），对手那侧每一张都走它 —— 所以它是
 * "对手是不是个像样的对手"的唯一开关。v3.33 起被 arenaEnemyStep 逐张调用。
 */
function pickBest(me, foe) {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < me.hand.length; i++) {
    const c = cardOf(me.hand[i]);
    if (!c || c.unplayable || c.cost > me.energy) continue;
    const s = scoreCard(me, foe, me.hand[i]);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

/** 自动出牌：贪心，直到没有打得起的牌（给模拟与"对手一整回合"用） */
function autoPlay(me, foe, b) {
  let guard = 0;
  while (guard++ < 40) {
    const best = pickBest(me, foe);
    if (best < 0) break;
    if (playOne(me, foe, best, b)) return 'lost';
    if (foe.hp <= 0) return 'won';
  }
  return 'ok';
}

/* ------------------------------------------------------------------ *
 * 一个回合
 * ------------------------------------------------------------------ */

/**
 * 一方回合的**开场**：回能 → 种族天赋 → 后手补偿 → 宝物回合钩子 → 抽牌。
 *
 * v3.33 拆成"开场 / 出牌 / 收场"三段，交互出牌与自动模拟共用同一份。
 * 拆的时候逐行对齐旧 sideTurn 的顺序 —— 任何一处挪动都会让竞技场
 * 与已标定的平衡数值不可比（尤其后手补偿必须在宝物钩子之前）。
 */
function beginTurn(me, foe, b) {
  me.energy = (me.energyCap ?? MAX_ENERGY) - me.energyDrain;
  me.energyDrain = 0;
  me.attacksThisTurn = 0;
  me.skillsThisTurn = 0;
  me.cardsThisTurn = 0;
  me.firstHitUsed = false;
  me.burnUsedThisTurn = false;

  /** 每人一场只有第一次行动算"首回合"（磐石 armorStart / 后手补偿都挂在这上面） */
  const isFirst = !me.firstTurnDone;
  me.firstTurnDone = true;

  /**
   * 种族天赋「磐石」（v2.2）：首回合 armorStart、之后每回合 armorPerTurn。
   * 走 gainArmor（战士 armorGain / 宝物加成同样生效），与 PvE 同口径。
   */
  if (me.racePerk.armorStart || me.racePerk.armorPerTurn) {
    b.events.length = 0;
    b.notes.length = 0;
    const v = combatView(me, foe, b);
    if (isFirst && me.racePerk.armorStart) gainArmor(v, me.racePerk.armorStart);
    if (me.racePerk.armorPerTurn) gainArmor(v, me.racePerk.armorPerTurn);
    absorbView(me, v);
    const sum = summarize(b.events);
    b.events.length = 0;
    b.notes.length = 0;
    if (sum) b.log.push({ turn: b.turn, side: me.side, name: '磐石', detail: sum });
  }

  // 后手补偿
  const bonusDraw = isFirst && me.isSecond ? b.secondDraw : 0;
  if (isFirst && me.isSecond) me.energy += b.secondEnergy;

  // 宝物回合开始钩子（铁砧回能 / 厚重壁垒削甲 / 毒龙宝石转甲 / 荆棘指环加甲）
  for (const r of me.relics) {
    const v = combatView(me, foe, b);
    r.onTurnStart?.(v);
    absorbView(me, v);
  }

  const drawBonus = me.relics.reduce((s, r) => s + (r.drawBonus || 0), 0);
  drawFor(me, DRAW_PER_TURN + drawBonus + bonusDraw, b.rng);

  b.log.push({ turn: b.turn, side: me.side, name: '回合开始', detail: `${realHpOf(me)}/${me.baseMaxHp} 血` });
}

/**
 * 一方回合的**收场**：宝物回合末钩子 → 光合 → 收势 → 弃手牌 → 虚弱/中毒结算。
 *
 * @returns {'ok'|'lost'} 以 me 的视角（中毒可能把自己毒死）
 */
function endTurnOf(me, foe, b) {
  // 回合结束钩子（木龙盾：护甲转毒）
  for (const rel of me.relics) {
    const v = combatView(me, foe, b);
    rel.onTurnEnd?.(v);
    absorbView(me, v);
  }

  /**
   * 种族天赋「光合」（v2.2）：剩余能量转化为护甲，与 PvE 同口径
   * （宝物 onTurnEnd 之后、手牌弃掉之前）。
   */
  if (me.racePerk.energyToArmor && me.energy > 0) {
    const v = combatView(me, foe, b);
    const gained = gainArmor(v, me.energy * me.racePerk.energyToArmor);
    me.energy = 0;
    absorbView(me, v);
    b.events.length = 0;
    b.notes.length = 0;
    if (gained > 0) b.log.push({ turn: b.turn, side: me.side, name: '光合', detail: `剩余能量化为 +${gained} 护甲` });
  }

  /**
   * 收势（v3.18）：与 PvE 的 endTurn 同口径 —— 每有一张未打出的手牌，
   * 结算当回合打出过的收势牌（甲给自己、毒上对手）。
   */
  if (me.hand.length > 0 && me.turnPayoffs.length > 0) {
    const n = me.hand.length;
    const armorRatio = me.turnPayoffs.reduce((t, x) => t + (x.armor || 0), 0);
    const poisonAdd = me.turnPayoffs.reduce((t, x) => t + (x.poison || 0), 0);
    const parts = [];
    if (armorRatio > 0) {
      const g = Math.round(armorRatio * n * atkMul(me.atk));
      if (g > 0) { me.armor += g; parts.push(`+${g} 护甲`); }
    }
    if (poisonAdd > 0) {
      const pg = Math.round(poisonAdd * n);
      if (pg > 0) { foe.poison += pg; parts.push(`+${pg} 毒`); }
    }
    if (parts.length) b.log.push({ turn: b.turn, side: me.side, name: '收势', detail: `${n} 张未打出 → ${parts.join(' · ')}` });
  }
  me.turnPayoffs = [];

  me.discard.push(...me.hand);
  me.hand = [];

  /**
   * 虚弱在自己回合**结束时**减 1。
   *
   * 为什么不在回合开始减：那样「施加 2 回合虚弱」实际只废掉对方 1 个回合
   * （回合一开始就先扣掉了）。PvE 的敌人侧本来就是回合末扣的，
   * 镜像战必须和它一致，否则同一张「破防」在两边价值不同。
   */
  if (me.weakTurns > 0) me.weakTurns--;

  /**
   * 自己身上的毒在**自己回合结束时**发作。
   *
   * PvE 里毒 tick 发生在"玩家点结束回合 → 敌人行动 → 敌人毒发"，
   * 换成敌人的视角就是"我的回合出完牌，然后毒发"。镜像战照这个语义走，
   * 所以谁给对方上毒，谁就能在对方回合末看到它掉血 —— 和打怪时的手感一致。
   */
  if (me.hp > 0 && me.poison > 0) {
    const tick = me.poison;
    me.hp -= tick;
    b.log.push({ turn: b.turn, side: me.side, name: '中毒发作', detail: `-${tick}（无视护甲）` });
    /** 给飘字一条事件（UI 只认 events，日志它不看） */
    b.events.push({ type: 'damage', target: me.side === 'p' ? 'player' : 'enemy', value: tick, absorbed: 0 });
    if (!me.keepPoison) me.poison -= 1;
    if (me.hp <= 0) {
      me.hp = 0;
      return 'lost';
    }
  }

  return 'ok';
}

/* ------------------------------------------------------------------ *
 * 对外
 * ------------------------------------------------------------------ */

/**
 * 开一场竞技场。v3.33 起是**可交互**的 —— 玩家自己出牌，对手的回合逐张播放。
 *
 * 用法（UI 侧）：
 *   const b = createArenaBattle(me, ghost, seed)
 *   玩家回合：arenaPlay(b, i) / arenaEndTurn(b)
 *   对手回合：arenaEnemyStep(b) 一次走一张，UI 自己按节奏调
 *   结束：phase 变 'won' / 'lost' / 'timeout'，用 arenaResult(b) 取结果
 *
 * 玩家后手时，创建的一瞬间对手的回合就已经开场（phase = 'enemy'），
 * UI 直接开始播 —— 不做"先进战斗屏、再补一段对手先手"的二次跳转。
 *
 * @param {object} playerChar  出战角色（真实快照）
 * @param {object} ghostChar   对手快照（真实快照，不做任何缩放）
 * @param {number} seed
 * @param {{secondEnergy?:number, secondDraw?:number, forceFirst?:'p'|'e'}} [tuning]
 *        只给 tools/arena-sim.mjs 扫参用，游戏流程不要传。
 */
export function createArenaBattle(playerChar, ghostChar, seed = 1, tuning = {}) {
  const rng = new Rng(seed);
  const A = makeSide(playerChar, 'p');
  const B = makeSide(ghostChar, 'e');

  A.draw = rng.shuffle(A.deck.slice());
  B.draw = rng.shuffle(B.deck.slice());

  /**
   * v3.23：暴击用独立子流，不推进主 rng —— 否则"暴击多一次"就会改变后续出牌，
   * 镜像战胜率与 PvE 也不可比。与 combat.createBattle 的派生方式保持一致。
   */
  const b = {
    rng,
    critRng: new Rng((rng.save() ^ 0x9e3779b9) >>> 0),
    events: [],
    notes: [],
    player: A,
    enemy: B,
    turn: 1,
    /** player | enemy | won | lost | timeout —— won/lost 都以**玩家**视角 */
    phase: 'player',
    winner: null,
    log: [],
    playerFirst: true,
    secondEnergy: tuning.secondEnergy ?? SECOND_ENERGY,
    secondDraw: tuning.secondDraw ?? SECOND_DRAW,
  };

  // 开场宝物钩子（骨符 +8 护甲）。双方各跑一次，视角要各自摆正
  for (const [me, foe] of [[A, B], [B, A]]) {
    for (const r of me.relics) {
      const v = combatView(me, foe, b);
      r.onCombatStart?.(v);
      absorbView(me, v);
    }
  }

  /**
   * 先手由种子决定，不是"玩家永远先动"。
   *
   * 这是异步 PvP：玩家在自己这边发起挑战，对手只是一份快照。
   * 如果固定玩家先手，就等于把先手优势白送出去 —— 而实测这个优势
   * 在镜像战里是压倒性的（原因见 SECOND_ENERGY 的注释）。
   * 掷硬币 + 后手补偿，两边胜率才能都落在 50% 附近。
   */
  b.playerFirst = tuning.forceFirst ? tuning.forceFirst === 'p' : rng.next() < 0.5;
  A.isSecond = !b.playerFirst;
  B.isSecond = b.playerFirst;

  if (b.playerFirst) {
    beginTurn(A, B, b);
    b.phase = 'player';
  } else {
    /** 对手先手：它的回合在这里就开场，UI 进来直接开始播放 */
    beginTurn(B, A, b);
    b.phase = 'enemy';
  }
  return b;
}

/* ------------------------------------------------------------------ *
 * 交互：玩家出牌 / 结束回合 / 对手逐张行动
 * ------------------------------------------------------------------ */

/**
 * 玩家打出一张手牌。
 *
 * @returns {{ok:boolean, reason?:string, events:Array, line?:object, card?:object, phase:string}}
 *          events 给飘字与音效，line 是刚写进战斗记录的那一行。
 */
export function arenaPlay(b, index) {
  if (b.phase !== 'player') return { ok: false, reason: '现在不是你的回合', events: [], phase: b.phase };
  const key = b.player.hand[index];
  const card = cardOf(key);
  if (!card) return { ok: false, reason: '这张牌已经不在了', events: [], phase: b.phase };
  if (card.unplayable) return { ok: false, reason: '这张牌打不出去', events: [], phase: b.phase };
  if (card.cost > b.player.energy) return { ok: false, reason: '能量不够', events: [], phase: b.phase };

  const selfDied = playOne(b.player, b.enemy, index, b);
  const events = b.events.slice();
  const line = b.log[b.log.length - 1];

  if (selfDied) {
    b.player.hp = Math.max(0, b.player.hp);
    b.phase = 'lost';
    b.winner = 'e';
  } else if (b.enemy.hp <= 0) {
    b.enemy.hp = 0;
    b.phase = 'won';
    b.winner = 'p';
  }

  return { ok: true, events, line, card: { key, name: card.name, cost: card.cost }, phase: b.phase };
}

/**
 * 结束玩家回合 → 对手回合开场。
 *
 * 注意这里只做到"对手的回合已经开好场"，对手出牌交给 arenaEnemyStep
 * 一张一张走 —— 这样 UI 才有得播。
 */
export function arenaEndTurn(b) {
  if (b.phase !== 'player') return { ok: false, phase: b.phase, events: [] };

  b.events.length = 0;
  b.notes.length = 0;
  const r = endTurnOf(b.player, b.enemy, b);
  const events = b.events.slice();

  if (r === 'lost') {
    b.phase = 'lost';
    b.winner = 'e';
    return { ok: true, phase: 'lost', events };
  }
  if (b.enemy.hp <= 0) {
    b.phase = 'won';
    b.winner = 'p';
    return { ok: true, phase: 'won', events };
  }

  /**
   * 回合数按"双方各行动一次"才算一轮 —— 玩家先手时对手收场才跨轮，
   * 对手先手时这里就要跨（见 closeEnemyTurn 的同一段注释）。
   */
  if (!b.playerFirst && advanceRound(b)) {
    return { ok: true, phase: 'timeout', events };
  }

  beginTurn(b.enemy, b.player, b);
  b.phase = 'enemy';
  return { ok: true, phase: 'enemy', events };
}

/**
 * 对手回合走一步：打一张牌；打不起了就收场、把回合交回玩家。
 *
 * 一次只出一张是刻意的 —— UI 每 0.5 秒调一次，玩家能看到"它刚刚打了什么"。
 *
 * @returns {{done:boolean, phase:string, events:Array, line?:object, card?:object}}
 *          done=false 表示"还有牌要出"，done=true 表示这一回合结束
 */
export function arenaEnemyStep(b) {
  if (b.phase !== 'enemy') return { done: true, phase: b.phase, events: [] };

  const e = b.enemy;
  const p = b.player;
  const idx = pickBest(e, p);
  if (idx < 0) return closeEnemyTurn(b);

  const key = e.hand[idx];
  const card = cardOf(key);
  const selfDied = playOne(e, p, idx, b);
  const events = b.events.slice();
  const line = b.log[b.log.length - 1];
  const out = { done: false, phase: 'enemy', events, line, card: { key, name: card.name, cost: card.cost } };

  /** 反伤把自己打死了 —— 玩家赢 */
  if (selfDied) {
    e.hp = Math.max(0, e.hp);
    b.phase = 'won';
    b.winner = 'p';
    return { ...out, done: true, phase: 'won' };
  }
  if (p.hp <= 0) {
    p.hp = 0;
    b.phase = 'lost';
    b.winner = 'e';
    return { ...out, done: true, phase: 'lost' };
  }
  return out;
}

/** 对手回合收场：结算 → 加时 → 下一回合开局（或按回合上限判和） */
function closeEnemyTurn(b) {
  b.events.length = 0;
  b.notes.length = 0;
  const r = endTurnOf(b.enemy, b.player, b);
  const events = b.events.slice();

  if (r === 'lost') {
    b.phase = 'won';
    b.winner = 'p';
    return { done: true, phase: 'won', events };
  }
  if (b.player.hp <= 0) {
    b.player.hp = 0;
    b.phase = 'lost';
    b.winner = 'e';
    return { done: true, phase: 'lost', events };
  }

  // 玩家先手时，对手才是这一轮的收尾方
  if (b.playerFirst && advanceRound(b)) {
    return { done: true, phase: 'timeout', events, roundEnded: true };
  }

  beginTurn(b.player, b.enemy, b);
  b.phase = 'player';
  return { done: true, phase: 'player', events, roundEnded: true };
}

/**
 * 跨一轮：加时狂暴 → 回合数 +1 → 上限判定。
 *
 * @returns {boolean} true 表示已经打满 ARENA_MAX_TURNS，该按血量比例判和了
 */
function advanceRound(b) {
  // 加时狂暴：双方同幅度，谁也别想靠拖时间赢
  if (b.turn >= ENRAGE_TURN) {
    b.player.atk = Math.round(b.player.atk * (1 + ENRAGE_PCT));
    b.enemy.atk = Math.round(b.enemy.atk * (1 + ENRAGE_PCT));
  }
  b.turn++;

  if (b.turn > ARENA_MAX_TURNS) {
    b.phase = 'timeout';
    return true;
  }
  return false;
}

/**
 * 结算结果。
 *
 * 血量按赛制系数还原成快照里的真实数值 —— 结果页说"你剩 42 血"，
 * 就该是角色面板上那个 42，而不是被赛制放大过的 126。
 * phase='timeout'（打满 40 回合）按剩余生命比例判定。
 */
export function arenaResult(b) {
  let winner = b.winner;
  if (!winner) {
    const ra = b.player.hp / b.player.maxHp;
    const rb = b.enemy.hp / b.enemy.maxHp;
    winner = ra > rb ? 'p' : 'e';
  }
  return {
    win: winner === 'p',
    turns: Math.min(b.turn, ARENA_MAX_TURNS),
    playerHp: realHpOf(b.player),
    enemyHp: realHpOf(b.enemy),
    playerMaxHp: b.player.baseMaxHp,
    enemyMaxHp: b.enemy.baseMaxHp,
    playerFirst: b.playerFirst,
    log: b.log,
  };
}

/** 渲染快照：UI 只读这个，不碰内部结构 */
export function arenaBattleView(b) {
  const flat = (s) => ({
    id: s.id,
    name: s.name,
    classId: s.classId,
    level: s.level,
    hp: Math.max(0, s.hp),
    maxHp: s.maxHp,
    baseMaxHp: s.baseMaxHp,
    atk: s.atk,
    armor: s.armor,
    poison: s.poison,
    weakTurns: s.weakTurns,
    strength: s.strength,
    energy: s.energy,
    knowledge: s.knowledge,
    def: s.def,
    crit: s.crit,
    dodge: s.dodge,
    recovery: s.recovery,
    handCount: s.hand.length,
    /** 卡面折算要用（对手打出的牌也要显示"它会打多少"） */
    perk: s.perk,
  });

  return {
    turn: b.turn,
    phase: b.phase,
    playerFirst: b.playerFirst,
    player: { ...flat(b.player), perk: b.player.perk, racePerk: b.player.racePerk },
    enemy: flat(b.enemy),
    hand: b.player.hand.slice(),
    /** 已镶宝石（v3.91）：镜像战与 PvE 同一套规则，对方的宝石也要看得见 */
    gems: (b.player.gems || []).map((g) => ({ ...g, text: gemText(g) })),
    /** 卡面按职业天赋折算需要它（与战斗页同一个坑，见 battle.js） */
    perk: b.player.perk,
    drawCount: b.player.draw.length,
    discardCount: b.player.discard.length,
    exhaustCount: b.player.exhaust.length,
    skillsThisTurn: b.player.skillsThisTurn || 0,
    cardsThisTurn: b.player.cardsThisTurn || 0,
    attacksThisTurn: b.player.attacksThisTurn || 0,
    log: b.log.slice(),
  };
}

/**
 * 自动跑完一场（平衡工具 + 测试用）：双方都交给 AI。
 *
 * 和交互路径共用 createArenaBattle / arenaPlay / arenaEnemyStep，
 * 所以"模拟出来的胜率"就是"这套规则下的胜率"，不会两条路各算一套。
 */
export function simulateArena(playerChar, ghostChar, seed = 1, tuning = {}) {
  const b = createArenaBattle(playerChar, ghostChar, seed, tuning);

  let guard = 0;
  while ((b.phase === 'player' || b.phase === 'enemy') && guard++ < 800) {
    if (b.phase === 'player') {
      autoPlay(b.player, b.enemy, b);
      if (b.player.hp <= 0) { b.phase = 'lost'; b.winner = 'e'; break; }
      if (b.enemy.hp <= 0) { b.phase = 'won'; b.winner = 'p'; break; }
      arenaEndTurn(b);
    } else {
      arenaEnemyStep(b);
    }
  }

  return arenaResult(b);
}

/** 快速估算胜率（给平衡工具用） */
export function estimateWinRate(playerChar, ghostChar, samples = 5) {
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    if (simulateArena(playerChar, ghostChar, 1000 + i * 37).win) wins++;
  }
  return wins / samples;
}
