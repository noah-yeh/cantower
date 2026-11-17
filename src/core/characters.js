/**
 * 角色 = 种族 × 职业 —— 静态配置层
 *
 * 这里只放"模板"：基础数值、牌库、被动、种族带的宝物与卡。
 * 真正掷属性、生成卡组、管命数的是 roster.js。
 *
 * 职业决定：基础生命/攻击、职业天赋、牌库
 * 种族决定：命数、被动、2 件未激活宝物、1 张种族卡
 */

export const CLASSES = {
  warrior: {
    id: 'warrior',
    name: '战士',
    tag: '叠甲反伤',
    desc: '正面抗压。护甲既是防御也是弹药，回合结束时不会白白浪费。',
    /** v1.2：112 → 104；v1.6：104 → 100；v3.15：能量收紧后叠甲流反而变强，再压 4 点 */
    baseHp: 86,
    baseAtk: 10,
    /**
     * v0.6 属性面板：防御/暴击/闪避/恢复的招募基础值（掷定时 ±1 浮动）。
     * 数值依据见 GAME_DESIGN.md §4.12 —— 战士堆坦度，法师给容错，
     * 猎人暴击是天赋的数值延伸，旅行家用恢复强化"耗死敌人"。
     * v3.58：整体上调约一半，四项都有底盘，身份项仍是各自最高的一档。
     */
    stats: { def: 7, crit: 1, dodge: 2, recovery: 3 },
    /** 职业自带宝物，开局就是激活状态 */
    relic: 'boneCharm',
    /** 保底 5 张，保证任何随机结果都能打（v3.25：「打击」换成战士自己的「劈砍」） */
    core: ['w_chop', 'w_chop', 'w_chop', 'guard', 'guard'],
    pool: [
      'w_shieldUp', 'w_shieldBash', 'w_ironWall', 'w_sunder', 'w_warcry',
      'w_slam', 'w_bulwark', 'w_counter', 'w_armorCrush', 'w_fortify',
      'w_taunt', 'w_execute',
      // v1.6：盾墙（甲+反伤一体）、撞击（低费甲碎）、堡垒（纯反伤 power）
      'w_shieldWall', 'w_bash', 'w_fortress',
      // v2.1：血甲（血换甲，0 费）、狂化（力量换下回合节奏）
      'w_bloodShield', 'w_berserk',
    ],
    /**
     * 护甲获取 +5%。
     *
     * v1.2 从 13% 降到 8%：卡池收窄成"通用 + 本职业"之后叠甲流成型太快，通关率冲到 66%。
     * v1.6 再降到 5%：新卡里「盾墙 / 撞击 / 堡垒」三张全是围绕护甲的，
     * 加上模拟器终于会给 `thorns` 打分（以前带反伤的牌在机器人眼里是 0 分），
     * 战士的真实强度浮出来是 58%，比其它职业高一整档。
     */
    /**
     * v3.25：`strikeArmor` 撤销 —— 战士的「打击」换成自己的「劈砍」，
     * 「出手带甲」直接写在卡牌数据里（`w_chop.block = 0.1`）。
     * v3.24 那套"id 不动、效果由天赋追加"已经证明行不通：
     * 图鉴与背包里四个职业看到的都是同一张牌，职业差异只能在战斗里才体会得到。
     * 现在卡面就写着「造成 17 点伤害；获得 1 点护甲」。
     */
    perk: { armorGain: 0.028 },
    perkText: '获得的护甲 +3%',
  },

  mage: {
    id: 'mage',
    name: '法师',
    tag: '法术循环',
    desc: '靠连续出牌滚能量，成型后一回合清场。怕卡手，怕高护甲敌人。',
    /**
     * v1.3：116 → 124；v1.6：124 → 132。
     * 卡池变深之后法师的"能量循环"更难凑齐（抽不到涌动/循环就只剩一堆 1 费法术），
     * 它受稀释的影响比其他三个职业都大，补血量让它多活一回合把循环转起来。
     */
    baseHp: 178,
    baseAtk: 10,
    stats: { def: 2, crit: 1, dodge: 5, recovery: 2 },
    relic: 'expEye',
    core: ['m_orb', 'm_orb', 'm_bolt', 'm_frost', 'guard'],
    pool: [
      'm_bolt', 'm_frost', 'm_fireball', 'm_ignite', 'm_surge',
      'm_shield', 'm_cycle', 'm_arcane', 'm_nova', 'm_drain',
      'm_combust', 'm_meteor',
      // v1.6：引导（0 费能量+过牌）、冰枪（带虚弱）、回响（力量+过牌）
      'm_channel', 'm_iceLance', 'm_echo',
      // v2.1：超载（能量透支）、血书（血换过牌）
      'm_overload', 'm_bloodScribe',
    ],
    /**
     * 每打出 2 张牌回 1 能量；法术伤害 v1.6 从 +25% 提到 +30%。
     * 理由同上：卡池从 20 个 id 扩到 29 个之后，法师掉得最狠（43% → 37%），
     * 而它的成长曲线里没有"攻击力"，只能靠这条系数补。
     */
    perk: { energyPerCards: 2, attackBonus: 0.34 },
    perkText: '每打出 2 张牌回 1 点能量，法术伤害 +34%',
  },

  hunter: {
    id: 'hunter',
    name: '猎人',
    tag: '陷阱暴击',
    desc: '开局抢节奏，靠陷阱和标记滚雪球。每级 +3 暴击、暴击造成 3.5 倍伤害 —— 平时不显山露水，爆起来一箭穿心。',
    /**
     * v3.28 敌人曲线收紧（见 enemies.js CURVE）：猎人 176 → 205。
     * 它没有护甲也没有治疗，全靠容错换输出窗口，敌人每层 +15% 攻击后
     * 960 局通关率一度掉到 33%；补血是唯一不改它身份（暴击）的补偿手段。
     */
    baseHp: 205,
    /**
     * 基础攻击 10（v3.23 从 9 回调，对齐四职业标准值）。
     *
     * 攻击力一直是猎人的成长轴，所以基础值被压到 9（v3.15 从 8 补回 1 点）。
     * v3.21 线性化、v3.23 成长轴换成暴击之后，攻击力不再随等级涨 ——
     * 基础值就是全局的基数，9 点会让猎人在 30 层的伤害曲线整体低一档。
     * 回归 10 与其他职业同一基数，身份差异改由暴击承担。
     */
    baseAtk: 10,
    stats: { def: 2, crit: 8, dodge: 3, recovery: 2 },
    relic: 'quiver',
    core: ['h_arrow', 'h_arrow', 'h_shot', 'h_step', 'guard'],
    pool: [
      'h_shot', 'h_multi', 'h_trap', 'h_aim', 'h_pierce',
      'h_volley', 'h_poisonArrow', 'h_step', 'h_mark', 'h_rapid',
      'h_snipe', 'h_venomTrap',
      // v1.6：连锁箭（4 段）、铁蒺藜（甲+反伤）、快拔（0 费一次性）
      'h_chain', 'h_caltrops', 'h_quickdraw',
      // v2.1：连珠（连击尾刀）、爆裂陷阱（毒+反伤双修）
      'h_burst', 'h_explosive',
    ],
    /**
     * v2.2：0.14 → 0.08 —— **对齐卡面文案**。perkText 一直写"+8%"，代码却是 0.14，
     * 这是从一开始就存在的不一致（玩家看到的比实际弱）。顺手也正是当前需要的
     * 职业压强：猎人靠攻击牌乘区吃强化祭坛最狠，是全职业通关率最高的一个。
     *
     * 攻击牌伤害 v1.6 从 +4% 提到 +8%，第 1 张攻击牌翻倍。
     * 新卡「连锁箭 / 铁蒺藜 / 快拔」里只有两张是进攻牌，猎人同样被稀释，
     * 42% → 36%；攻击牌加成是它最直接的杠杆（每级 +1 攻击已经不能再加了）。
     *
     * v3.23：新增 `critDmg` —— **职业专属暴击倍率**。成长轴换成暴击之后，
     * 1% 暴击率的收益 = 暴伤 − 1，所以暴伤就是这条轴的"汇率"：
     * 1.5 时每级 +3 暴击只值 +1.5%/级，和线性攻击差不多废。
     * 实测（480 局）：1.5 上限 60 → 29%，2.5 → 40%，**3.0 → 54%**（与其它职业齐平）。
     * 倍数写在这里而不是 CRIT_DMG 全局常数上：别的职业堆暴击（宝物/装备）
     * 仍是 1.5，猎人的身份才是"一箭穿心"。
     */
    perk: { firstAttackDouble: 1, attackBonus: 0.08, critDmg: 3.5 },
    perkText: '攻击牌伤害 +8%，每回合第 1 张攻击牌翻倍，暴击造成 3.5 倍伤害',
  },

  traveler: {
    id: 'traveler',
    name: '旅行家',
    tag: '毒系持续',
    desc: '中毒无视护甲，专克高血量 BOSS。前中期偏弱，后期毒叠起来就是碾压。',
    /**
     * v1.2：128 → 134；v1.6：134 → 144；v3.28 敌人加强后再补到 158。
     * 旅行家是唯一纯毒系、前期最脆的职业，而毒要 2~3 回合才见效 ——
     * 卡池变深之后它抽不到"不衰减"和"放大"的窗口更长了，直接把血量补上去。
     */
    baseHp: 158,
    baseAtk: 10,
    stats: { def: 5, crit: 1, dodge: 3, recovery: 6 },
    relic: 'herbPouch',
    core: ['t_fang', 't_fang', 't_stitch', 't_venom', 'guard'],
    pool: [
      't_stitch', 't_venom', 't_think', 't_plant', 't_mist',
      't_leech', 't_brew', 't_shell', 't_spread', 't_cure',
      't_blight', 't_plague',
      // v1.6：腐蚀（攻击兼上毒）、绽放（先上毒再放大）、菌丝（0 费过牌上毒）
      't_corrosive', 't_bloom', 't_fungus',
      // v2.1：放血（血换毒）、沼泽（放大带甲）
      't_sapLife', 't_bog',
    ],
    /**
     * 敌人每层毒，额外 +2% 受到伤害
     *
     * v3.25：`strikePoison` 撤销 —— 旅行家的「打击」换成自己的「毒牙」，
     * 「附带 1 层毒」直接写在卡牌数据里（`t_fang.poison = 1`），
     * 走 combat 的通用中毒结算（吃知识、无视护甲）。卡面上看得见。
     */
    perk: { poisonAmp: 0.02 },
    perkText: '敌人每层毒，受到的伤害 +2%',
  },
};

