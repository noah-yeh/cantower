/**
 * 敌人词条（trait）
 *
 * 两种：
 *   CORE_TRAITS —— 每个模板固定 1 个，决定身份。玩家看到名字就知道它要怎么打。
 *   MUTATIONS   —— 随机附加，普通怪 1 个 / 精英 2 个 / 首领 2 个。决定这一局的变化。
 *
 * 三条硬约束：
 *   1. 词条只描述效果，实现统一在 combat.js 的 applyTrait 里（按 kind 分派）。
 *      不把函数塞进数据，否则存档序列化会把它们全丢掉。
 *   2. 每个词条必须带 power（威胁值）。makeEnemy 会把它从基础 HP/ATK 里扣掉，
 *      保证「变异只改打法，不改难度」。
 *   3. 每个词条有 key（效果族），同 key 不叠加——否则两个「再生」叠一起会直接打不动。
 */

/** 核心词条：模板身份 */
export const CORE_TRAITS = {
  slime: { id: 'core_dissolve', name: '溶蚀', key: 'regen', kind: 'regen', value: 0.03, text: '每回合回复 3% 最大生命' },
  skeleton: { id: 'core_undying', name: '不散', key: 'revive', kind: 'revive', value: 0.3, text: '首次死亡时以 30% 生命复活' },
  wolf: { id: 'core_pack', name: '群猎', key: 'firstHit', kind: 'firstHit', value: 0.4, text: '每回合第一张攻击牌伤害 +40%' },
  gargoyle: { id: 'core_stone', name: '石肤', key: 'openArmor', kind: 'openArmor', value: 0.18, text: '开场获得 18% 最大生命的护甲' },
  spider: { id: 'core_web', name: '缚网', key: 'drainOnHit', kind: 'drainOnHit', value: 1, text: '每次命中使你下回合 -1 能量' },
  brute: { id: 'core_wrath', name: '暴怒', key: 'frenzy', kind: 'frenzy', value: 0.05, text: '每回合攻击 +5%' },
  wraith: { id: 'core_siphon', name: '吸髓', key: 'leech', kind: 'leech', value: 0.3, text: '造成伤害的 30% 转为自愈' },
  /**
   * 荆棘 / 尖刺（v3.52）：反弹改按**自身生命百分比**算，不再吃层数。
   * value 是本体生命（baseHp）的比例，不是固定点数。
   * 口径来源：旧曲线 3+0.4×层 / 2+0.3×层 折算成生命百分比正好是 3% / 2%，
   * 普通怪反弹量与旧版持平，层数差异交给怪物自己的生命成长。
   */
  guardian: { id: 'core_thorns', name: '荆棘', key: 'thorns', kind: 'thorns', value: 0.03, text: '受击时反弹自身生命 3% 的伤害' },
  flame: { id: 'core_blaze', name: '炽焰', key: 'pierceOnHit', kind: 'pierceOnHit', value: 0.25, text: '命中时额外造成 25% 穿甲伤害' },
  shade: { id: 'core_veil', name: '隐匿', key: 'armorEvery', kind: 'armorEvery', every: 3, value: 0.12, text: '每 3 回合获得 12% 最大生命的护甲' },

  boss_warden: { id: 'core_ironlaw', name: '铁律', key: 'armorPerTurn', kind: 'armorPerTurn', value: 0.3, text: '每回合获得 30% 攻击力的护甲' },
  boss_widow: { id: 'core_brood', name: '蛛后', key: 'weakOnHit', kind: 'weakOnHit', value: 1, text: '每次命中使你虚弱 1 回合' },
  boss_ruin: { id: 'core_decay', name: '崩解', key: 'frenzy', kind: 'frenzy', value: 0.06, text: '每回合攻击 +6%' },
};

/** 变异词条：随机附加 */
export const MUTATIONS = {
  mut_armored: { id: 'mut_armored', name: '覆甲', key: 'openArmor', kind: 'openArmor', value: 0.12, power: 0.1, text: '开场获得 12% 最大生命的护甲' },
  mut_regen: { id: 'mut_regen', name: '再生', key: 'regen', kind: 'regen', value: 0.035, power: 0.12, text: '每回合回复 3.5% 最大生命' },
  mut_thorns: { id: 'mut_thorns', name: '尖刺', key: 'thorns', kind: 'thorns', value: 0.02, power: 0.08, text: '受击时反弹自身生命 2% 的伤害' },
  mut_frenzy: { id: 'mut_frenzy', name: '暴怒', key: 'frenzy', kind: 'frenzy', value: 0.04, power: 0.1, text: '每回合攻击 +4%' },
  mut_leech: { id: 'mut_leech', name: '汲取', key: 'leech', kind: 'leech', value: 0.22, power: 0.1, text: '造成伤害的 22% 转为自愈' },
  mut_swift: { id: 'mut_swift', name: '迅捷', key: 'swift', kind: 'swift', value: 1, power: 0.14, text: '每回合能量 +1' },
  mut_ward: { id: 'mut_ward', name: '净念', key: 'purge', kind: 'purge', every: 3, power: 0.07, text: '每 3 回合清除自身虚弱并获得护甲' },
  mut_pierce: { id: 'mut_pierce', name: '剧毒', key: 'pierceOnHit', kind: 'pierceOnHit', value: 0.2, power: 0.12, text: '命中时额外造成 20% 穿甲伤害' },
  /**
   * 污染（v2.1）：命中往玩家抽牌堆塞「伤口」。
   * 它不扣血不扣能量，威胁来自"占手牌位"：伤口不可打出，抽到就废一手牌的容量。
   * power 偏低（0.05）——它是慢性威胁，对 2~3 回合的短战斗几乎无感，
   * 但逼着玩家在构筑里留一张「净化」的空间，这正是决策。
   */
  mut_curse: { id: 'mut_curse', name: '污染', key: 'curseOnHit', kind: 'curseOnHit', value: 1, power: 0.05, text: '每次命中把 1 张「伤口」混入你的抽牌堆' },
};

export const ALL_MUTATION_IDS = Object.keys(MUTATIONS);

/**
 * 抽变异词条。同 key 的不会同时出现，避免「双再生」这种直接锁死战斗的组合。
 * @param {object} core 该模板的核心词条
 * @param {number} count 要抽几个
 * @param {Rng} rng
 */
export function rollMutations(core, count, rng, avoid = []) {
  const used = new Set([core?.key, ...avoid]);
  const picked = [];

  for (let i = 0; i < count; i++) {
    const pool = ALL_MUTATION_IDS.filter((id) => {
      const m = MUTATIONS[id];
      return !used.has(m.key) && !picked.includes(id);
    });
    if (!pool.length) break;
    const id = rng.pick(pool);
    const m = MUTATIONS[id];
    used.add(m.key);
    picked.push(id);
  }

  return picked;
}

/** 词条威胁值合计，供 makeEnemy 反向折算基础属性 */
export function threatOf(core, mutationIds) {
  return mutationIds.reduce((s, id) => s + (MUTATIONS[id]?.power || 0), 0);
}
