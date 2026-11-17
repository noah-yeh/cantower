/**
 * 机器人策略 —— balance.mjs 与 trace.mjs 共用
 *
 * 这不是"最优解"，是"中等水平玩家的下限估计"。
 * 它的价值在于可复现、可批量，能暴露"某职业必死"这类结构性问题。
 */

import { CARDS, cardOf, parseCard } from '../src/core/cards.js';
import { CLASSES } from '../src/core/characters.js';
import { atkMul } from '../src/core/leveling.js';
import { relicValue, relicChain, relicLvOf } from '../src/core/relics.js';
import {
  createRun, play, pass, applyReward, leaveShop, triggerCell, stepCell, chooseUpgradeCard, acceptQuest,
  cancelRunAltar,
} from '../src/core/run.js';
import { canReveal } from '../src/core/dungeon.js';
import { buyShopCard, buyShopRelic } from '../src/core/shop.js';
import { createCharacter } from '../src/core/roster.js';

/**
 * 卡牌数值的**系数口径**副本（v3.26）。
 *
 * v3.26 起 `CARDS.x.dmg` 存的是「基础伤害」（= 旧系数 × 13），而机器人的估值权重
 * （×6 / ×4 / ×2.5 …）全都是按旧系数标定的。不换算回去，一张牌的静态估值会凭空
 * ×13，牌比宝物值钱十几倍 —— 实测机器人卡组 25.7 → 32.8 张、宝物 6.6 → 3.0 个，
 * 总通关 60% → 40%。这不是游戏变难了，是模拟里的 AI 变傻了。
 */
/**
 * 卡牌数值 → "系数口径" 的除数（AI 权重是按系数标定的）。
 * v3.29 卡牌主数值整体 ×0.85，所以 1 个系数单位对应的点数从 13 变成 13 × 0.85。
 * **改卡牌量级时必须同步改这里**，否则 AI 会对卡牌系统性高估/低估（v3.26 的 62%→39% 就是这么来的）。
 */
const COEFF_SCALE = 13 * 0.85;
const COEFF_FIELDS = [
  'dmg', 'block', 'heal', 'perCopy', 'perAttack', 'perSkill', 'perCard',
  'dmgPerArmor', 'consumeArmorMul', 'dmgPerPoison', 'poisonBurst', 'energyBurst',
  'cleanseBlock', 'unplayedArmor',
];
function coeffStats(c) {
  const out = { ...c };
  for (const f of COEFF_FIELDS) if (typeof out[f] === 'number') out[f] /= COEFF_SCALE;
  return out;
}

/**
 * 手牌里的"兑现意图"（v3.15）。
 *
 * 机器人是贪心打法的：如果只按单卡价值算，它永远不会为了 combo 去铺垫
 * （「举盾」当回合就是不如「重击」疼）。于是模拟出来的战绩是"不懂套路的玩家"，
 * 这类牌的价值会被系统性低估。
 *
 * 这里给一个轻量的前瞻：手里有兑现牌时，对应的铺垫牌临时涨价。
 * 这不是最优解搜索，只是让机器人"知道自己在攒什么"。
 */
function handPlan(b) {
  const plan = { armor: 0, poison: 0, weak: 0, skills: 0 };
  for (const id of b.hand) {
    const c = cardOf(id);
    if (!c) continue;
    if (c.dmgPerArmor != null || c.consumeArmorMul != null) plan.armor++;
    if (c.poisonBurst != null) plan.poison++;
    if (c.ifWeakMul != null) plan.weak++;
    if (c.perSkill != null) plan.skills++;
  }
  return plan;
}

/**
 * 宝石估值（v3.91）。
 *
 * 宝石是"镶上去本场一直生效"的牌，收益取决于**还剩几回合**。机器人按
 * "平均还能打 2 回合"折成静态分 —— 估太低就永远不镶（整类牌在模拟里等于不存在），
 * 估太高会把它当伤害牌无脑优先（其实是让出一回合节奏）。
 * 每一项的权重与 scoreCard 里的同类项对齐：护甲 × atk、毒 × 层、能量 × 4.5 的 2 倍。
 */
