/**
 * 卡牌表 + 卡面文案生成
 *
 * 硬性约定：卡面文案一律由 cardText() 从数值生成，禁止手写。
 * dark-tide 时代踩过坑——手写文案在调参后必然失同步（写着 70% 实际 95%）。
 *
 * 效果字段（全部可选，可叠加）：
 *   dmg          伤害倍率（× 攻击力）
 *   hits         段数，默认 1
 *   block        获得护甲（× 攻击力）
 *   heal         治疗（× 攻击力）
 *   draw         抽牌数
 *   energy       获得能量
 *   poison       施加中毒层数
 *   weak         施加虚弱回合数（敌人伤害 -25%）
 *   strength     攻击力加成（**只在本场战斗内生效**，战斗结束清零，v3.59 更正文案）
 *   pierce       true = 无视护甲
 *   exec         敌人血量低于该比例时伤害 ×2
 *   thorns       获得荆棘层数（v3.53：每层每次受击反弹 1 点，本场累计，吃知识）
 *   dmgPerPoison 敌人每层毒，本卡额外 +该倍率
 *   amplifyPoison 敌人毒层数 ×(1 + 该值)
 *   keepPoison   true = 本场敌人毒不再自然衰减
 *   scaleArmor   每点护甲额外 +该值倍率伤害（消耗护甲另算）
 *   consumeArmor true = 打出时消耗全部护甲
 *   exhaust      true = 打出后本场移除
 *
 * v2.1 新增（决策与连击）：
 *   costHp          打出时失去该比例 × 最大生命（最低留 1，不直接杀人）
 *   energyPenalty   下回合能量 -N（复用 energyDrain 状态位）
 *   discardRandom   打出后随机弃 N 张手牌
 *   perAttack       本回合每打出过一张攻击牌，本卡伤害额外 +该值 × 攻击力（连击）
 *   cleanseBlock    移除手牌所有「伤口」，每张 +该值 × 攻击力护甲（净化）
 *   unplayable      true = 无法打出（状态牌，占手牌位）
 *
 * v3.15 新增（连携兑现）—— 用户：「卡牌之间配合还是太少了，没什么套路，都是啪啪啪直接点玩」。
 *
 * 设计口径：**铺垫牌自己不打伤害，兑现牌单独打是废牌**。
 * 只有"先铺 2~3 张、再打一张兑现"才拿到质变收益，玩家才会为了连携放弃当回合的输出。
 * 每个字段对应一条明确的构筑线，不要随手组合（会把每条线都摊薄成"小加成"）：
 *
 *   dmgPerArmor     护甲 × 该值 加伤，**不消耗护甲**（战士·叠甲持续兑现）
 *   consumeArmorMul 消耗的护甲 × 该值 直接转成伤害（战士·碎甲爆发，需配 consumeArmor）
 *   perSkill        本回合每打出过 1 张技能牌 +该值 × 攻击力（法师·法术循环）
 *   perCard         本回合每打出过 1 张牌 +该值 × 攻击力（通用·终结技）
 *   ifWeakMul       目标处于虚弱时整张牌伤害 ×该值（猎人·标记后猎杀）
 *   poisonBurst     敌人当前毒层 × 该值 × 攻击力，**命中后清空毒层**（旅行家·引爆）
 *   energyBurst     剩余能量 × 该值 × 攻击力，打出后能量清零（法师·透支爆发）
 *
 * 另外给这些牌打 `combo: true`：它不是结算字段，只是"这是一张兑现牌"的显式标记。
 * 机器人靠它给「没攒够就别打」的门槛（不然会把裸打很弱的兑现牌无脑甩出去），
 * UI 靠它在卡面挂一个连携角标。注意**不要**给「撞击」这类基础牌打标 ——
 * 它本身就能当普通攻击牌用，打了标反而会被门槛误伤（v3.15 第一次跑就栽在这里，
 * 战士被误判掉 16 个点）。
 */

/* v3.21：卡面数字必须与实战同口径 —— 攻击力走 leveling 的 atkMul（每点 +1%） */
import { atkMul } from './leveling.js';

