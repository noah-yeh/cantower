/**
 * 把 core 里的静态数据导出成 data/catalog.json
 *
 * 为什么要有这一步：素材总表（xlsx）和将来的数据库都必须跟代码同源。
 * 手抄一遍表格，调参后必然失同步 —— 这是 dark-tide 时代踩过的坑。
 *
 * 用法：node tools/export-catalog.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILD } from '../src/ui/build.js';
import { CARDS, cardText, MAX_FORGE_LEVEL, FORGE_STEP } from '../src/core/cards.js';
import { ENEMY_CARDS, enemyCardText } from '../src/core/enemyCards.js';
import { CORE_TRAITS, MUTATIONS } from '../src/core/enemyTraits.js';
import { ENEMY_POOL, BOSS_POOL, CURVE, BOSS_FLOORS, ELITE_FLOORS, MAX_FLOOR } from '../src/core/enemies.js';
import { RELICS, RELIC_VALUE, CHAINS } from '../src/core/relics.js';
import { CLASSES, RACES, buildCharacter, CLASS_IDS, RACE_IDS, ROLL_RANGE, ENERGY_MIN, ENERGY_MAX, LIVES_MIN, LIVES_MAX } from '../src/core/characters.js';
import { EXTRA_TALENTS, QUESTS, QUEST_MAX_FLOOR, QUEST_MAX_PER_RUN } from '../src/core/talents.js';
import { ratingOf, PROBATION_LIMIT, VETERAN_LIMIT, ARENA_MAX } from '../src/core/roster.js';
import { GROWTH, MAX_LEVEL, expToNext } from '../src/core/leveling.js';
import { HAND_LIMIT, DRAW_PER_TURN } from '../src/core/combat.js';
import {
  START_GOLD, RECRUIT_COST, REFRESH_COST, MATERIAL_PER_RELIC, GOLD_PER_FLOOR,
  CLEAR_BONUS, ARENA_BASE, ARENA_PER_RATING, ARENA_RATING_CAP,
  RECRUIT_CAP, RECRUIT_REGEN_MS, RECRUIT_START,
} from '../src/core/meta.js';
import { AD_REWARD_GOLD, AD_DAILY_LIMIT } from '../src/core/ads.js';
import { ARENA_HP_MUL, SECOND_ENERGY, SECOND_DRAW } from '../src/core/arena.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const KIND_CN = { attack: '攻击', skill: '技能', power: '能力' };

/* ---------------- 玩家卡牌 ---------------- */

/** id → 归属 */
function ownerOf(id, card) {
  if (card.race) {
    const r = RACES[card.race];
    return `种族·${r?.name ?? card.race}`;
  }
  if (id.startsWith('w_')) return '战士';
  if (id.startsWith('m_')) return '法师';
  if (id.startsWith('h_')) return '猎人';
  if (id.startsWith('t_')) return '旅行家';
  return '通用';
}

/** 卡牌的特殊机制，翻译成人话清单 */
function specialOf(c) {
  const s = [];
  if (c.hits > 1) s.push(`${c.hits} 段`);
  if (c.pierce) s.push('穿甲');
  if (c.exec != null) s.push(`斩杀（<${Math.round(c.exec * 100)}%）`);
  if (c.thorns != null) s.push('反伤');
  if (c.dmgPerPoison != null) s.push('每层毒加伤');
  if (c.amplifyPoison != null) s.push('毒层增幅');
  if (c.keepPoison) s.push('毒不衰减');
  if (c.scaleArmor != null) s.push('护甲转伤');
  if (c.consumeArmor) s.push('消耗护甲');
  if (c.exhaust) s.push('用后消耗');
  return s.join(' / ');
}

const playerCards = Object.entries(CARDS).map(([id, c]) => ({
  id,
  name: c.name,
  owner: ownerOf(id, c),
  kind: KIND_CN[c.kind] ?? c.kind,
  cost: c.cost,
  dmg: c.dmg ?? 0,
  hits: c.hits ?? 1,
  block: c.block ?? 0,
  heal: c.heal ?? 0,
  poison: c.poison ?? 0,
  weak: c.weak ?? 0,
  draw: c.draw ?? 0,
  energy: c.energy ?? 0,
  strength: c.strength ?? 0,
  special: specialOf(c),
  text: cardText(id, 10),
  textMax: cardText(`${id}+${MAX_FORGE_LEVEL}`, 10),
}));

