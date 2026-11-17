/**
 * 敌人模板、层数曲线、以及敌人的出牌计划
 *
 * 曲线全部是常量，调参只改这里。所有结论以 tools/balance.mjs 为准。
 *
 * v0.2 起敌人不再是「血条 + 意向骰子」，而是和玩家同构的构筑体：
 *   模板（基础系数 + 牌库） × 核心词条（固定，定身份） × 变异词条（随机，定变化）
 *
 * 关键平衡手段是 threatDamp：变异词条累加的威胁值会从基础 HP/ATK 里扣回来，
 * 保证「变异只改打法，不改难度」。否则带「迅捷 + 覆甲」的第 12 层会比第 20 层还难。
 */

import { CORE_TRAITS, MUTATIONS, rollMutations, threatOf } from './enemyTraits.js';
import { ENEMY_CARDS } from './enemyCards.js';

export const CURVE = {
  hpBase: 118,
  hpGrowth: 1.054,
  /**
   * 攻击力（v3.22 敌我同构）。
   *
   * 敌人和玩家用同一个 `atkMul`（每点攻击 +1%），所以这里是一个**属性**，
   * 不是"伤害倍率"。加成是线性的，要撑起 30 层的威胁曲线，这个属性就得跟着层数累加：
   * 第 1 层 4.5 点，第 30 层 4.5 + 6.9 × 29 ≈ 205 点。
   * 标定值，改之前先跑 tools/balance.mjs。
   *
   * v3.28「敌人调强一些」：hpGrowth 1.048 → 1.054、atkPerFloor 6 → 6.9。
   * 960 局总通关 62% → 51%（战 59 / 法 62 / 猎 38 / 旅 45），死亡集中 26-30 层。
   * 猎人/旅行家同步补血（176→205、148→158）保住职业极差 —— 难度不能靠砍死脆皮来换。
   */
  atkBase: 4.5,
  atkPerFloor: 6.9,

  eliteHpMul: 1.7,
  eliteDmgMul: 1.3,
  bossHpMul: 2.4,
  bossDmgMul: 1.6,

  /**
   * 敌人每回合的能量 / 抽牌 / 手牌上限。
   *
   * 和玩家**规则同构、数值不同**：一样是"抽牌 → 回能 → 打得起就打 → 打不起就结束回合"，
   * 但玩家有 8 能量是为了拼 combo，敌人只需要 5 点就能打出 3 张有压迫感的牌。
   *
   * v3.64：**取消"每回合最多出 2 张"**（用户：「根据费用抽到的实际牌可实际使用，
   * 跟玩家同样的机制」）。旧上限让敌人攥着能量不打，读起来像放水；现在能量是唯一
   * 约束，手牌上限 4 顺带兜住了上界 —— 敌人一回合最多也就甩 4 张。
   */
  enemyEnergy: 5,
  enemyDraw: 4,
  enemyHandLimit: 4,

  /** 每点威胁值折掉多少基础属性 */
  threatDamp: 0.55,

  /**
   * 敌人的 暴击 / 闪避 / 知识（v3.55，用户：「暴击，闪避，知识敌人也可以吃到」）。
   *
   * 这三项此前是玩家专属 —— 面板里只能显示 `—`。现在敌人也有，但**压得比玩家低
   * 一个量级**：敌人不建构、不吃装备，这三项对它是"随层数加压"，不是"成长方向"。
   * 换算成强度：
   *   暴击 每点 +1% 概率 ×1.5 倍伤害 → 第 30 层 12 点 ≈ 伤害 +6%
   *   闪避 每点 +1% 概率完全躲开一次 → 第 30 层 8 点 ≈ 玩家 8% 的牌打空
   *   知识 每点 +1% 它施加的虚弱回合数 → 第 16 层起「咆哮/缚网」从 2 回合变 3 回合
   * 精英 / 首领额外加成，保持"这一场更难"的直觉。
   */
  enemyCritPerFloor: 0.35,
  enemyCritCap: 12,
  enemyCritElite: 3,
  enemyCritBoss: 5,
  enemyDodgePerFloor: 0.25,
  enemyDodgeCap: 8,
  enemyDodgeElite: 1,
  enemyDodgeBoss: 2,
  enemyKnowledgeBase: 6,
  enemyKnowledgePerFloor: 1.2,

  /** 超过这个回合数，敌人每回合攻击 +15% —— 防止弱流派无限拖 */
  enrageTurn: 12,
  enragePct: 0.15,
};