export const CARDS = {
  /* ---------------- 通用 14 张 ----------------
   * 前半是"基础动作"（打击 / 护甲 / 过牌 / 治疗），后半是**道具**（v1.6）：
   * 宝石、炸弹、秘药、烟雾弹、淬毒短刀、战旗。
   * 道具的共同点是**一次性**（exhaust）—— 它们不参与构筑，只解决眼前这一回合的问题，
   * 所以任何职业抽到都不亏，也不会被某个职业的循环利用成无限资源。
   */
  /**
   * v3.25：`strike` 退成**兼容牌**（不再进任何卡池、不再进起始卡组）。
   *
   * 它曾是四职业共用的保底攻击牌，v3.24 试过"id 不动、效果由职业天赋追加"，
   * 但那是把一个职业的身份藏进天赋表 —— 图鉴里四个职业看到的还是同一张牌。
   * 用户的口径更直接：「卡牌名字一变都是新的卡牌了」。
   * 现在四个职业各有一张自己的基础攻击牌（见下方「职业基础攻击牌」），
   * 这张只留给老存档、竞技场快照与测试桩用，保留定义才读得出来。
   */
  strike: { name: '打击', cost: 1, kind: 'attack', dmg: 12, perCopy: 2.2, text: '基础攻击' },
  guard: { name: '格挡', cost: 1, kind: 'skill', block: 9 },
  jab: { name: '快刺', cost: 1, kind: 'attack', dmg: 13 },
  brace: { name: '架势', cost: 1, kind: 'skill', block: 10 },
  focus: { name: '凝神', cost: 0, kind: 'skill', draw: 2 },
  heavy: { name: '重击', cost: 2, kind: 'attack', dmg: 23 },
  mend: { name: '绷带', cost: 1, kind: 'skill', heal: 7, exhaust: true },
  expose: { name: '破防', cost: 1, kind: 'skill', weak: 2 },

  gem: { name: '魔力宝石', cost: 0, kind: 'skill', energy: 2, exhaust: true },
  bomb: { name: '火药炸弹', cost: 1, kind: 'attack', dmg: 17, pierce: true },
  elixir: { name: '秘药', cost: 1, kind: 'skill', heal: 10, draw: 1, exhaust: true },
  smoke: { name: '烟雾弹', cost: 1, kind: 'skill', block: 6, weak: 2 },
  toxin: { name: '淬毒短刀', cost: 1, kind: 'attack', dmg: 7, poison: 3 },
  banner: { name: '战旗', cost: 1, kind: 'power', strength: 2, exhaust: true },

  /* -- v2.1 通用决策卡：强力但有代价，什么时候打是个问题 -- */
  /** 免费重击，代价是下回合只剩 8 能量 —— 抢节奏还是稳节奏 */
  gamble: { name: '孤注一掷', cost: 0, kind: 'attack', dmg: 22, energyPenalty: 2 },
  /** 免费回 3 能量，代价是血 —— 低血量时打它就是赌命 */
  bloodPact: { name: '鲜血契约', cost: 0, kind: 'skill', energy: 3, costHp: 0.08, exhaust: true },
  /** 连击核心：铺的攻击牌越多越疼，单独打是废牌 —— 通用池里的“套路发动机” */
  flurry: { name: '连打', cost: 1, kind: 'attack', dmg: 4, perAttack: 3.3 },
  /** 伤口越多甲越厚：被「污染」词条阴了之后的翻盘手段 */
  purify: { name: '净化', cost: 1, kind: 'skill', block: 5, cleanseBlock: 4 },
  /** 高倍率但随机丢一张手牌 —— 手里攥着 combo 时打它就是在赌牌序 */
  reckless: { name: '蛮勇', cost: 1, kind: 'attack', dmg: 29, discardRandom: 1, exhaust: true },

  /* ---------------- 宝石牌（v3.91） ----------------
   * 用户：「再增加一些宝石牌，宝石牌使用后可以装备在状态栏在本场战斗生效」。
   *
   * 和上面的一次性道具（魔力宝石 / 火药炸弹 …）不是一回事：
   *   kind: 'gem' + `gem: {...}` —— 打出后**镶进战斗状态栏**，本场持续生效；
   *   卡牌本身进消耗堆（exhaust），战斗结束随 battle 一起消失、不进永久卡组。
   *
   * 为什么不做成 power 牌：power 只有 strength / thorns 两种数值形态，
   * 而宝石要表达"攻击牌 +%""每回合 +甲""中毒 +层""能量 +1""暴击 +%"五种不同的增益，
   * 且玩家要能一眼看到"我这场镶了什么" —— 单列一种牌类 + 状态栏常驻 chip 最直。
   *
   * 数值口径（两回合回本）：1 费换一条持续增益，前两回合亏、第三回合起才净赚。
   * 所以宝石是"打持久战"的选择，快攻卡组不该拿 —— 这条比数值本身更重要。
   */
  gem_ruby: {
    name: '赤红宝石', cost: 1, kind: 'gem', exhaust: true,
    gem: { atkBonus: 0.10 },
  },
  gem_sapphire: {
    name: '苍蓝宝石', cost: 1, kind: 'gem', exhaust: true,
    gem: { armorPerTurn: 3 },
  },
  gem_emerald: {
    name: '翠绿宝石', cost: 1, kind: 'gem', exhaust: true,
    gem: { poisonBonus: 2 },
  },
  gem_topaz: {
    name: '琥珀宝石', cost: 1, kind: 'gem', exhaust: true,
    gem: { energyPerTurn: 1 },
  },
  gem_amethyst: {
    name: '紫晶宝石', cost: 1, kind: 'gem', exhaust: true,
    gem: { critBonus: 6 },
  },


  /** 状态牌（v2.1）：不进任何奖励池，只由陷阱事件与敌人「污染」词条塞进战斗牌库 */
  wound: { name: '伤口', cost: 0, kind: 'status', unplayable: true },

  /* ---------------- 职业基础攻击牌（v3.25） ----------------
   * 每个职业的起始卡组自带 2~3 张「自己的」1 费攻击牌 —— 名字不同就是不同的牌，
   * 效果直接写在数据里，不再借职业天赋给同一张「打击」追加效果。
   *
   * 共同口径（刻意保持一致，差异只放在"手感"上）：
   *   cost 1 / dmg 1.2 —— 与旧「打击」同倍率，是全部卡牌倍率的标尺（重击 2.4 = 两张基础牌）
   *   perCopy 0.2     —— 「同袍」（v3.18）按牌 id 计数，基础牌必须带上它
   *   可强化到 +3     —— 强化只放大主数值 + 毒/甲，抽牌与能量不放大
   *
   * 差异只做一层，且都是"这个职业本来就该有"的动作：
   *   劈砍  出手带甲（战士的护甲是弹药，吃 armorGain 与宝物加成）
   *   法球  纯伤害（法师的差异化在天赋：法术伤害 +34%、每 2 张牌回 1 能量）
   *   放箭  纯伤害（猎人的差异化在天赋：+8%、首击翻倍、暴击 3 倍）
   *   毒牙  附带 1 层毒（旅行家最普通的动作就该带毒，补新手期"打高甲怪没伤害"的挫败感）
   *
   * 数值刻意压得小：基础牌必须始终是「能被淘汰的牌」，一旦强到不敢换，
   * 构筑空间就被起始卡组锁死了。
   */
  w_chop: { name: '劈砍', cost: 1, kind: 'attack', dmg: 12, block: 1, perCopy: 2.2, text: '基础攻击' },
  m_orb: { name: '法球', cost: 1, kind: 'attack', dmg: 12, perCopy: 2.2, text: '基础攻击' },
  h_arrow: { name: '放箭', cost: 1, kind: 'attack', dmg: 12, perCopy: 2.2, text: '基础攻击' },
  t_fang: { name: '毒牙', cost: 1, kind: 'attack', dmg: 12, poison: 1, perCopy: 2.2, text: '基础攻击' },

  /* ---------------- 战士 15 张：叠甲反伤 ----------------
   * v3.59：护甲值整体下调约 25%（叠甲太容易 —— 护甲跨回合保留，一张 1 费牌就能顶住
   * 一整轮攻击）。依赖护甲的兑现牌（重砸/甲碎/撞击）系数同比例上调，
   * 让「叠甲流」变慢而不变废：要攒甲才有输出，但攒的速度不再失控。
   */
  w_shieldUp: { name: '举盾', cost: 1, kind: 'skill', block: 12 },
  w_shieldBash: { name: '盾击', cost: 1, kind: 'attack', dmg: 7, block: 7 },
  w_ironWall: { name: '铁壁', cost: 3, kind: 'skill', block: 26 },
  w_sunder: { name: '破盾击', cost: 2, kind: 'attack', dmg: 18, weak: 2 },
  w_warcry: { name: '战吼', cost: 1, kind: 'power', strength: 3, exhaust: true },
  /** v3.15：护甲越厚砸得越沉 —— 战士"先叠甲再出手"的第一张兑现牌 */
  w_slam: { name: '重砸', cost: 2, kind: 'attack', dmg: 23, dmgPerArmor: 0.36, combo: true },
  w_bulwark: { name: '壁垒', cost: 1, kind: 'skill', block: 16, exhaust: true },
  w_counter: { name: '反击', cost: 1, kind: 'power', thorns: 4 },
  w_armorCrush: { name: '甲碎', cost: 2, kind: 'attack', dmg: 4, scaleArmor: 0.016, consumeArmor: true },
  w_fortify: { name: '固守', cost: 1, kind: 'skill', block: 9, heal: 3, unplayedArmor: 2 },
  w_taunt: { name: '嘲讽', cost: 1, kind: 'skill', block: 8, draw: 1 },
  w_execute: { name: '处决', cost: 3, kind: 'attack', dmg: 33, exec: 0.35 },
  w_shieldWall: { name: '盾墙', cost: 3, kind: 'skill', block: 24, thorns: 2 },
  w_bash: { name: '撞击', cost: 1, kind: 'attack', dmg: 9, scaleArmor: 0.011, consumeArmor: true },
  w_fortress: { name: '堡垒', cost: 1, kind: 'power', thorns: 6, exhaust: true },
  /* -- v2.1 战士决策卡：血换甲 / 力量换节奏 -- */
  /** 血甲必须 exhaust：0 费可循环的"血换甲"会被打成一个无限拖延引擎（实测 34 回合磨死自己的那种局） */
  w_bloodShield: { name: '血甲', cost: 0, kind: 'skill', block: 12, costHp: 0.06, exhaust: true },
  w_berserk: { name: '狂化', cost: 0, kind: 'power', strength: 4, energyPenalty: 2, exhaust: true },

  /* ---------------- 法师 15 张：法术循环 ---------------- */
  m_bolt: { name: '奥术弹', cost: 1, kind: 'attack', dmg: 15, growMul: 0.18 },
  m_frost: { name: '冰霜', cost: 1, kind: 'attack', dmg: 9, block: 6 },
  m_fireball: { name: '火球', cost: 2, kind: 'attack', dmg: 20 },
  m_ignite: { name: '点燃', cost: 1, kind: 'skill', poison: 3 },
  m_surge: { name: '涌动', cost: 0, kind: 'skill', energy: 3 },
  m_shield: { name: '法力护盾', cost: 1, kind: 'skill', block: 15, thorns: 3 },
  m_cycle: { name: '循环', cost: 0, kind: 'skill', draw: 2 },
  m_arcane: { name: '奥术强化', cost: 1, kind: 'power', strength: 4, exhaust: true },
  m_nova: { name: '冰环', cost: 2, kind: 'attack', dmg: 12, block: 9 },
  m_drain: { name: '吸取', cost: 2, kind: 'attack', dmg: 15, heal: 8 },
  m_combust: { name: '爆燃', cost: 2, kind: 'attack', dmg: 9, poison: 5 },
  /** v3.15：法术铺得越多越沉 —— 法师"先打技能牌，再砸陨石"的收尾 */
  m_meteor: { name: '陨石', cost: 3, kind: 'attack', dmg: 29, perSkill: 5.5, combo: true },
  m_channel: { name: '引导', cost: 0, kind: 'skill', energy: 2, draw: 1 },
  m_iceLance: { name: '冰枪', cost: 1, kind: 'attack', dmg: 12, weak: 1 },
  m_echo: { name: '回响', cost: 2, kind: 'power', strength: 3, draw: 2, exhaust: true },
  /* -- v2.1 法师决策卡：能量透支 / 血换过牌 -- */
  m_overload: { name: '超载', cost: 0, kind: 'skill', energy: 4, energyPenalty: 3, exhaust: true },
  m_bloodScribe: { name: '血书', cost: 0, kind: 'skill', draw: 2, costHp: 0.05 },

  /* ---------------- 猎人 15 张：陷阱暴击 ---------------- */
  h_shot: { name: '射击', cost: 1, kind: 'attack', dmg: 13 },
  h_multi: { name: '多重射击', cost: 2, kind: 'attack', dmg: 7, hits: 3 },
  h_trap: { name: '陷阱', cost: 1, kind: 'skill', poison: 2, block: 5 },
  h_aim: { name: '瞄准', cost: 1, kind: 'power', strength: 3, draw: 1 },
  h_pierce: { name: '穿透箭', cost: 2, kind: 'attack', dmg: 16, pierce: true },
  h_volley: { name: '箭雨', cost: 3, kind: 'attack', dmg: 8, hits: 5 },
  h_poisonArrow: { name: '毒箭', cost: 1, kind: 'attack', dmg: 7, poison: 3 },
  h_step: { name: '侧步', cost: 1, kind: 'skill', block: 8, draw: 1 },
  h_mark: { name: '标记', cost: 1, kind: 'skill', weak: 2, draw: 1 },
  h_rapid: { name: '速射', cost: 1, kind: 'attack', dmg: 11, draw: 1, growMul: 0.2 },
  /** v3.15：对虚弱目标整张质变 —— 猎人"标记 → 狙击"的两段式 */
  h_snipe: { name: '狙击', cost: 3, kind: 'attack', dmg: 26, ifWeakMul: 1.5, exec: 0.4, combo: true },
  h_venomTrap: { name: '毒陷阱', cost: 2, kind: 'skill', poison: 5 },
  h_chain: { name: '连锁箭', cost: 2, kind: 'attack', dmg: 5, hits: 4 },
  h_caltrops: { name: '铁蒺藜', cost: 1, kind: 'skill', block: 5, thorns: 2 },
  h_quickdraw: { name: '快拔', cost: 1, kind: 'attack', dmg: 13, exhaust: true },
  /* -- v2.1 猎人决策卡：连击尾刀 / 陷阱双修 -- */
  h_burst: { name: '连珠', cost: 1, kind: 'attack', dmg: 6, perAttack: 3.8 },
  h_explosive: { name: '爆裂陷阱', cost: 1, kind: 'skill', poison: 4, thorns: 1 },

  /* ---------------- 旅行家 15 张：毒 ---------------- */
  t_stitch: { name: '刺针', cost: 1, kind: 'attack', dmg: 11 },
  t_venom: { name: '涂毒', cost: 1, kind: 'skill', poison: 6 },
  t_think: { name: '毒性思考', cost: 1, kind: 'skill', draw: 2, exhaust: true },
  t_plant: { name: '植物精华', cost: 1, kind: 'power', keepPoison: true },
  t_mist: { name: '毒雾', cost: 2, kind: 'skill', poison: 8 },
  t_leech: { name: '蚀骨', cost: 2, kind: 'attack', dmg: 12, heal: 7, dmgPerPoison: 0.7 },
  t_brew: { name: '调配', cost: 1, kind: 'skill', energy: 2, draw: 1 },
  t_shell: { name: '甲壳', cost: 1, kind: 'skill', block: 11 },
  t_spread: { name: '扩散', cost: 2, kind: 'skill', amplifyPoison: 0.5 },
  t_cure: { name: '净毒', cost: 1, kind: 'skill', heal: 10 },
  /** v3.15：把"每层毒"的系数拉陡 —— 铺了 10 层毒之后这一张就是真正的爆发 */
  t_blight: { name: '枯萎', cost: 2, kind: 'attack', dmg: 7, dmgPerPoison: 1.5, combo: true },
  t_plague: { name: '瘟疫', cost: 3, kind: 'skill', poison: 14 },
  t_corrosive: { name: '腐蚀', cost: 1, kind: 'attack', dmg: 4, poison: 6 },
  t_bloom: { name: '绽放', cost: 2, kind: 'skill', amplifyPoison: 0.8 },
  t_fungus: { name: '菌丝', cost: 1, kind: 'skill', poison: 5, draw: 1, unplayedPoison: 1 },
  /* -- v2.1 旅行家决策卡：血换毒 / 放大带甲 -- */
  t_sapLife: { name: '放血', cost: 0, kind: 'skill', poison: 5, costHp: 0.05 },
  t_bog: { name: '沼泽', cost: 1, kind: 'skill', amplifyPoison: 0.35, block: 5 },
  /* -- v3.15 旅行家兑现牌：「毒爆」把攒了半天的毒一次换掉，之后毒层清零 -- */

  /* ---------------- 种族卡 4 张（招募时带入卡组） ---------------- */
  r_stoneSkin: { name: '石肤', cost: 1, kind: 'skill', block: 10, heal: 3, race: 'stone' },
  r_mossGrow: { name: '苔生', cost: 1, kind: 'skill', heal: 8, draw: 1, race: 'moss' },
  r_shadowStep: { name: '影步', cost: 0, kind: 'skill', draw: 2, race: 'shade' },
  r_emberBurst: { name: '余烬爆', cost: 2, kind: 'attack', dmg: 22, poison: 3, race: 'ember' },

  /* v2.2 定稿：种族保持 1 族 1 卡（上面 4 张），可在铁匠强化到 +3。
   * 种族的玩法差异由**天赋机制**承担（磐石/光合/残影/余烬，见 characters.js），
   * 不再走"每族一个卡池"的路线 —— 那会把卡池摊薄，实测法师掉了 7 个点。 */
};