/* ---------------- 敌人行动牌 ---------------- */

const enemyCards = Object.entries(ENEMY_CARDS).map(([id, c]) => ({
  id,
  name: c.name,
  cost: c.cost,
  dmg: c.dmg ?? 0,
  hits: c.hits ?? 1,
  block: c.block ?? 0,
  healPct: c.heal ?? 0,
  weak: c.weak ?? 0,
  drain: c.drainEnergy ?? 0,
  charge: c.charge ?? 0,
  strength: c.strength ?? 0,
  purge: c.purge ? '是' : '',
  text: enemyCardText(id, 10, 100),
}));

/* ---------------- 宝物 ---------------- */

/** 职业自带 / 种族携带 / 三选一 */
function relicSource(id) {
  const fromClass = CLASS_IDS.filter((c) => CLASSES[c].relic === id).map((c) => CLASSES[c].name);
  const fromRace = RACE_IDS.filter((r) => RACES[r].relics.includes(id)).map((r) => RACES[r].name);
  const parts = [];
  if (fromClass.length) parts.push(`职业自带（${fromClass.join('/')}）`);
  if (fromRace.length) parts.push(`种族携带（${fromRace.join('/')}）`);
  if (!parts.length) parts.push('三选一');
  else parts.push('也可三选一');
  return parts.join('，');
}

const relics = Object.entries(RELICS).map(([id, r]) => ({
  id,
  name: r.name,
  chain: `${r.chain} · ${CHAINS[r.chain]}`,
  text: r.text,
  /** v3.12：可升级宝物的 1~5 级数值，一行写全，资料表里好对照 */
  levels: r.levels ? r.levels.map((v, i) => `Lv.${i + 1} ${r.describe(v)}`).join(' / ') : '',
  value: RELIC_VALUE[id] ?? '',
  source: relicSource(id),
}));

/* ---------------- 敌人模板 ---------------- */

const deckText = (deck) => {
  const m = new Map();
  for (const k of deck) m.set(k, (m.get(k) || 0) + 1);
  return [...m.entries()].map(([k, n]) => `${ENEMY_CARDS[k]?.name ?? k}×${n}`).join(' / ');
};

const enemyTemplates = [
  ...ENEMY_POOL.map((t) => ({
    id: t.id, name: t.name, tier: '普通',
    hpMul: t.hpMul, atkMul: t.atkMul,
    deckSize: t.deck.length, deck: deckText(t.deck),
    core: `${CORE_TRAITS[t.id]?.name ?? ''}（${CORE_TRAITS[t.id]?.text ?? ''}）`,
    floors: '随机',
  })),
  ...BOSS_POOL.map((t, i) => ({
    id: t.id, name: t.name, tier: '首领',
    hpMul: t.hpMul, atkMul: t.atkMul,
    deckSize: t.deck.length, deck: deckText(t.deck),
    core: `${CORE_TRAITS[t.id]?.name ?? ''}（${CORE_TRAITS[t.id]?.text ?? ''}）`,
    floors: `第 ${BOSS_FLOORS[i]} 层`,
  })),
];

/* ---------------- 词条 ---------------- */

/** 核心词条挂在哪个模板上 */
const coreOwner = new Map();
for (const t of [...ENEMY_POOL, ...BOSS_POOL]) coreOwner.set(CORE_TRAITS[t.id]?.id, t.name);

const traits = [
  ...Object.values(CORE_TRAITS).map((t) => ({
    id: t.id, name: t.name, kind: '核心', owner: coreOwner.get(t.id) ?? '',
    family: t.key, type: t.kind, value: t.value ?? '',
    extra: [t.scale != null ? `scale=${t.scale}` : '', t.every != null ? `every=${t.every}` : ''].filter(Boolean).join('，'),
    power: '',
    text: t.text,
  })),
  ...Object.values(MUTATIONS).map((t) => ({
    id: t.id, name: t.name, kind: '变异', owner: '任意（同 key 不叠加）',
    family: t.key, type: t.kind, value: t.value ?? '',
    extra: [t.scale != null ? `scale=${t.scale}` : '', t.every != null ? `every=${t.every}` : ''].filter(Boolean).join('，'),
    power: t.power,
    text: t.text,
  })),
];

/* ---------------- 职业 / 种族 / 组合 ---------------- */