/**
 * 种族（v2.2：天赋机制化）
 *   lives  命数 —— v3.93 起**不再由种族决定**：招募时随机掷 5~8 条（见 LIVES_MIN/MAX），
 *          所以这里没有 lives 字段了。留一个字段值会让人以为"这个种族天生几命"。
 *   relics 携带的宝物，初始全部未激活，要靠材料点亮
 *   card   种族专属卡（1 族 1 张，招募时进卡组，可强化到 +3）
 *   perk   种族天赋 —— v2.2 起全部是**战斗机制**，不再是纯数值乘区。
 *          磐石 armorStart/armorPerTurn、光合 energyToArmor、
 *          残影 firstHitReduce、余烬 burnOnHit，接线见 combat.js。
 *          加新种族 = 填一个新条目；若天赋要新机制，在 combat.js 与
 *          arena.js 各接一个钩子，引擎之外自动生效。
 */
export const RACES = {
  stone: {
    id: 'stone',
    name: '石头人',
    desc: '磐石：战斗开始获得 3 点护甲，每回合开始再获得 1 点',
    perk: { armorStart: 3, armorPerTurn: 1 },
    relics: ['thornRing', 'ironRing'],
    card: 'r_stoneSkin',
  },
  moss: {
    id: 'moss',
    name: '青苔族',
    desc: '光合：回合结束时，剩余的每点能量转化为 1 点护甲',
    perk: { energyToArmor: 1 },
    relics: ['plantEssence', 'poisonGem'],
    card: 'r_mossGrow',
  },
  shade: {
    id: 'shade',
    name: '影族',
    desc: '残影：每回合第一次受到的攻击伤害 -30%',
    perk: { firstHitReduce: 0.3 },
    relics: ['whetstone', 'energyHam'],
    card: 'r_shadowStep',
  },
  ember: {
    id: 'ember',
    name: '余烬族',
    desc: '余烬：每回合第一张攻击牌命中时附加 1 层灼烧（中毒）',
    perk: { burnOnHit: 1 },
    relics: ['moltenCore', 'emberStone'],
    card: 'r_emberBurst',
  },
};