export const ALL_CARD_IDS = Object.keys(CARDS);

/**
 * 通用卡：不属于任何职业，谁都能抽到。
 *
 * 三选一的卡池 = **通用卡 + 本职业 15 张**，绝不能把别的职业的牌混进来。
 * 原因很直接：战士抽到「奥术强化」是纯废牌（没有法师的 `attackBonus` 和能量循环），
 * 抽到就是白占一个奖励位；而玩家看到「陨石」出现在战士的奖励里，只会觉得程序有 bug。
 * 通用卡负责的是"任何构筑都用得上"的那一层 —— 基础动作 + 一次性道具。
 */
export const GENERIC_CARD_IDS = [
  // 基础动作：任何构筑的地基（v3.25 起「打击」退出通用池 —— 各职业有自己的基础攻击牌）
  'guard', 'jab', 'brace', 'focus', 'heavy', 'mend', 'expose',
  // 道具（v1.6）：一次性，不参与循环，抽到就用
  'gem', 'bomb', 'elixir', 'smoke', 'toxin', 'banner',
  // 决策卡（v2.1）：有代价的强牌 + 连击发动机 + 伤口翻盘
  'gamble', 'bloodPact', 'flurry', 'purify', 'reckless',
  // 宝石（v3.91）：镶嵌本场生效，见 §4.3.1
  'gem_ruby', 'gem_sapphire', 'gem_emerald', 'gem_topaz', 'gem_amethyst',
];