/** 楼层节点类型 */
export const BOSS_FLOORS = [10, 20, 30];
export const ELITE_FLOORS = [5, 15, 25];
export const MAX_FLOOR = 30;

export function floorTier(floor) {
  if (BOSS_FLOORS.includes(floor)) return 'boss';
  if (ELITE_FLOORS.includes(floor)) return 'elite';
  return 'normal';
}

/**
 * 敌人模板。
 *   hpMul / atkMul  围绕 1.0 浮动
 *   deck            6 张起步的小牌库，决定它的出手节奏
 *   核心词条按 id 从 CORE_TRAITS 取
 */
export const ENEMY_POOL = [
  {
    id: 'slime', name: '腐泥', hpMul: 1.0, atkMul: 0.85,
    deck: ['e_strike', 'e_strike', 'e_guard', 'e_guard', 'e_split', 'e_split'],
  },
  {
    id: 'skeleton', name: '骸兵', hpMul: 0.9, atkMul: 1.05,
    deck: ['e_strike', 'e_strike', 'e_boneRattle', 'e_boneRattle', 'e_guard', 'e_slam'],
  },
  {
    id: 'wolf', name: '裂齿狼', hpMul: 0.8, atkMul: 1.2,
    deck: ['e_strike', 'e_strike', 'e_strike', 'e_pounce', 'e_pounce', 'e_flurry'],
  },
  {
    id: 'gargoyle', name: '石像鬼', hpMul: 1.25, atkMul: 0.9,
    deck: ['e_guard', 'e_guard', 'e_stoneSkin', 'e_stoneSkin', 'e_strike', 'e_slam'],
  },
  {
    id: 'spider', name: '织网蛛', hpMul: 0.85, atkMul: 1.0,
    deck: ['e_web', 'e_web', 'e_strike', 'e_strike', 'e_roar', 'e_flurry'],
  },
  {
    id: 'brute', name: '狂徒', hpMul: 1.15, atkMul: 1.1,
    deck: ['e_strike', 'e_strike', 'e_slam', 'e_slam', 'e_frenzy', 'e_flurry', 'e_strike'],
  },
  {
    id: 'wraith', name: '噬魂者', hpMul: 0.95, atkMul: 1.15,
    deck: ['e_bite', 'e_bite', 'e_drain', 'e_guard', 'e_strike', 'e_charge'],
  },
  {
    id: 'guardian', name: '铁卫', hpMul: 1.35, atkMul: 0.95,
    deck: ['e_bulwarkII', 'e_bulwarkII', 'e_guard', 'e_guard', 'e_strike', 'e_slam'],
  },
  {
    id: 'flame', name: '炎胎兽', hpMul: 1.0, atkMul: 1.25,
    deck: ['e_ember', 'e_ember', 'e_slam', 'e_strike', 'e_focus', 'e_strike'],
  },
  {
    id: 'shade', name: '暗影', hpMul: 0.75, atkMul: 1.3,
    deck: ['e_shadowStrike', 'e_shadowStrike', 'e_charge', 'e_strike', 'e_strike', 'e_flurry'],
  },
];

export const BOSS_POOL = [
  {
    id: 'boss_warden', name: '塔之守门人', hpMul: 1.0, atkMul: 1.0,
    deck: ['e_judge', 'e_judge', 'e_seal', 'e_seal', 'e_slam', 'e_guard', 'e_bulwark', 'e_strike'],
  },
  {
    id: 'boss_widow', name: '千眼寡母', hpMul: 0.95, atkMul: 1.05,
    deck: ['e_brood', 'e_brood', 'e_web', 'e_web', 'e_strike', 'e_strike', 'e_roar', 'e_flurry'],
  },
  {
    id: 'boss_ruin', name: '残塔之主', hpMul: 1.1, atkMul: 1.1,
    deck: ['e_collapse', 'e_collapse', 'e_slam', 'e_slam', 'e_flurry', 'e_guard', 'e_charge', 'e_strike'],
  },
];