/**
 * 命数区间（v3.93）。
 *
 * 用户：「种族寿命改成招募的时候 5-8 条随机生成吧」。
 * 之前命数是种族身份的一部分（石头人 7 / 青苔 6 / 影 5 / 余烬 3），
 * 于是"能不能多活几次"在招募那一刻就定死了，玩家没得选也没得赌。
 * 改成招募时掷 5~8 之后，同种族的两个人命数可以不同 ——
 * **每一次招募都是一次小赌博**，这和属性 ±8% 的掷点是同一套语言。
 *
 * 注意：这等于把余烬从 3 命抬到平均 6.5 命。余烬本来就是四个种族里
 * 机制最弱的（只有 1 层灼烧），原来靠最少命数"压"着它，现在它和其他三族
 * 站在同一条命数起跑线上 —— 想压难度就该去调它的被动，别再拿命数当平衡旋钮。
 */
export const LIVES_MIN = 5;
export const LIVES_MAX = 8;

export const CLASS_IDS = Object.keys(CLASSES);
export const RACE_IDS = Object.keys(RACES);

/** 招募时的属性浮动区间：±8% */
export const ROLL_RANGE = 0.08;

/* ------------------------------------------------------------------ *
 * 种族等级加成（v3.89）
 *
 * 定义在这里而不是 races.js，是因为**掷点要用它**，而 races.js 依赖本文件的
 * RACE_IDS/RACES —— 反过来导入会形成循环依赖。
 * races.js 会把这两个符号原样 re-export 出去，外部照旧从 races.js 取。
 * ------------------------------------------------------------------ */