/**
 * 永不进入任何奖励/商店池的牌（v2.1）。
 * 状态牌只能由陷阱事件与敌人词条塞进战斗，不能靠拿 —— 否则「伤口」会变成
 * 玩家自己选进卡组的自残牌，机器人也会因为估不出价值而抓瞎。
 */
export const POOL_EXCLUDED_IDS = ['wound'];

/**
 * 职业卡相对通用卡的抽取权重（v1.6）
 *
 * 通用池扩到 14 张之后，职业卡密度被压到 52% —— 靠机制串联的职业（法师的能量循环、
 * 旅行家的叠毒）会直接塌掉，因为它们要的是"职业卡彼此配合"，通用道具串不起来。
 *
 * 奖励三选一和行商货架**必须用同一个权重**：商店卖牌如果按 1:1 抽，
 * 就成了"花金币把卡组稀释成道具堆"的陷阱，实测猎人通关率因此掉 13 个点。
 */
export const CLASS_CARD_WEIGHT = 1.6;

/**
 * 宝石在通用池里的抽取权重（v3.91）。
 *
 * 宝石一进来就把通用池从 18 张推到 23 张，职业卡占比掉到 54%（守门测试的下限是 55%）——
 * 这正是 v1.6 踩过的坑：通用池变胖 = 职业机制串联被稀释。
 * 但宝石不该被砍掉，它是新内容；所以给它一个**低于 1** 的权重：
 * 照样能抽到，只是不像"打击/格挡"这种基础动作那样天天刷脸。
 * 0.7 把职业卡占比拉回 ~60%，与加宝石之前基本一致。
 */