const classes = CLASS_IDS.map((id) => {
  const c = CLASSES[id];
  const g = GROWTH[id];
  return {
    id, name: c.name, tag: c.tag, desc: c.desc,
    hp: c.baseHp, atk: c.baseAtk,
    def: c.stats.def, crit: c.stats.crit, dodge: c.stats.dodge, recovery: c.stats.recovery,
    growth: g.text,
    perk: c.perkText,
    relic: RELICS[c.relic]?.name ?? c.relic,
    core: c.core.map((k) => CARDS[k].name).join(' + '),
    poolSize: c.pool.length,
  };
});

const races = RACE_IDS.map((id) => {
  const r = RACES[id];
  /**
   * v2.2：种族天赋全部机制化，直接读 `desc`（它已经写着机制文案），
   * 不再从 perk 字段拼数值乘区 —— 拼出来的"最大生命 ×1.25"已经不存在了。
   * v3.88：仍然读 `perk.hpMul / atkMul` 是为了**证明它现在是 1.0** ——
   * 种族只给命数 / 被动 / 卡 / 宝物，不给属性乘区。资料表要把这件事写明白，
   * 免得下一个人去改一个根本没人读的字段。
   */
  return {
    id, name: r.name, lives: `${LIVES_MIN}~${LIVES_MAX}`, desc: r.desc,
    perk: r.desc,
    hpMul: r.perk?.hpMul ?? 1,
    atkMul: r.perk?.atkMul ?? 1,
    relics: r.relics.map((k) => RELICS[k].name).join(' + '),
    card: CARDS[r.card].name,
    cardId: r.card,
  };
});

/* ---------------- 初始属性范围 ---------------- */

/**
 * 招募时的**真实取值区间**（v3.88 新增）。
 *
 * 用户问的是"种族初始属性范围"，但种族其实不参与属性乘区 —— 真正决定数值的是
 * **职业基准 × (±8% 生命/攻击) × (面板 ±1) × (能量 4~6 掷点)**，种族只改命数。
 * 所以这里按 16 种组合逐个算出区间，让人一眼看到"招到这个人最差/最好是多少"，
 * 而不是在一张只写种族命数的表里找不存在的东西。
 */
const combos = [];
const statRanges = [];
for (const classId of CLASS_IDS) {
  const cls = CLASSES[classId];
  for (const raceId of RACE_IDS) {
    const race = RACES[raceId];
    const ch = buildCharacter(classId, raceId);
    combos.push({
      name: ch.name,
      classId: cls.name,
      raceId: race.name,
      hp: ch.maxHp,
      atk: ch.atk,
      def: ch.stats.def,
      crit: ch.stats.crit,
      dodge: ch.stats.dodge,
      recovery: ch.stats.recovery,
      lives: `${LIVES_MIN}~${LIVES_MAX}`,
      rating: ratingOf({ ...ch, level: 1, knowledge: 0, luck: 0 }),
      deckSize: ch.deck.length,
    });

    const hpBase = cls.baseHp * (race.perk?.hpMul ?? 1);
    const atkBase = cls.baseAtk * (race.perk?.atkMul ?? 1);
    const lo = (v) => Math.max(1, Math.round(v * (1 - ROLL_RANGE)));
    const hi = (v) => Math.max(1, Math.round(v * (1 + ROLL_RANGE)));
    const panel = (v) => (v <= 0 ? '0~1' : `${Math.max(0, v - 1)}~${v + 1}`);
    statRanges.push({
      name: ch.name,
      classId: cls.name,
      raceId: race.name,
      hpMin: lo(hpBase), hpMax: hi(hpBase), hpExp: ch.maxHp,
      atkMin: lo(atkBase), atkMax: hi(atkBase), atkExp: ch.atk,
      def: panel(cls.stats.def),
      crit: panel(cls.stats.crit),
      dodge: panel(cls.stats.dodge),
      recovery: panel(cls.stats.recovery),
      energy: `${ENERGY_MIN}~${ENERGY_MAX}`,
      lives: `${LIVES_MIN}~${LIVES_MAX}`,
    });
  }
}

/* ---------------- 天赋 ---------------- */

/** 额外天赋被哪几份委托当奖励 */
const talentPools = new Map();
for (const [qid, q] of Object.entries(QUESTS)) {
  for (const tid of q.pool) {
    if (!talentPools.has(tid)) talentPools.set(tid, []);
    talentPools.get(tid).push(q.name);
  }
}