function gemScore(g, atk = 1.1) {
  if (!g) return 0;
  let s = 0;
  if (g.atkBonus) s += g.atkBonus * 60;
  if (g.armorPerTurn) s += g.armorPerTurn * atk * 1.2;
  if (g.poisonBonus) s += g.poisonBonus * 3.2;
  if (g.energyPerTurn) s += g.energyPerTurn * 9;
  if (g.critBonus) s += g.critBonus * 0.9;
  return s;
}

export function scoreCard(b, id) {
  const c = cardOf(id);
  /** v3.21：攻击力线性模型，估值必须与 combat 同口径 */
  const atk = atkMul(b.player.atk + b.player.strength);
  const hpRatio = b.player.hp / b.player.maxHp;
  const plan = handPlan(b);

  /** 状态牌（v2.1）：伤口不可打出，永远不选。负分防止它挤进任何回退分支 */
  if (c.unplayable) return -100;

  let s = 0;

  if (c.dmg != null) {
    let d = c.dmg * atk * (c.hits || 1);
    if (c.exec != null && b.enemy.hp / b.enemy.maxHp < c.exec) d *= 2;
    if (c.pierce) d *= 1.1;
    if (c.scaleArmor != null) d *= 1 + b.player.armor * c.scaleArmor;
    /** v3.15 连携兑现：不估进来机器人就永远看不到这些牌的价值，模拟会系统性低估 */
    if (c.dmgPerArmor != null) d += b.player.armor * c.dmgPerArmor * atk;
    if (c.consumeArmorMul != null) d += b.player.armor * c.consumeArmorMul * atk;
    if (c.poisonBurst != null) d += b.enemy.poison * c.poisonBurst * atk;
    if (c.energyBurst != null) d += b.player.energy * c.energyBurst * atk;
    if (c.perSkill != null) d += (b.skillsThisTurn || 0) * c.perSkill * atk;
    if (c.perCard != null) d += (b.cardsThisTurn || 0) * c.perCard * atk;
    if (c.ifWeakMul != null && b.enemy.weakTurns > 0) d *= c.ifWeakMul;
    if (c.dmgPerPoison != null) d += b.enemy.poison * c.dmgPerPoison * atk;
    /** 连击（v2.1）：按本回合已打出的攻击牌数估算额外伤害（封顶 4，防狂热估值） */
    if (c.perAttack != null) d += Math.min(b.attacksThisTurn || 0, 4) * c.perAttack * atk;
    s += d;
  }
  if (c.block != null) s += c.block * atk * (hpRatio < 0.4 ? 1.1 : 0.7);
  if (c.heal != null) s += c.heal * atk * (hpRatio < 0.5 ? 1.8 : 0.5);
  if (c.poison != null) s += c.poison * 2.4;
  /**
   * 放大中毒：收益 = 当前毒层 × 放大比例。
   * 之前写死 `poison * 0.9`，跟卡面上的 0.5 / 0.6 / 0.8 完全无关 ——
   * 于是机器人会拿「绽放」当"上毒牌"用（看中它自带的 3 层毒），把放大浪费在毒很少的时候。
   */
  if (c.amplifyPoison != null) {
    /**
     * 放大毒的收益 = 当前毒层 × 放大比例 × **一层毒真正值多少伤害**。
     * 这里的参照量是「一张牌的平均伤害」，v3.26 起 atkMul 只返回百分比（1.x），
     * 所以要乘回 COEFF_SCALE 才等价于旧口径的 13×；否则这项会缩小 13 倍，
     * 机器人再也不拿「扩散 / 绽放 / 沼泽」，旅行家被系统性低估。
     */
    s += b.enemy.poison * c.amplifyPoison * atk * COEFF_SCALE * 1.1;
  }
  if (c.draw != null) s += c.draw * 4.5;
  if (c.energy != null) s += c.energy * 4.5;
  if (c.strength != null) s += c.strength * 3.2;
  if (c.weak != null) s += c.weak * 3.5;
  if (c.keepPoison) s += 7;
  /**
   * 反伤（v1.6 补）：之前漏了这一项，于是「反击 / 堡垒 / 铁蒺藜 / 盾墙」
   * 在模拟里全是 0 分 —— 机器人永远不会打，测出来的战士强度被系统性低估。
   * 估价 = 固定底价 + 已有护甲的一点加成（护甲越厚，反伤越疼）。
   */
  if (c.thorns != null) s += c.thorns * 32 + c.thorns * (b.player.armor || 0) * 0.4;
  /** 宝石（v3.91）：不镶就是废牌，必须给正分 */
  if (c.gem) s += gemScore(c.gem, atk);

  /**
   * 消耗护甲（v1.6 补）：护甲是战士的弹药，也是他的血。
   * 之前这里没有扣分，机器人会把 40 点护甲一次性换成几十点伤害，
   * 下一回合就赤身挨打 —— 加了「撞击 / 甲碎」这类牌之后这个漏洞开始系统性低估战士。
   */
  /** v3.15 下调：碎甲牌现在能把护甲按点数换成伤害，按 0.6 扣会把它们全判成负收益 */
  if (c.consumeArmor && b.player.armor > 0) s -= b.player.armor * 0.55;

  /**
   * 连携门槛（v3.15）—— 兑现牌没攒够时打出去等于扔资源。
   *
   * 这是机器人必须补的一条，否则模拟出来的不是"会用套路的玩家"而是"看到新牌就乱打"：
   * 例如「毒爆」在毒层 0 时打掉，既没伤害还把后面几回合的毒伤一起清了。
   * 扣分档位按"这张牌裸打值多少"来给，不影响它在条件满足后的正常竞争。
   */
  if (c.combo) {
    if (c.poisonBurst != null && b.enemy.poison < 6) s -= 24;
    if (c.dmgPerArmor != null && b.player.armor < 10) s -= 16;
    if (c.consumeArmorMul != null && b.player.armor < 12) s -= 24;
    if (c.perSkill != null && (b.skillsThisTurn || 0) < 1) s -= 12;
    if (c.perCard != null && (b.cardsThisTurn || 0) < 2) s -= 12;
    if (c.ifWeakMul != null && b.enemy.weakTurns === 0) s -= 14;
  }

  /* v2.1：代价类字段必须有扣分，否则机器人会把「孤注一掷」当免费重击无脑连打 */
  if (c.costHp != null) {
    const lost = Math.max(1, Math.round(b.player.maxHp * c.costHp));
    s -= lost * (hpRatio < 0.35 ? 3 : 1.2);
  }
  if (c.energyPenalty != null) s -= c.energyPenalty * 6;
  if (c.discardRandom != null) s -= c.discardRandom * 5;
  /** 净化：手牌里有几张伤口就值几份甲（额外于基础 block 的部分） */
  if (c.cleanseBlock != null) {
    const wounds = b.hand.filter((k) => cardOf(k)?.unplayable).length;
    s += wounds * c.cleanseBlock * atk * 0.8;
  }

  return s;
}