export const GEM_CARD_WEIGHT = 0.7;

/**
 * 一张牌在奖励三选一 / 行商货架里的抽取权重。
 * 两个入口必须共用这一个函数 —— 商店卖牌如果和奖励用不同权重，
 * 就成了"花金币把卡组稀释成道具堆"的陷阱（v1.6 实测猎人因此掉 13 个点）。
 *
 * @param {string[]} classPool 当前职业的专属池
 */
export function cardDrawWeight(classPool, id) {
  if (classPool.includes(id)) return CLASS_CARD_WEIGHT;
  return CARDS[id]?.kind === 'gem' ? GEM_CARD_WEIGHT : 1;
}

/* ------------------------------------------------------------------ *
 * 卡牌实例 —— 「同一张卡可强化」
 *
 * 卡组里存的是字符串：'strike' 或 'strike+2'。
 * 用字符串而不是 {id, lv} 对象，是为了让旧存档、机器人、测试都不用改结构。
 * +N 表示合成过 N 次（N ∈ 1..3），数值按 +50% 基础值线性叠加。
 * ------------------------------------------------------------------ */

export const MAX_FORGE_LEVEL = 3;
export const FORGE_STEP = 0.5;

/** 'strike+2' → { id: 'strike', lv: 2 } */
export function parseCard(key) {
  if (typeof key !== 'string') return { id: key, lv: 0 };
  const i = key.indexOf('+');
  if (i < 0) return { id: key, lv: 0 };
  return { id: key.slice(0, i), lv: Number(key.slice(i + 1)) || 0 };
}