const talents = [
  ...RACE_IDS.map((id) => {
    const r = RACES[id];
    /** desc 形如「磐石：战斗开始…」，冒号前就是天赋名 */
    const [talentName, ...rest] = String(r.desc).split('：');
    return {
      id: `race_${id}`, kind: '种族天赋', owner: r.name, name: talentName, icon: '🧬',
      text: rest.length ? rest.join('：') : r.desc, pools: '',
      note: `命数 ${LIVES_MIN}~${LIVES_MAX}（招募掷定）；专属卡「${CARDS[r.card].name}」；携带 ${r.relics.map((k) => RELICS[k].name).join(' + ')}`,
    };
  }),
  ...CLASS_IDS.map((id) => {
    const c = CLASSES[id];
    return {
      id: `class_${id}`, kind: '职业天赋', owner: c.name, name: c.tag, icon: '⚔',
      text: c.perkText, pools: '', note: `自带宝物「${RELICS[c.relic]?.name ?? c.relic}」`,
    };
  }),
  ...Object.entries(EXTRA_TALENTS).map(([id, t]) => ({
    id, kind: '委托额外', owner: '完成委托后随机 1 枚', name: t.name, icon: t.icon,
    text: t.text, pools: (talentPools.get(id) || []).join(' / '),
    note: '只在本局生效（run-only），不写回角色',
  })),
];

/* ---------------- 委托 ---------------- */

const quests = Object.entries(QUESTS).map(([id, q]) => ({
  id, name: q.name, goal: q.goal, target: q.target, text: q.text,
  goalLabel: q.goalLabel, reward: q.reward,
  floors: `第 1~${QUEST_MAX_FLOOR} 层`,
  perRun: QUEST_MAX_PER_RUN,
  pool: q.pool.map((t) => EXTRA_TALENTS[t]?.name ?? t).join(' / '),
  poolDetail: q.pool.map((t) => `${EXTRA_TALENTS[t]?.name ?? t}（${EXTRA_TALENTS[t]?.text ?? ''}）`).join('；'),
}));

/* ---------------- 机制字典 ---------------- */

/**
 * 卡牌 / 战斗里所有"会改数值的字段"的字典（v3.88）。
 *
 * 存在的理由：用户要"所有机制"一栏，而机制散落在 CARDS 的字段名里 ——
 * 表格既要能读，又不能与代码脱钩。所以 **只写字段名 + 口径**，
 * 「张数」这一列由 CARDS 现场统计，改完牌就自动变。
 */