/** 打完一个回合（能出就出，出不动就过） */
export function autoTurn(run) {
  const b = run.battle;
  let guard = 0;
  while (b.phase === 'player' && guard++ < 25) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < b.hand.length; i++) {
      const id = b.hand[i];
      const c = cardOf(id);
      if (!c || c.cost > b.player.energy) continue;
      const score = scoreCard(b, id);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) break;
    play(run, best);
  }
  if (run.phase === 'battle' && run.battle?.phase === 'player') pass(run);
}

/**
 * 一张卡的静态估值（不看当前战场）—— 奖励页和商店共用同一套尺子。
 *
 * 厚度惩罚（v1.3）：卡组没有上限之后，"再拿一张"不再免费。每回合只抽 5 张，
 * 30 张的卡组抽到某张关键牌的概率只有 20 张时的 2/3。不加这一项，
 * 机器人会一路贪到 39 张，模拟出的通关率就不是玩家能打出来的。
 */
export function cardValue(run, id) {
  const base = CARDS[id];
  if (!base) return 0;
  if (base.unplayable) return 0; // 状态牌永不进奖励/商店（双重保险）
  /** v3.26：下面的权重按旧系数标定，先把基础伤害换回系数口径 */
  const c = coeffStats(base);
  let v = 8;
  /**
   * 毒的估值要分职业（v2.2）。
   *
   * 以前池子里毒牌只有旅行家在拿，1.2/层的高估没关系 —— 旅行家本来就有
   * poisonAmp/放大/不衰减一整套协同，毒牌实际就是值这个价。v2.2 种族卡池
   * 把攻击+毒的「怒放」递到了法师面前，机器人按老价拿了一路（40 局拿了
   * 36 张），法师通关率 41%→34%。法师的毒层数没有放大器，衰减得也快，
   * 实际收益大约只有协同流的一半。
   */
  const poisonW = CLASSES[run.classId]?.perk?.poisonAmp ? 1.2 : 0.7;
  if (c.dmg != null) v += c.dmg * (c.hits || 1) * 6;
  if (c.perAttack != null) v += c.perAttack * 8; // 条件伤害按“平均能吃 1 层”估
  /**
   * v3.15 兑现牌：静态估值按"平均能吃 2~3 层铺垫"折中，不能按满层估
   * （牌组里不一定凑得齐），也不能按 0 估（那样永远不会拿）。
   */
  if (c.dmgPerArmor != null) v += c.dmgPerArmor * 20 * 2;
  if (c.consumeArmorMul != null) v += c.consumeArmorMul * 20 * 2;
  if (c.poisonBurst != null) v += c.poisonBurst * 6 * 2;
  if (c.energyBurst != null) v += c.energyBurst * 4 * 2;
  if (c.perSkill != null) v += c.perSkill * 2 * 2;
  if (c.perCard != null) v += c.perCard * 3 * 2;
  if (c.ifWeakMul != null) v += (c.ifWeakMul - 1) * 6;
  /**
   * v3.18 机制套路化：
   * 鏖战 —— 期望本场多打 ~2 次，每次 ×growMul×本体伤害，折成静态分；
   * 收势 —— 自动收益（回合结束不用决策），按"平均 2~3 张未打出"估一笔常数；
   * 同袍 —— 按牌组里**现有**同名牌数估（真人也是这么判断"我拿几张了"）。
   */
  if (c.growMul != null) v += c.growMul * 2 * c.dmg * 6;
  if (c.unplayedArmor != null) v += c.unplayedArmor * 2.5 * 10 * 0.5;
  if (c.unplayedPoison != null) v += c.unplayedPoison * 2.5 * poisonW;
  if (c.perCopy != null) {
    const copies = run.deck.filter((k) => k.split('+')[0] === id).length;
    v += c.perCopy * copies * 6;
  }
  if (c.block != null) v += c.block * 4;
  if (c.cleanseBlock != null) v += 2; // 只在被污染后才有价值，静态估值压低
  if (c.poison != null) v += c.poison * poisonW;
  if (c.strength != null) v += c.strength * 2;
  if (c.draw != null) v += c.draw * 2;
  if (c.energy != null) v += c.energy * 2;
  if (c.keepPoison || c.amplifyPoison != null) v += 8;
  /* v2.2 补盲区：这三类字段以前不在池子估值里，种族卡把它们带进来了 */
  if (c.heal != null) v += c.heal * 2.5;
  if (c.thorns != null) v += c.thorns * 6; // 需要护甲配合，比战斗内估值保守
  if (c.exec != null) v += 2; // 收割窗口不是每场都有，给个保守常数
  /** 宝石（v3.91）：静态估值与战斗内估值同一套权重，略打折（要占 1 费） */
  if (c.gem) v += gemScore(c.gem) * 0.9;
  /** 代价类：奖励页也扣分 —— 有代价的强牌不该无脑拿 */
  if (c.costHp != null) v -= Math.max(1, Math.round((run.player.maxHp || 100) * c.costHp)) * 0.8;
  if (c.energyPenalty != null) v -= c.energyPenalty * 2.5;
  if (c.discardRandom != null) v -= c.discardRandom * 2;
  v -= Math.max(0, run.deck.length - 16) * 0.4;
  return v;
}