export function cardKey(id, lv = 0) {
  return lv > 0 ? `${id}+${lv}` : id;
}

/** 强化只放大「主数值」，不放大抽牌/能量/段数，否则会指数爆炸。
 *  costHp / energyPenalty / perAttack 等代价与条件字段也不放大：
 *  代价不变、收益变大是强化的正确方向，反过来（代价跟着涨）强化就成陷阱了。 */
const SCALED_FIELDS = ['dmg', 'block', 'heal', 'poison', 'strength'];

/** 把基础卡按等级展开成一张"数值已强化"的卡 */
export function withLevel(base, lv = 0) {
  if (!base || lv <= 0) return base;
  const mul = 1 + FORGE_STEP * lv;
  const out = { ...base };
  for (const f of SCALED_FIELDS) {
    if (typeof base[f] === 'number') out[f] = Math.round(base[f] * mul * 100) / 100;
  }
  out.lv = lv;
  return out;
}

/** 卡组字符串 → 可用的卡对象（自动应用强化等级） */
export function cardOf(key) {
  const { id, lv } = parseCard(key);
  const base = CARDS[id];
  if (!base) return null;
  return withLevel(base, lv);
}

/**
 * 这张牌能不能强化（v3.91）。
 *
 * 宝石的数值是「每回合 +1 能量」「+3 护甲」这类小整数，`FORGE_STEP` 的 +50%
 * 会溢出成 "每回合 +1.5 能量"（半点能量）这种没法结算的值 —— 所以宝石
 * **不进任何强化池**（奖励里的强化祭坛 / 铁匠 / 合成），也不出现在"可强化"提示里。
 * 这条判断放在 core 里，三处调用点共用一套口径，别各写一遍。
 */
