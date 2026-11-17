/**
 * 升级与经验 —— v0.5
 *
 * 规则来源（用户口述）：
 *   「升级不加其他属性，是根据 4 种不同职业加不同属性：
 *     战士升一级加 5 生命，法师加知识，猎人加 2 攻击力，旅行者加 2 幸运」
 *
 * 三条不可动摇的设计约束：
 *   1. **每级只加一项**，且该项由职业决定，玩家没有选择权。
 *      成长是"职业身份"，不是"自由加点" —— 这跟三选一的构筑选择是两条不同的线。
 *   2. **属性成长不走三选一**。三选一只出卡牌 / 宝物 / 治疗；
 *      属性靠两处给：升级（固定值）+ 宝物（属性加成）。
 *   3. **知识 = 印记（叠层 buff）的叠加速度**，不是法师的攻击力，也不是泛用倍率。
 *      v0.6 依据原作截图修正：「每点知识增加 1% 印记叠加层数」。
 *      印记 = 中毒层数、虚弱回合数这类离散、可数、按"层"结算的东西。
 *
 * 经验是**局内资源**：探险阵亡就清零，跟着 initial 快照一起回滚。
 */

/** 等级上限。30 层跑满大约到 17 级，留出余量给未来的无尽模式 */
export const MAX_LEVEL = 30;

/**
 * 每点知识让印记类 buff 的叠加层数提升多少。
 *
 * v0.5 是"所有 buff 效果 +2%"，v0.6 依据原作截图修正为「每点 +1% 印记叠加层数」。
 * 作用范围只有中毒层数和虚弱回合数（见 combat.js 里 markMul 的使用处）；
 * 护甲 / 治疗 / 力量 / 荆棘不吃加成，它们是即时数值，不是"叠层"。
 */
export const KNOWLEDGE_PER_POINT = 0.01;

/* ------------------------------------------------------------------ *
 * 属性面板（v0.6，对齐原作）—— 公式与上限的唯一数值入口
 * ------------------------------------------------------------------ */

/** 防御：每点降低 1% 受到的直接伤害，中毒 tick 不吃减免 */
export const DEF_CAP = 40;

/* ------------------------------------------------------------------ *
 * 攻击力（v3.21）：线性模型 —— 对齐原作「每点物攻 +1% 物理伤害」
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 攻击力（v3.26）：卡牌自带基础伤害，攻击力只做百分比加成
 * ------------------------------------------------------------------ */

/**
 * 攻击力 → 伤害乘数。
 *
 * **只有百分比，没有基准值。** 基准写在卡牌数据里 —— `CARDS.x.dmg` 就是那张牌的
 * 基础伤害（1 费基础牌 = 16 点，重击 = 31 点）。于是公式可以一句话说完：
 *
 *     伤害 = 卡牌基础伤害 × (1 + 攻击力/100)
 *
 * 攻击 10 → ×1.10，攻击 30 → ×1.30，每点恒定 +1%，没有拐弯。
 *
 * v3.21~v3.25 用的是 `系数 × 13 × (1 + 攻击/100)` —— 那个 13 是魔法数，
 * 卡面写 17 而玩家算不出 17 是从哪来的。v3.26 把 ×13 这一步直接烧进卡牌数据，
 * 战斗、竞技场、卡面文案、机器人估值全部只认 `atkMul` 这一个入口。
 *
 * 旧模型（v3.20 及更早）是 `伤害 = 系数 × 攻击力`，攻击力当乘数：+1 点在攻击 10 时
 * 值 +10%、攻击 30 时只值 +3.3%，和面板写的"每点 +1%"对不上，已废弃。
 */
export function atkMul(atk) {
  return 1 + Math.max(0, Number(atk) || 0) / 100;
}

/** 暴击：每点 +1% 暴击率，默认 1.5 倍伤害（职业可覆盖，猎人 3 倍），只作用于玩家攻击牌 */
export const CRIT_CAP = 60;
export const CRIT_DMG = 1.5;
/** 闪避：每点 +1% 完全躲避敌人攻击的概率，词条伤害不可闪避 */
export const DODGE_CAP = 30;
/** 恢复：每场胜利战斗结束回 1 HP/点（失败不回） */
export const RECOVERY_PER_POINT = 1;

/** 幸运对宝物出现率的上限（原为 +15，旅行家能涨到 34 幸运，必须抬高） */
export const LUCK_RELIC_CAP = 40;

/**
 * 能量上限的硬顶（v3.62）。
 *
 * 能量是招募掷点（5~8，v3.58），局内只有三条路能加：两件宝物 + 一个稀有事件。
 * 用户明确要求"控制大部分卡组最后都不会超过 10 个能量，除非某些特殊职业或者种族"——
 * 所以普通途径（星辉烛台 / 星髓神龛）全部夹在 ENERGY_CAP = 10；
 * 唯一能突破的是**青苔族专属**的月苔圣杯（+2、上限 ENERGY_OVERCAP = 12）——
 * 青苔被动是"剩余能量转护甲"，能量对它有双重价值，值得这个身份溢价。
 */
export const ENERGY_CAP = 10;
export const ENERGY_OVERCAP = 12;

/**
 * 四职业的升级成长表 —— 整个系统的唯一数值入口。
 *
 * key 对应 player 上的字段；apply 决定怎么落到状态上（大多是简单的加法，
 * 但 maxHp 要连带把当前血量也顶上去，否则"升级加血"等于没加）。
 */