const MECH_DEFS = [
  ['卡牌', 'cost', '费用', '点', '打出这张牌要花的能量；每回合能量回满到角色上限（4~6）'],
  ['卡牌', 'dmg', '伤害', '× 攻击力', '基础伤害倍率，与攻击力相乘后再走护甲/暴击/虚弱'],
  ['卡牌', 'hits', '段数', '段', '多段攻击：每段独立结算护甲与暴击'],
  ['卡牌', 'block', '护甲', '× 攻击力', '获得护甲，战斗内跨回合保留，战斗结束清零'],
  ['卡牌', 'heal', '治疗', '× 攻击力', '回复生命，上限为最大生命'],
  ['卡牌', 'draw', '抽牌', '张', '立即抽牌；手牌上限 8，超出不再抽'],
  ['卡牌', 'energy', '获得能量', '点', '当回合可用；超过上限的部分也保留到回合末'],
  ['卡牌', 'poison', '中毒', '层', '每层每回合结束扣 1 点生命，层数 +1 后 -1；吃知识放大'],
  ['卡牌', 'weak', '虚弱', '回合', '目标伤害 -25%，持续 N 回合'],
  ['卡牌', 'strength', '力量', '点', '本场战斗攻击力加成（战斗结束清零）'],
  ['卡牌', 'thorns', '荆棘', '层', '本场获得荆棘层数：每次受击反弹等同层数的伤害'],
  ['卡牌', 'pierce', '穿甲', '开关', '无视目标护甲，直接打生命'],
  ['卡牌', 'exec', '斩杀', '比例', '目标生命低于该比例时伤害 ×2'],
  ['卡牌', 'dmgPerPoison', '每层毒加伤', '× 攻击力/层', '目标每有 1 层中毒，本卡额外 +(该值×攻击力)'],
  ['卡牌', 'amplifyPoison', '毒层增幅', '比例', '目标中毒层数 ×(1+该值)'],
  ['卡牌', 'keepPoison', '毒不衰减', '开关', '本场战斗内目标中毒不再自然衰减'],
  ['卡牌', 'scaleArmor', '护甲转伤', '× 攻击力/点', '每点当前护甲额外 +(该值×攻击力) 伤害'],
  ['卡牌', 'consumeArmor', '消耗护甲', '开关', '打出时消耗全部护甲（通常配合护甲转伤）'],
  ['卡牌', 'costHp', '生命代价', '比例', '失去该比例×最大生命的血量，最低留 1'],
  ['卡牌', 'energyPenalty', '能量代价', '点', '下回合能量 -N'],
  ['卡牌', 'discardRandom', '弃牌代价', '张', '打出后随机弃 N 张手牌'],
  ['卡牌', 'perAttack', '连击', '× 攻击力/张', '本回合每打出过 1 张攻击牌，额外 +(该值×攻击力)'],
  ['卡牌', 'cleanseBlock', '净化', '× 攻击力/张', '移除手牌所有「伤口」，每张给该值×攻击力护甲'],
  ['卡牌', 'unplayable', '不可打出', '开关', '状态牌（伤口）：占手牌位，回合末进消耗堆'],
  ['卡牌', 'exhaust', '消耗', '开关', '打出后本场移除，不进弃牌堆'],
  ['战斗', 'armor', '护甲（状态）', '点', '每点 -1% 直接伤害；跨回合保留'],
  ['战斗', 'crit', '暴击', '%', '每点 +1% 暴击率，暴击伤害 ×1.5；上限 50'],
  ['战斗', 'dodge', '闪避', '%', '每点 +1% 闪避；上限 30'],
  ['战斗', 'def', '防御', '点', '每点 -1% 受到的伤害；上限 40'],
  ['战斗', 'recovery', '恢复', '点', '每点每场战斗胜利回 1 HP'],
  ['战斗', 'knowledge', '知识', '%', '每点 +1% 印记（中毒/虚弱）叠加量'],
  ['战斗', 'luck', '幸运', '%', '只影响宝物出现权重与合成材料，不做暴击闪避'],
  ['战斗', 'enrage', '狂暴', '回合', '战斗超过 12 回合后，敌人每回合攻击 +15%'],
  ['战斗', 'turnPayoff', '收势', '机制', '回合末按「本回合摸进来 - 本回合打出去」的牌数结算收势牌'],
  ['战斗', 'combo', '连携', '机制', '铺垫牌 → 兑现牌：兑现牌在上回合/本回合铺垫过之后才有额外效果'],
  ['敌人', 'charge', '蓄势', '倍率', '本卡伤害 ×该倍率（通常高费）'],
  ['敌人', 'drainEnergy', '削能量', '点', '玩家下回合能量 -N'],
  ['敌人', 'purge', '清除负面', '开关', '清掉自身中毒/虚弱等减益'],
  ['敌人', 'trait_core', '核心词条', '词条', '每个模板固定 1 条，决定这只怪的身份'],
  ['敌人', 'trait_mutation', '变异词条', '词条', '随机附加：普通 1 条，精英/首领 2 条，同 key 不叠加'],
];

const mechanics = MECH_DEFS.map(([group, key, name, unit, text], i) => {
  const cardCount = Object.values(CARDS).filter((c) => {
    /** cost 是每张牌都有的，0 费也是有效值，不能按"非 0"筛掉 */
    if (key === 'cost') return c.cost != null;
    const v = c[key];
    return v != null && v !== false && v !== 0;
  }).length;
  /** trait_* 是词条不是敌人牌字段，别去数敌人牌 */
  const enemyCount = key.startsWith('trait_') ? '' : Object.values(ENEMY_CARDS).filter((c) => {
    const v = c[key];
    return v != null && v !== false && v !== 0;
  }).length;
  return {
    idx: i + 1, group, key, name, unit, text,
    cards: group === '卡牌' ? cardCount : '',
    enemies: group === '敌人' ? enemyCount : '',
  };
});

/* ---------------- 数值常量 ---------------- */