/** 种族等级上限 */
export const RACE_MAX_LEVEL = 30;

/**
 * 面板属性的发放顺序：每 5 级给 1 点，按这个顺序轮。
 * 30 级共 6 点 → 防御 2 / 暴击 2 / 闪避 1 / 恢复 1。
 * 刻意不给能量：能量上限牵动整个回合节奏，+1 等于换了一套数值。
 */
const PANEL_STEPS = ['def', 'crit', 'dodge', 'recovery', 'def', 'crit'];

/**
 * 某个等级的加成。招募掷点**在基础值之上叠这一层**（区间上下限一起抬）。
 *
 * 用户要的是「每升一级 +1 点属性范围」，但不能每项都 +1：
 * 攻击是伤害的乘法基底，30 级 +30 攻击等于 4 倍强度。所以做成
 *
 *   每级      → 生命上限 +1（30 级 +30，约 +35%，就是那"每级 1 点"）
 *   每 5 级   → 面板 +1（防御/暴击/闪避/恢复 轮着给，共 6 点）
 *   15 / 30 级 → 攻击 +1（共 +2，约 +20% 伤害）
 *
 * 满级合计约 +30% 战力 —— 有明显成长，但满级号也打不过 30 层本身。
 */
export function raceBonus(level) {
  const lv = Math.max(0, Math.min(RACE_MAX_LEVEL, Math.floor(Number(level) || 0)));
  const out = { hp: lv, atk: 0, def: 0, crit: 0, dodge: 0, recovery: 0 };
  for (let i = 0; i < Math.floor(lv / 5); i++) out[PANEL_STEPS[i]] += 1;
  out.atk = Math.floor(lv / 15);
  return out;
}

/**
 * 能量上限的掷定区间（v3.58）。
 *
 * 用户：「能量初始可以是 5-8 这个样子」—— 能量从全局常量 8 变成角色属性：
 * 招人时掷 5~8，写进 initial 快照，进塔和竞技场都按这个值回能。
 *
 * 注意这是**真正的强度差**：4 点连三张 1 费牌都打不完，必须做
 * "这回合先不打哪张"的取舍；6 点则明显更顺。
 * 所以它是招人时最有分量的一个掷点，也是"换一位"的正当理由。
 *
 * v3.87（用户：「卡牌消耗水晶太少了，初始水晶都太高了」）：**5~8 → 4~6**。
 * 原来均值 6.5，而 5 张手牌的费用总和只有 ~5.6 —— 每回合都能把牌全打光，
 * "打哪张"根本没有取舍。降一档之后均值 5，配合 0 费产出牌涨价，
 * 一回合通常只能打 3~4 张。旧角色的 energy 值原样保留，不做迁移。
 */