export const GROWTH = {
  warrior: {
    key: 'maxHp',
    name: '最大生命',
    value: 4,
    text: '最大生命 +4',
    apply(p) {
      p.maxHp += GROWTH.warrior.value;
      p.hp += GROWTH.warrior.value;
    },
  },
  mage: {
    key: 'knowledge',
    name: '知识',
    value: 4,
    text: '知识 +4（印记叠加层数 +4%）',
    apply(p) {
      p.knowledge = (p.knowledge || 0) + GROWTH.mage.value;
    },
  },
  hunter: {
    key: 'crit',
    name: '暴击',
    value: 3,
    text: '暴击 +3%',
    /**
     * v3.23：攻击力 +1 → **暴击 +3**（用户提议："猎人不是一定要通过每级 + 攻击的，
     * 也可以改成其他机制更符合猎人的比如暴击或者流血"）。
     *
     * 为什么必须换：v3.21 攻击力改线性（每点恒定 +1%）之后，"每级 +1 攻击"
     * 从旧模型的 +9%/级 掉到 +1%/级，猎人通关率 51% → 10%。
     * 继续加攻击只会变成"每级 +4 攻击"的数字膨胀，等于放弃职业身份。
     *
     * 为什么是暴击而不是流血：
     *   ① 猎人的 tag 本来就是「陷阱暴击」、职业基础暴击是四职业最高的（v3.58 起 8 点），
     *      这条轴早就存在，只是没被当成成长轴；
     *   ② 流血会跟旅行家的中毒（无视护甲、每回合 tick）功能重叠，
     *      而残塔的状态位已经够挤（毒/灼烧/虚弱/力量），再开一条会让玩家分不清；
     *   ③ 暴击天然和多段牌（连锁箭 4 段、连射）契合 —— 猎人的牌本来就多发。
     *
     * 数值（60 局 × 16 组合 = 960 局实测，暴伤 3.0 / 上限 60）：
     *   每级 +2 → 猎人 21%；+3 → 29%；再配暴伤 2.5 → 40%；**+3 且暴伤 3.0 → 54%**，
     *   与其它职业同梯队（战 72 / 法 75 / 猎 54 / 旅 46）。旧「每级 +1 攻击」到
     *   17 级只值 +16% 伤害，现在是 17 级 56 点暴击 × 3 倍 = 期望 +112%。
     * 上限 CRIT_CAP = 60（v3.23 从 50 抬上来）：14 级约 47 点，撞顶前还有成长空间。
     */
    every: 1,
    apply(p) {
      p.crit = (p.crit || 0) + GROWTH.hunter.value;
    },
  },
  traveler: {
    key: 'luck',
    name: '幸运',
    /**
     * v1.3：每级 +5 → +3。
     *
     * 去掉卡组上限后，幸运的"宝物出现率"变成了复利：等级越高 → 宝物越多 →
     * 战斗越强 → 活得越久 → 等级更高。实测旅行家一局能堆到 11 件宝物、通关 62%，
     * 而法师只有 33%。下调到 +3 把这个循环拧小一档。
     */
    value: 3,
    text: '幸运 +3',
    apply(p) {
      p.luck = (p.luck || 0) + GROWTH.traveler.value;
    },
  },
};

/** 升到下一级需要多少经验（从 level 升到 level+1） */
export function expToNext(level) {
  return 10 + level * 30;
}

/**
 * 一场战斗给多少经验。
 *
 * 线性随层数涨，精英 ×1.6、BOSS ×2.5。
 * 目标：30 层全清大约到 17 级，让"等级"在整局里是一条平滑的斜线，
 * 而不是前 5 层就升满、后面全是空转。
 */
export function expFromBattle(floor, tier = 'normal') {
  const base = 18 + floor * 2;
  const mul = tier === 'boss' ? 2.5 : tier === 'elite' ? 1.6 : 1;
  return Math.round(base * mul);
}

/**
 * 给一次经验，返回升了几级（可能是 0，也可能连升）。
 *
 * @param {object} player   run.player，带 level / exp
 * @param {string} classId
 * @param {number} amount
 * @returns {{ levels: number, from: number, to: number, gained: string[] }}
 */
export function gainExp(player, classId, amount) {
  const growth = GROWTH[classId];
  const from = player.level;
  const gained = [];

  player.exp += amount;

  while (player.level < MAX_LEVEL) {
    const need = expToNext(player.level);
    if (player.exp < need) break;
    player.exp -= need;
    player.level += 1;
    if (growth) {
      /** every = 每几级涨一次，用来把"高价值属性"摊薄到和别的职业同价 */
      const every = growth.every || 1;
      if (player.level % every === 0) {
        growth.apply(player);
        gained.push(growth.text);
      }
    }
  }

  // 满级后经验不再累积，避免数字一直涨但没用
  if (player.level >= MAX_LEVEL) player.exp = 0;

  return { levels: player.level - from, from, to: player.level, gained };
}

/** 把当前等级下"下一次升级还差多少"整理好，给 UI 用 */
export function levelProgress(player) {
  const need = player.level >= MAX_LEVEL ? 0 : expToNext(player.level);
  const pct = need === 0 ? 1 : Math.min(1, player.exp / need);
  return { level: player.level, exp: player.exp, need, pct, maxed: player.level >= MAX_LEVEL };
}

/**
 * 知识换算成印记叠加倍率（1.0 起）。
 *
 * v0.5 叫 buffMultiplier 且作用于所有 buff；v0.6 更名并收窄作用域，
 * 对齐原作「每点知识增加 1% 印记叠加层数」。
 */
export function markMultiplier(player) {
  return 1 + (player.knowledge || 0) * KNOWLEDGE_PER_POINT;
}

/** 幸运对宝物出现率的加成，带上限 */
export function luckRelicBonus(player) {
  return Math.min(LUCK_RELIC_CAP, player.luck || 0);
}

/** 展示用：这个职业每级涨什么 */
export function growthTextOf(classId) {
  return GROWTH[classId]?.text ?? '';
}