export function scoreReward(run, opt) {
  const hpRatio = run.player.hp / run.player.maxHp;

  switch (opt.kind) {
    case 'heal':
      return hpRatio < 0.45 ? 120 : hpRatio < 0.7 ? 40 : 6;

    case 'stat': {
      if (opt.id === 'power') return 18;
      if (opt.id === 'vitality') return hpRatio < 0.5 ? 22 : 15;
      return 5;
    }

    case 'relic': {
      /** v3.12：等级也算价值 —— 5 级的护腕当然比 1 级值钱 */
      let v = relicValue(opt.id, opt.lv || 1);
      const chain = relicChain(opt.id);
      if (chain !== 'X') {
        const same = run.relics.filter((r) => relicChain(r) === chain).length;
        v += same * 4;
      }
      /** 已经有的再抽到只是升一级，没有"从无到有"那一步，估值得打折 */
      if (relicLvOf(run.relics, opt.id) > 0) v *= 0.7;
      return v + 6;
    }

    case 'card':
      return cardValue(run, opt.id);

    /**
     * 强化（v2.2 祭坛化）：选项不再带具体卡，id 恒为 'altar'。
     * 估值 = 卡组里最值的那张卡的强化收益（自选目标，机器人也自选最好的那张）。
     * 跟"再拿一张同样的卡"同档，但不增加卡组厚度 —— 卡组越厚越值钱。
     */
    case 'upgrade': {
      let best = 0;
      for (const key of run.deck) {
        const p = parseCard(key);
        const c = CARDS[p.id];
        if (!c || p.lv >= 3) continue;
        let v = 10;
        if (c.dmg != null) v += c.dmg * 6;
        if (c.block != null) v += c.block * 4;
        if (c.poison != null) v += c.poison * 1.2;
        if (c.strength != null) v += c.strength * 2;
        v += (p.lv + 1) * 2;
        if (v > best) best = v;
      }
      return best;
    }

    case 'material':
      return run.materials < 3 ? 6 : 2;

    default:
      return 0;
  }
}