export function upgradable(id) {
  return !!CARDS[id] && !CARDS[id].gem;
}

/** 显示名：强化后加 +N */
export function cardName(key) {
  const { id, lv } = parseCard(key);
  const base = CARDS[id];
  if (!base) return String(key);
  return lv > 0 ? `${base.name}+${lv}` : base.name;
}

/** 卡牌花费（UI 判断能否打出用） */
export function cardCost(key) {
  return cardOf(key)?.cost ?? 99;
}

/* ------------------------------------------------------------------ *
 * 卡面文案 —— 唯一来源
 * ------------------------------------------------------------------ */

const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * 宝石镶嵌效果的文案（v3.91）—— 卡面与战斗状态栏共用这一句。
 * 两处各写一遍必然分叉（改了数值忘了改 chip），所以只留一个出口。
 */
export function gemText(gem) {
  if (!gem) return '';
  const parts = [];
  if (gem.atkBonus) parts.push(`攻击牌伤害 +${pct(gem.atkBonus)}`);
  if (gem.armorPerTurn) parts.push(`每回合开始 +${gem.armorPerTurn} 护甲`);
  if (gem.poisonBonus) parts.push(`施加中毒 +${gem.poisonBonus} 层`);
  if (gem.energyPerTurn) parts.push(`每回合能量 +${gem.energyPerTurn}`);
  if (gem.critBonus) parts.push(`暴击率 +${gem.critBonus}%`);
  return parts.join('；');
}

/**
 * 生成卡面描述。atk 传玩家当前攻击力，卡面数字随之变化。
 *
 * opts.perk（v3.24）：传入**当前角色的职业天赋**时，卡面数字与实战同口径 ——
 * 攻击牌伤害吃 `attackBonus`（法师 +34% / 猎人 +8%）。不传时给中性基准，
 * 图鉴与数值导出用它。
 *
 * v3.25：职业基础牌（劈砍/法球/放箭/毒牙）的差异全部写在卡牌数据里
 * （block / poison / dmg），这里不再按 id 给某张牌追加职业注脚。
 */