/**
 * 生成一个敌人
 * @param {number} floor 1..30
 * @param {Rng} rng
 * @param {'normal'|'elite'|'boss'|null} tierOverride 迷宫层（v2.0）用：
 *   一层的敌人档位由**所在格子**决定，不再由层号唯一决定 ——
 *   第 5 层除了精英，还该有几只普通怪；第 10 层的普通格也不该变成首领。
 */
export function makeEnemy(floor, rng, tierOverride = null) {
  const tier = tierOverride || floorTier(floor);
  const isBoss = tier === 'boss';
  const pool = isBoss ? BOSS_POOL : ENEMY_POOL;
  // BOSS 固定按章节取，不随机，保证第 10/20/30 层的辨识度
  // （tierOverride 可能让非 BOSS 层出现首领，此时取第一章的模板兜底）
  const bossIdx = BOSS_FLOORS.indexOf(floor);
  const tpl = isBoss
    ? pool[(bossIdx < 0 ? 0 : bossIdx) % pool.length]
    : rng.pick(pool);

  const core = CORE_TRAITS[tpl.id];
  const mutationCount = tier === 'normal' ? 1 : 2;
  const mutationIds = rollMutations(core, mutationCount, rng);
  const mutations = mutationIds.map((id) => MUTATIONS[id]);
  const threat = threatOf(core, mutationIds);

  const baseHp = CURVE.hpBase * Math.pow(CURVE.hpGrowth, floor - 1);
  const baseAtk = CURVE.atkBase + CURVE.atkPerFloor * (floor - 1);

  const hpMul = tier === 'elite' ? CURVE.eliteHpMul : isBoss ? CURVE.bossHpMul : 1;
  /**
   * 精英/首领的"更疼"走伤害乘区，不再乘攻击力（v3.22）。
   * 线性模型下 atk ×1.6 只等于伤害 +18%（因为 atk 只是 (1+atk/100) 里的一项），
   * 那不叫首领。玩家侧同理：力量/暴击/宝物都是伤害乘区。
   */
  const dmgMul = tier === 'elite' ? CURVE.eliteDmgMul : isBoss ? CURVE.bossDmgMul : 1;

  // 词条越强，基础属性越低 —— 总威胁在每一层恒定
  const damp = Math.max(0.6, 1 - threat * CURVE.threatDamp);

  /**
   * 本体生命（v3.52）：不含精英/首领难度倍率的生命，也就是"这只怪自己有多大"。
   * 尖刺/荆棘的反弹按它取百分比 —— 难度倍率只该让这场更难，不该把反伤放大 2.4 倍。
   */
  const bodyHp = Math.max(1, Math.round(baseHp * tpl.hpMul * damp));
  const hp = Math.max(1, Math.round(baseHp * tpl.hpMul * hpMul * damp));
  const atk = Math.max(1, Math.round(baseAtk * tpl.atkMul * damp));

  const deck = tpl.deck.slice();
  if (tier === 'elite') deck.push('e_slam');

  /**
   * 三项"玩家属性"（v3.55）：暴击 / 闪避 / 知识。
   * 都随层数缓升、封顶，再加精英 / 首领的档位加成 —— 深层更凶，但永远到不了
   * 玩家的构筑上限（玩家能靠装备与卡牌把暴击堆到 60%）。
   */
  const tierCrit = isBoss ? CURVE.enemyCritBoss : tier === 'elite' ? CURVE.enemyCritElite : 0;
  const tierDodge = isBoss ? CURVE.enemyDodgeBoss : tier === 'elite' ? CURVE.enemyDodgeElite : 0;
  const crit = Math.min(CURVE.enemyCritCap, Math.round(floor * CURVE.enemyCritPerFloor) + tierCrit);
  const dodge = Math.min(CURVE.enemyDodgeCap, Math.round(floor * CURVE.enemyDodgePerFloor) + tierDodge);
  const knowledge = Math.round(CURVE.enemyKnowledgeBase + floor * CURVE.enemyKnowledgePerFloor);

  return {
    id: tpl.id,
    name: tpl.name,
    tier,
    floor,
    core,
    mutations,
    traits: [core, ...mutations],
    deck: rng.shuffle(deck),
    hand: [],
    draw: rng.shuffle(deck.slice()),
    discard: [],
    energy: 0,
    hp,
    maxHp: hp,
    baseHp: bodyHp,
    atk,
    baseAtk: atk,
    dmgMul,
    /**
     * 防御（v0.6）：只给精英 2 / BOSS 4，普通敌人 0。
     * v3.55 起暴击/闪避/知识也齐了（见上），四项属性敌我同构。
     */
    def: tier === 'boss' ? 4 : tier === 'elite' ? 2 : 0,
    /** v3.55：与玩家同一套属性的三项，结算见 combat.js */
    crit,
    dodge,
    knowledge,
    armor: 0,
    poison: 0,
    weakTurns: 0,
    keepPoison: false,
    turn: 0,
    enraged: 0,
    revived: false,
    charged: false,
    firstHitBonus: 0,
    hitThisTurn: 0,
  };
}