export const ENERGY_MIN = 4;
export const ENERGY_MAX = 6;

/**
 * 掷属性。rng 必须传入，保证招募可复现（同种子同结果）。
 * 返回值里带 roll 系数，方便 UI 显示"这次是偏高还是偏低"。
 */
export function rollCharacter(classId, raceId, rng, raceLevel = 0) {
  const cls = CLASSES[classId];
  const race = RACES[raceId];
  if (!cls || !race) throw new Error(`未知角色组合: ${classId}/${raceId}`);

  const bonus = raceBonus(raceLevel);
  const hpMul = race.perk.hpMul ?? 1;
  const atkMul = race.perk.atkMul ?? 1;
  const hpRoll = 1 - ROLL_RANGE + rng.next() * ROLL_RANGE * 2;
  const atkRoll = 1 - ROLL_RANGE + rng.next() * ROLL_RANGE * 2;

  /**
   * 四项新属性（v0.6）：基础值 ±1 掷定，夹到 ≥0。
   * 小整数 + 小浮动 —— 面板属性要的是"性格差异"，不是数值彩票。
   *
   * v3.58：职业基础值整体上调约一半（用户：「除了生命值都太少了」）。
   * 旧值 战士 4/0/0/2、法师 0/0/3/0、猎人 0/5/2/1、旅行家 3/0/2/4 ——
   * 面板上大量 0，防御 3~4 也等于没有（每点才 -1% 伤害）。
   * 现在每个职业在四项上都有一点底盘、身份项再高一截，面板不再出现三连 0。
   */
  const statRoll = (v) => Math.max(0, (v ?? 0) + (rng.next() < 0.5 ? -1 : 1) * (rng.next() < 0.5 ? 0 : 1));
  const base = cls.stats || { def: 0, crit: 0, dodge: 0, recovery: 0 };

  /** 放在所有属性掷完之后：前几项的随机序列不受影响，旧种子掷出的血/攻不变 */
  const energy = ENERGY_MIN + Math.floor(rng.next() * (ENERGY_MAX - ENERGY_MIN + 1));

  /**
   * v3.89：种族等级的加成叠在**掷完之后**，不是乘在倍数里。
   * 这样 30 级的区间是「0 级的区间整体上移」，玩家看到的招募面板
   * 就是从 79~93 变成 109~123 —— 符合"属性范围随等级变化"的直觉，
   * 也不会因为乘法把高等级角色的运气幅度一起放大。
   */
  return {
    maxHp: Math.max(1, Math.round(cls.baseHp * hpMul * hpRoll) + bonus.hp),
    atk: Math.max(1, Math.round(cls.baseAtk * atkMul * atkRoll) + bonus.atk),
    def: statRoll(base.def) + bonus.def,
    crit: statRoll(base.crit) + bonus.crit,
    dodge: statRoll(base.dodge) + bonus.dodge,
    recovery: statRoll(base.recovery) + bonus.recovery,
    energy,
    hpRoll,
    atkRoll,
    /** 掷点时用了多少级加成 —— 招募页要显示"这一位是 7 级种族招来的" */
    raceLevel: Math.max(0, Math.floor(Number(raceLevel) || 0)),
  };
}

/** 无 rng 时的期望值（测试与展示"标准值"用） */
export function buildCharacter(classId, raceId) {
  const cls = CLASSES[classId];
  const race = RACES[raceId];
  if (!cls || !race) throw new Error(`未知角色组合: ${classId}/${raceId}`);
  return {
    classId,
    raceId,
    name: `${race.name}${cls.name}`,
    maxHp: Math.round(cls.baseHp * (race.perk.hpMul ?? 1)),
    atk: Math.round(cls.baseAtk * (race.perk.atkMul ?? 1)),
    stats: { ...(cls.stats || { def: 0, crit: 0, dodge: 0, recovery: 0 }) },
    /** 标准值取区间上限（v3.58）：展示和测试用"满能量"这一档，掷点区间见 ENERGY_MIN/MAX */
    energy: ENERGY_MAX,
    deck: [...cls.core, ...cls.pool.slice(0, 4), race.card],
    relics: [cls.relic],
    perk: { ...cls.perk },
    racePerk: { ...race.perk },
  };
}