const constants = [
  { group: '战斗', key: '每回合能量上限', value: `${ENERGY_MIN}~${ENERGY_MAX}（招募掷定）`, note: 'v3.58 起是角色属性，v3.87 从 5~8 收紧；旧档/桩退回 6' },
  { group: '战斗', key: '手牌上限', value: HAND_LIMIT, note: '超过则不再抽' },
  { group: '战斗', key: '每回合抽牌', value: DRAW_PER_TURN, note: 'v3.87：回合末**不弃手牌**，回合开始只补抽到该张数（箭袋可 +1）' },
  { group: '战斗', key: '0 费准入白名单', value: 'unplayable / draw / energy / costHp / energyPenalty / exhaust', note: 'v3.87：8 张纯产出牌 0→1 费，其余不给 0 费' },
  { group: '战斗', key: '合成规则', value: '两张同名**同等级** → 下一级', note: 'v3.87 明确：+0 与 +1 不可合；卡组 -1 张，产出 1 材料' },
  { group: '战斗', key: '卡组上限', value: '无', note: 'v1.3 移除；仅同名卡最多 2 张' },
  { group: '战斗', key: '单卡强化上限', value: MAX_FORGE_LEVEL, note: `每级 +${FORGE_STEP * 100}% 基础值` },
  { group: '战斗', key: '暴击伤害', value: 1.5, note: '固定倍率，只作用于玩家攻击牌' },
  { group: '战斗', key: '防御上限', value: 40, note: '每点 -1% 直接伤害' },
  { group: '战斗', key: '暴击率上限', value: 50, note: '每点 +1%' },
  { group: '战斗', key: '闪避上限', value: 30, note: '每点 +1%' },
  { group: '战斗', key: '恢复', value: 1, note: '每点每场胜利回 1 HP' },
  { group: '战斗', key: '知识', value: 0.01, note: '每点 +1% 印记（中毒/虚弱）叠加' },
  { group: '战斗', key: '幸运宝物加成上限', value: 40, note: '叠加到宝物出现权重' },

  { group: '敌人曲线', key: '第 1 层基础生命', value: CURVE.hpBase, note: '此后每层 ×1.045' },
  { group: '敌人曲线', key: '第 1 层基础攻击', value: CURVE.atkBase, note: `此后每层 +${CURVE.atkPerFloor}（与玩家同一套 +1%/点）` },
  { group: '敌人曲线', key: '精英生命倍率', value: CURVE.eliteHpMul, note: `第 ${ELITE_FLOORS.join('/')} 层` },
  { group: '敌人曲线', key: '精英伤害倍率', value: CURVE.eliteDmgMul, note: '同上（乘伤害，不乘攻击力）' },
  { group: '敌人曲线', key: '首领生命倍率', value: CURVE.bossHpMul, note: `第 ${BOSS_FLOORS.join('/')} 层` },
  { group: '敌人曲线', key: '首领伤害倍率', value: CURVE.bossDmgMul, note: '同上（乘伤害，不乘攻击力）' },
  { group: '敌人曲线', key: '每回合能量', value: CURVE.enemyEnergy, note: '迅捷词条 +1' },
  { group: '敌人曲线', key: '每回合抽牌 / 手牌上限', value: `${CURVE.enemyDraw} / ${CURVE.enemyHandLimit}`, note: '出牌张数不限，只受能量约束（v3.64）' },
  { group: '敌人曲线', key: '词条威胁折算', value: CURVE.threatDamp, note: '每点威胁扣 55% 基础属性，下限 0.6' },
  { group: '敌人曲线', key: '狂暴回合', value: CURVE.enrageTurn, note: `超过后每回合攻击 +${CURVE.enragePct * 100}%` },
  { group: '敌人曲线', key: '塔层数', value: MAX_FLOOR, note: '第 30 层通关' },

  { group: '等级', key: '等级上限', value: MAX_LEVEL, note: '满级后经验清零' },
  { group: '等级', key: '升级所需经验', value: '10 + 等级×30', note: 'expToNext()' },
  { group: '等级', key: '单场经验', value: '18 + 层数×2', note: '精英 ×1.6，首领 ×2.5' },
  { group: '等级', key: '战士每级', value: GROWTH.warrior.value, note: '最大生命（含当前血量）' },
  { group: '等级', key: '法师每级', value: GROWTH.mage.value, note: '知识' },
  { group: '等级', key: '猎人每级', value: GROWTH.hunter.value, note: '攻击力' },
  { group: '等级', key: '旅行家每级', value: GROWTH.traveler.value, note: '幸运' },

  { group: '经济', key: '初始金币', value: START_GOLD, note: '' },
  { group: '经济', key: '招募价格', value: RECRUIT_COST, note: '每个候选' },
  { group: '经济', key: '刷新价格', value: REFRESH_COST, note: '只重掷已就绪席位' },
  { group: '经济', key: '每层探险金', value: GOLD_PER_FLOOR, note: '活着回来结算' },
  { group: '经济', key: '通关奖励', value: CLEAR_BONUS, note: '清完 30 层额外' },
  { group: '经济', key: '激活宝物材料', value: MATERIAL_PER_RELIC, note: '合成一次得 1 个材料' },
  { group: '经济', key: '竞技场基础奖励', value: ARENA_BASE, note: '' },
  { group: '经济', key: '竞技场评级系数', value: ARENA_PER_RATING, note: `奖励 = ${ARENA_BASE} + min(${ARENA_RATING_CAP}, 评级)×系数` },
  { group: '经济', key: '竞技场评级封顶', value: ARENA_RATING_CAP, note: '防止金币通胀' },
  { group: '经济', key: '竞技场每日次数', value: ARENA_MAX, note: '每人每天；0 点回满；试用期恒为 0' },
  { group: '经济', key: '广告单次奖励', value: AD_REWARD_GOLD, note: '看完激励视频才发' },
  { group: '经济', key: '广告每日上限', value: AD_DAILY_LIMIT, note: '本地自然日 0 点重置' },
  { group: '经济', key: '竞技场赛制血量', value: `×${ARENA_HP_MUL}`, note: '双方同一系数，不动相对强度' },
  { group: '经济', key: '后手补偿能量', value: SECOND_ENERGY, note: '只在第一次行动' },
  { group: '经济', key: '后手补偿抽牌', value: SECOND_DRAW, note: '只在第一次行动' },

  { group: '招募', key: '名额上限', value: RECRUIT_CAP, note: '一次只出一个候选，处理完才能再点' },
  { group: '招募', key: '名额恢复', value: `${RECRUIT_REGEN_MS / 60000} 分钟 +1`, note: '存满即停产，不做离线累积' },
  { group: '招募', key: '开局名额', value: RECRUIT_START, note: '新人第一件事是招人' },
  { group: '招募', key: '营地容量', value: `实习 ${PROBATION_LIMIT} · 转正 ${VETERAN_LIMIT}`, note: '两边分开算，互不挤占；不含已死角色' },
  { group: '招募', key: '属性浮动', value: '±8%', note: '生命/攻击；四项面板 ±1' },
  { group: '招募', key: '转正条件', value: '活着回来 1 次', note: '试用期只能进塔、不能进竞技场；转正后反过来：塔关闭、只能进竞技场' },

  { group: '奖励', key: '三选一权重', value: '卡牌 52 / 强化 22 / 宝物 22+幸运 / 治疗 14', note: '第一格强制卡牌；强化不给卡组加厚度' },
  { group: '奖励', key: '首领保底', value: '必出 1 件宝物', note: 'BOSS 层额外保证' },
  { group: '奖励', key: '难度递增', value: '1 + min(2.75, 探险次数×0.55)', note: '同一角色越爬越难' },
];

/* ---------------- 输出 ---------------- */

const catalog = {
  meta: {
    game: '残塔',
    version: BUILD,
    generatedAt: new Date().toISOString(),
    source: 'src/core/*.js',
  },
  playerCards,
  enemyCards,
  relics,
  enemyTemplates,
  traits,
  classes,
  races,
  combos,
  statRanges,
  talents,
  quests,
  mechanics,
  constants,
  leveling: Array.from({ length: MAX_LEVEL }, (_, i) => ({
    level: i + 1,
    need: expToNext(i + 1),
  })),
};

const out = resolve(ROOT, 'data/catalog.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(catalog, null, 2), 'utf8');

console.log(`已导出 ${out}`);
console.log(
  `玩家卡牌 ${playerCards.length} / 敌人牌 ${enemyCards.length} / 宝物 ${relics.length} / ` +
  `模板 ${enemyTemplates.length} / 词条 ${traits.length} / 职业 ${classes.length} / ` +
  `种族 ${races.length} / 组合 ${combos.length} / 常量 ${constants.length}`,
);
