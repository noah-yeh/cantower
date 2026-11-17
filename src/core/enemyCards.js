/**
 * 敌人行动牌
 *
 * 和玩家卡牌是同一套思路，但窄得多：只有 9 种效果，每种都能用现有战斗状态表达。
 * 不引入玩家侧没有的系统（中毒、弃牌堆污染等），否则战斗规则会分叉成两套。
 *
 * 所有倍率都是「× 一次挥击的威力」，而一次挥击的威力由 `enemyHit(atk)` 给 ——
 * 它和玩家侧走的是同一个 `atkMul`（每点攻击 +1%），只是乘了一个牌面缩放系数。
 * 所以文案必须由 enemyCardText(id, atk) 现算，禁止写死数字。
 *
 * 效果字段：
 *   dmg          伤害倍率（× enemyHit）
 *   hits         段数，默认 1
 *   block        自身护甲（× enemyHit）
 *   heal         自愈（× 最大生命）
 *   weak         给玩家施加虚弱回合数（玩家伤害 -25%）
 *   drainEnergy  玩家下回合能量 -N
 *   charge       下张攻击牌伤害 ×倍率
 *   strength     自身**伤害**永久 +比例（v3.22 起不再改攻击力）
 *   purge        true = 清除自身中毒与虚弱
 */

import { atkMul } from './leveling.js';

/**
 * 敌人牌面系数相对玩家的缩放（v3.22，v3.26 随基准搬家重算）。
 *
 * 敌人每回合白拿 5 能量、出 2 张牌，没有构筑与抽牌成本，所以它的"牌"本来就该更弱。
 * 这个常数只做**数据缩放**，不改变规则 —— 双方用的都是
 * `伤害 = 卡牌基础伤害 × atkMul(攻击力)`，同一个公式、同一个每点 +1% 的口径。
 *
 * v3.26：atkMul 不再含 13 的基准（改由卡牌数据自带基础伤害），
 * 所以这里要补回那个 13 —— 0.28 × 13 = 3.64，敌人输出与 v3.25 完全一致。
 */
export const ENEMY_CARD_SCALE = 3.64;

/** 敌人「系数 1.0」的一张牌能打多疼 —— 敌我同构公式 × 敌人牌面缩放 */
export function enemyHit(atk) {
  return ENEMY_CARD_SCALE * atkMul(atk);
}

export const ENEMY_CARDS = {
  /* ---------------- 通用 ---------------- */
  e_strike: { name: '挥击', cost: 1, dmg: 1.0 },
  e_guard: { name: '架势', cost: 1, block: 1.0 },
  e_slam: { name: '重砸', cost: 2, dmg: 1.75 },
  e_flurry: { name: '连击', cost: 2, dmg: 0.45, hits: 3 },
  e_roar: { name: '咆哮', cost: 1, weak: 2 },
  e_charge: { name: '蓄势', cost: 1, charge: 2.2 },
  e_bite: { name: '撕咬', cost: 1, dmg: 0.85, heal: 0.03 },
  e_focus: { name: '凝聚', cost: 1, strength: 0.25 },
  e_bulwark: { name: '铁壁', cost: 2, block: 1.9 },

  /* ---------------- 模板专属 ---------------- */
  e_split: { name: '分裂', cost: 1, block: 0.9, heal: 0.02 },
  e_boneRattle: { name: '骨鸣', cost: 1, dmg: 0.9, block: 0.6 },
  e_pounce: { name: '扑击', cost: 2, dmg: 1.9 },
  e_stoneSkin: { name: '石肤', cost: 1, block: 1.7 },
  e_web: { name: '缚网', cost: 1, weak: 2, drainEnergy: 1 },
  e_frenzy: { name: '狂乱', cost: 1, strength: 0.3 },
  e_drain: { name: '汲取', cost: 2, dmg: 1.3, heal: 0.06 },
  e_bulwarkII: { name: '壁垒', cost: 1, block: 1.8 },
  e_ember: { name: '余烬', cost: 1, dmg: 1.1, strength: 0.15 },
  e_shadowStrike: { name: '影袭', cost: 2, dmg: 2.0 },

  /* ---------------- 首领专属 ---------------- */
  e_judge: { name: '审判', cost: 2, dmg: 2.2 },
  e_seal: { name: '封印', cost: 1, weak: 2, drainEnergy: 1 },
  e_brood: { name: '唤子', cost: 2, dmg: 0.55, hits: 3 },
  e_collapse: { name: '崩塌', cost: 3, dmg: 3.0 },
};

export const ALL_ENEMY_CARD_IDS = Object.keys(ENEMY_CARDS);

/* ------------------------------------------------------------------ *
 * 文案 —— 唯一来源
 * ------------------------------------------------------------------ */

const pct = (v) => `${Math.round(v * 100)}%`;

export function enemyCardText(id, atk = 10, maxHp = 100) {
  const c = ENEMY_CARDS[id];
  if (!c) return '';
  const parts = [];
  const val = (ratio) => Math.max(1, Math.round(ratio * enemyHit(atk)));

  if (c.dmg != null) {
    let s = `造成 ${val(c.dmg)} 伤害`;
    if (c.hits > 1) s = `造成 ${val(c.dmg)}×${c.hits} 伤害`;
    parts.push(s);
  }
  if (c.block != null) parts.push(`获得 ${val(c.block)} 护甲`);
  if (c.heal != null) parts.push(`回复 ${Math.max(1, Math.round(c.heal * maxHp))} 生命`);
  if (c.weak != null) parts.push(`你虚弱 ${c.weak} 回合`);
  if (c.drainEnergy != null) parts.push(`你下回合 -${c.drainEnergy} 能量`);
  if (c.charge != null) parts.push(`蓄势：下张攻击 ×${c.charge}`);
  if (c.strength != null) parts.push(`自身伤害 +${pct(c.strength)}`);
  if (c.purge) parts.push('清除自身负面');
  return parts.join('，');
}

/** 完整行动牌视图（UI / 意图预告都用这个） */
export function enemyCardView(id, atk = 10, maxHp = 100) {
  const c = ENEMY_CARDS[id];
  if (!c) return null;
  return { id, ...c, text: enemyCardText(id, atk, maxHp) };
}