/* ------------------------------------------------------------------ *
 * 敌人抽牌与出牌决策
 * ------------------------------------------------------------------ */

/** 敌人每回合的能量（迅捷词条会加） */
export function enemyEnergyOf(e) {
  let n = e.energyCap ?? CURVE.enemyEnergy;
  for (const t of e.traits) if (t.kind === 'swift') n += t.value;
  return n;
}

/** 抽下回合的手牌。抽完洗回，和玩家同一套逻辑。 */
export function drawEnemyHand(e, rng) {
  e.discard.push(...e.hand);
  e.hand = [];
  const n = e.drawCount ?? CURVE.enemyDraw;
  const cap = e.handLimit ?? CURVE.enemyHandLimit;
  for (let i = 0; i < n; i++) {
    if (e.hand.length >= cap) break;
    if (!e.draw.length) {
      if (!e.discard.length) break;
      e.draw = rng.shuffle(e.discard);
      e.discard = [];
    }
    e.hand.push(e.draw.pop());
  }
}

/** 单张牌的威胁评分（用于决定先出哪张） */
function cardScore(c, e) {
  let s = 0;
  if (c.dmg != null) s += c.dmg * (c.hits || 1) * 10;
  if (c.block != null) s += c.block * 6;
  if (c.heal != null) s += c.heal * 260;
  if (c.weak != null) s += c.weak * 4;
  if (c.drainEnergy != null) s += c.drainEnergy * 5;
  if (c.charge != null) s += 9;
  if (c.strength != null) s += c.strength * 16;
  if (c.purge) s += 3;
  return s / c.cost;
}

/**
 * 从手牌里挑一张「现在买得起、且每点能量价值最高」的牌。
 *
 * 返回 null = 这回合打不出东西了（没牌 / 能量不足），敌人就此结束回合。
 *
 * v1.0 起决策是**当场**做的，不再预演：既然玩家看不到意图，
 * 就不需要"提前算好、之后照着执行"那套，也消灭了"预告与实际不一致"的可能。
 */
export function pickEnemyCard(e, rng) {
  let best = null;
  for (let i = 0; i < e.hand.length; i++) {
    const id = e.hand[i];
    const c = ENEMY_CARDS[id];
    if (!c || c.cost > e.energy) continue;
    // 轻微随机：避免同一个敌人每回合都打同一张，行为太机械
    const score = cardScore(c, e) * (0.85 + rng.next() * 0.3);
    if (!best || score > best.score) best = { index: i, id, cost: c.cost, score };
  }
  return best;
}