export function cardText(key, atk = 0, opts = {}) {
  const c = cardOf(key);
  if (!c) return '';
  const parts = [];
  const perk = opts.perk || {};
  /** v3.21：攻击力走 atkMul（每点 +1%），卡面数字 = 实战伤害 */
  const am = atkMul(atk);
  /**
   * 职业攻击牌加成（v3.24）：combat.applyCard 里装在 `dmgMul` 上，
   * 只作用于攻击牌的**本体伤害**与几个乘 dmgMul 的连携项，护甲/治疗/毒不吃。
   * 卡面必须照同一条口径算，否则玩家会以为卡面和实战对不上。
   */
  const atkBonus = c.kind === 'attack' ? 1 + (perk.attackBonus || 0) : 1;
  const val = (ratio) => Math.max(1, Math.round(ratio * am));
  /** 伤害专用：额外乘职业攻击牌加成 */
  const dval = (ratio) => Math.max(1, Math.round(ratio * am * atkBonus));

  /**
   * 宝石（v3.91）：卡面写"镶进去会得到什么"，不写"造成多少伤害" ——
   * 它没有即时结算，只有常驻增益。`exhaust` 的"打出后移除"对宝石是噪音，这里直接返回。
   */
  if (c.kind === 'gem') return `镶嵌进状态栏，本场战斗生效：${gemText(c.gem)}`;

  if (c.dmg != null) {
    /**
     * v3.26：卡面主数字 = 当前攻击力下的实际伤害，括号里给**基础伤害**。
     * 玩家要能自己算出来：基础 16 ×（1 + 10% 攻击）= 18。
     * 攻击力为 0 时两者相同，就不显示括号。
     */
    const base = Math.round(c.dmg);
    const real = dval(c.dmg);
    let s = `造成 ${real} 点伤害`;
    if (real !== base) s += `（基础 ${base}）`;
    if (c.hits > 1) s += ` ×${c.hits} 段`;
    if (c.pierce) s += '（无视护甲）';
    if (c.exec != null) s += `，目标血量低于 ${pct(c.exec)} 时翻倍`;
    if (c.scaleArmor != null) s += `，每点护甲额外 +${(c.scaleArmor * 100).toFixed(1)}%`;
    /**
     * 连携文案（v3.15）：必须写清"靠什么变强"，否则玩家在牌面上看不出这是张 combo 牌，
     * 只会当成一张弱牌 —— 那这套机制等于没做。
     */
    if (c.dmgPerArmor != null) s += `，每点护甲额外 +${(c.dmgPerArmor * am).toFixed(1)}`;
    if (c.consumeArmorMul != null) s += `，消耗的护甲每点额外 +${(c.consumeArmorMul * am).toFixed(1)}`;
    if (c.dmgPerPoison != null) s += `，每层毒额外 +${val(c.dmgPerPoison)}`;
    if (c.poisonBurst != null) s += `，加上「毒层数 × ${(c.poisonBurst * am).toFixed(1)}」并清空毒`;
    if (c.energyBurst != null) s += `，加上「剩余能量 × ${(c.energyBurst * am).toFixed(1)}」并清空能量`;
    /** perSkill/perCard/perCopy 在引擎里是乘 `dmgMul` 的，所以吃职业攻击牌加成 */
    if (c.perSkill != null) s += `，本回合每打过 1 张技能牌再 +${dval(c.perSkill)}`;
    if (c.perCard != null) s += `，本回合每打过 1 张牌再 +${dval(c.perCard)}`;
    if (c.ifWeakMul != null) s += `，目标虚弱时 ×${c.ifWeakMul}`;
    if (c.growMul != null) s += `，本场每打出过一次，伤害再 +${Math.round(c.growMul * 100)}%`;
    if (c.perCopy != null) s += `，牌组里每有一张「${c.name}」再 +${dval(c.perCopy)}`;
    if (c.unplayedArmor != null) s += `，回合结束时每有一张没打出的牌，获得 ${val(c.unplayedArmor)} 点护甲`;
    if (c.unplayedPoison != null) s += `，回合结束时每有一张没打出的牌，附加 ${(c.unplayedPoison).toFixed(1)} 层中毒`;
    parts.push(s);
  }
  if (c.block != null) {
    let s = `获得 ${val(c.block)} 点护甲`;
    if (c.consumeArmor) s += '（消耗全部护甲）';
    parts.push(s);
  }
  if (c.heal != null) parts.push(`回复 ${val(c.heal)} 点生命`);
  if (c.poison != null) parts.push(`施加 ${c.poison} 层中毒`);
  if (c.weak != null) parts.push(`施加 ${c.weak} 回合虚弱`);
  /**
   * v3.59：`strength` 只是 `b.player.strength`，**战斗结束就没了**（run.player 是每场重建的）。
   * 旧文案写「永久」，玩家会以为能带到下一场 —— 必须写清作用域。
   */
  if (c.strength != null) parts.push(`本场战斗 +${c.strength} 点攻击`);
  if (c.energy != null) parts.push(`获得 ${c.energy} 点能量`);
  if (c.draw != null) parts.push(`抽 ${c.draw} 张牌`);
  if (c.thorns != null) parts.push(`获得 ${c.thorns} 层荆棘（受击时反弹等量伤害）`);
  if (c.keepPoison) parts.push('本场敌人中毒不再衰减');
  if (c.amplifyPoison != null) parts.push(`敌人中毒层数 +${pct(c.amplifyPoison)}`);
  /* v2.1：代价与条件字段 —— 卡面必须把代价写在收益前面，决策才成立 */
  if (c.costHp != null) parts.push(`失去 ${Math.round(c.costHp * 100)}% 最大生命`);
  if (c.energyPenalty != null) parts.push(`下回合能量 -${c.energyPenalty}`);
  if (c.discardRandom != null) parts.push(`随机弃 ${c.discardRandom} 张手牌`);
  if (c.perAttack != null) parts.push(`本回合每打出过 1 张攻击牌，伤害 +${val(c.perAttack)}`);
  if (c.cleanseBlock != null) parts.push(`移除手牌所有伤口，每张 +${val(c.cleanseBlock)} 护甲`);
  if (c.exhaust) parts.push('打出后移除');
  if (c.unplayable) return '无法打出；回合末脱落';
  return parts.join('；');
}

/** 完整卡对象（供 UI 使用） */
export function cardView(key, atk = 0) {
  const { lv } = parseCard(key);
  const c = cardOf(key);
  return { id: key, ...c, lv, name: cardName(key), text: cardText(key, atk) };
}