export function autoReward(run) {
  if (run.phase !== 'reward' || !run.reward) return -1;
  let best = 0;
  let bestScore = -Infinity;
  run.reward.options.forEach((o, i) => {
    const s = scoreReward(run, o);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  const opt = run.reward.options[best];
  applyReward(run, best);
  /** v2.2：选了祭坛会进 phase='upgrade'，顺手把目标也选了 */
  if (run.phase === 'upgrade') autoUpgrade(run);
  return { index: best, option: opt };
}

/**
 * 强化祭坛（v2.2）：选强化收益最高的那张。
 * 评分与 scoreReward 的 upgrade 分支同口径（每字段的主价值 × 满级步数）。
 */
export function autoUpgrade(run) {
  if (run.phase !== 'upgrade' || !run.upgradeTargets?.length) return;
  let bestKey = run.upgradeTargets[0];
  let bestV = -Infinity;
  for (const key of run.upgradeTargets) {
    const p = parseCard(key);
    const raw = CARDS[p.id];
    if (!raw) continue;
    /** v3.26：与 cardValue 同一口径 —— 先把基础伤害换回系数 */
    const c = coeffStats(raw);
    let v = 10;
    if (c.dmg != null) v += c.dmg * 6;
    if (c.block != null) v += c.block * 4;
    if (c.poison != null) v += c.poison * 1.2;
    if (c.strength != null) v += c.strength * 2;
    v += (p.lv + 1) * 2;
    if (v > bestV) { bestV = v; bestKey = key; }
  }
  chooseUpgradeCard(run, bestKey);
}

/**
 * 行商（v1.8）
 *
 * 两条硬规则，都是为了不让机器人用模拟里不存在的"完美经济"骗高通关率：
 *   1. 材料先保种族槽位 —— 槽里还有未激活宝物时，至少留 3 个激活费；
 *   2. 卡组超过 24 张就不再买牌 —— 商店的牌和奖励牌一样会稀释卡组。
 * 买牌最多一张：金币本来就只够几张，分散买不如补最缺的那张。
 */
export function autoShop(run) {
  if (run.phase !== 'shop' || !run.shop) return;

  run.shop.relics.forEach((it, i) => {
    if (it.sold) return;
    const keep = run.relicSlots?.length ? 3 : 0;
    if (run.materials >= it.price + keep) buyShopRelic(run, i);
  });

  if (run.deck.length < 24) {
    const cands = run.shop.cards
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => !it.sold && run.gold >= it.price)
      .map((c) => ({ ...c, value: cardValue(run, c.it.id) - c.it.price * 0.06 }))
      .sort((a, b) => b.value - a.value);
    if (cands.length && cands[0].value > 10) buyShopCard(run, cands[0].i);
  }

  leaveShop(run);
}

/**
 * 迷宫层策略（v2.0）
 *
 * 优先级：已翻开的敌人 → 宝箱 → 事件 → 行商 → 空房间 → 楼梯（只能清光后走）
 *        → 翻一个新的可翻格。
 *
 * 敌人排第一是硬规则：这一层不下完所有敌人就上不了楼，
 * 先打还能早点知道自己这层扛不扛得住（血量撑不住就说明后面的格子要绕着翻）。
 */
export function autoMap(run) {
  if (run.phase !== 'map' || !run.floorMap) return;
  const m = run.floorMap;
  const pending = (kind) => m.cells.findIndex((c) => c.revealed && !c.done && c.kind === kind);

  /**
   * 行商与付费祭坛的格子**离开后仍然不 done** —— 这是给玩家的设计（可以回头再进）。
   * 机器人不需要回头：进门前先标成已处理，否则会在"进店 → 离店 → 再进店"
   * 里无限循环，整局卡在第一层（v3.91 排查 0% 通关率时发现的第二个坑）。
   */
  const onceOnly = (cell) => {
    const isAltar = cell.kind === 'event' && ['pyre', 'morph'].includes(cell.data?.event);
    return cell.kind === 'shop' || cell.kind === 'relicShop' || isAltar;
  };

  for (const kind of ['enemy', 'treasure', 'event', 'shop', 'relicShop', 'empty']) {
    const i = pending(kind);
    if (i >= 0) {
      if (onceOnly(m.cells[i])) m.cells[i].done = true;
      triggerCell(run, i);
      return;
    }
  }

  /**
   * 迷雾（v3.14 重新打开）：还有暗格就先翻。
   *
   * 顺序刻意放在"下楼"之前 —— 一层只有 9 格，翻完的成本是 9 次点击，
   * 但跳过的空格里可能躺着宝箱或楼梯。机器人按"每层都搜干净"打，
   * 这正是普通玩家的实际行为；如果让它找到楼梯就下楼，模拟出来的是
   * 一个"半途而废的玩家"，基线会被低估（v3.12 就踩过这个坑）。
   *
   * stepCell = 翻开并当场结算（一段式），和 UI 走同一条路径。
   */
  for (let i = 0; i < m.cells.length; i++) {
    if (canReveal(m, i)) {
      stepCell(run, i);
      /** 翻出来正好是店 / 祭坛：和上面同一条理由，标掉别再进 */
      if (onceOnly(m.cells[i])) m.cells[i].done = true;
      return;
    }
  }

  /** 格子翻完了，敌人也清光了，才下楼 */
  if (m.enemiesLeft === 0) {
    const i = pending('stairs');
    if (i >= 0) {
      triggerCell(run, i);
      return;
    }
  }
}

/** 跑完整一局 */
export function runOne(classId, raceId, seed) {
  // 走"真实招募"路径：卡组是随机 4 张职业牌 + 种族卡，和玩家实际拿到的一致。
  // 用固定起始卡组会高估（或低估）强度，基准就不再是基准。
  const character = createCharacter({ classId, raceId, seed });
  const run = createRun({ character, seed });
  let totalTurns = 0;
  let steps = 0;
  /** v3.13：统计进了几次店，用来核对"古币花不花得掉" */
  let shops = 0;

  while (['map', 'battle', 'reward', 'shop', 'upgrade', 'quest'].includes(run.phase)) {
    if (steps++ > 12000) break;

    if (run.phase === 'map') { autoMap(run); continue; }
    if (run.phase === 'shop') { autoShop(run); shops++; continue; }
    if (run.phase === 'reward') { autoReward(run); continue; }
    /** v2.2：铁匠事件也会进祭坛，主循环必须认这个相位 */
    if (run.phase === 'upgrade') { autoUpgrade(run); continue; }
    /**
     * 付费祭坛（v3.37 焚卡 / 变形）—— **v3.91 补**。
     *
     * 这个相位当时没进主循环，机器人一碰到祭坛格子就退出循环、整局被记成
     * "死在第 1~2 层"：`balance.mjs 20` 跑出来 320 局 0% 通关、中位层数 2，
     * 一直没人核对。祭坛是可选的资源出口（花古币删牌/变牌），
     * 机器人一律**不花**（直接离开），保持与历史基线可比 —— 它省下的古币
     * 会体现在 goldLeft 上，不影响打法。
     */
    if (run.phase === 'remove' || run.phase === 'morph') { cancelRunAltar(run); continue; }
    /** v3.85：委托板（接受/婉拒）—— 机器人一律接受，天赋不要白不要 */
    if (run.phase === 'quest') { acceptQuest(run); continue; }
    const before = run.battle.turn;
    autoTurn(run);
    totalTurns += Math.max(1, (run.battle?.turn ?? before) - before);
  }

  /**
   * 粗估时长（v2.0 重算）：每回合 11 秒、每次三选一 15 秒，
   * 另外一层要翻十来个格子、点两次才生效 —— 每层再加 20 秒。
   * 注意用 run.stats.turns：战斗结束后 run.battle 会被清空，在循环里数 turn 会全部记成 1
   */
  const turns = run.stats.turns || totalTurns;
  const minutes = (turns * 11 + run.stats.kills * 15 + run.stats.floorsCleared * 20) / 60;
  const fights = Math.max(1, run.stats.kills);

  return {
    classId,
    raceId,
    floor: run.stats.floorsCleared + (run.phase === 'won' ? 1 : 0),
    won: run.phase === 'won',
    turns,
    turnsPerFight: turns / fights,
    minutes,
    deckSize: run.deck.length,
    relics: run.relics.length,
    atk: run.player.atk,
    kills: run.stats.kills,
    /** 结余（v3.13 诊断用）：古币溢不溢出，看这两个数就知道 */
    goldLeft: run.gold || 0,
    materialsLeft: run.materials || 0,
    shops,
    /** 最终卡组（v3.15 诊断用）：看连携牌到底有没有真的进构筑 */
    deck: run.deck.slice(),
  };
}
