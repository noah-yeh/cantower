/**
 * 宝物 —— 转化链是整局最大的爽点
 *
 * 三条链，每条链缺一环就不成立，这是构筑的取舍空间：
 *   A 叠甲永动：举盾叠甲 → 护甲换能量 → 更多举盾
 *   B 毒转盾：   叠毒 → 毒变护甲 → 护甲转毒爆
 *   C 法术循环： 消耗护甲回能量 → 法术加伤
 *
 * 钩子直接改 battle 状态。存档只存 id，运行时从 RELICS 解析。
 */

import { gainThorns } from './combat.js';
import { ENERGY_CAP, ENERGY_OVERCAP } from './leveling.js';

export const CHAINS = {
  A: '叠甲永动',
  B: '毒转盾',
  C: '法术循环',
  X: '通用',
};

/* ------------------------------------------------------------------ *
 * 基础属性宝物 · 1~5 级（v3.12）
 *
 * 用户："基础宝物可以有 1-5 级，加的属性不一样"。
 *
 * 只有这 6 件是**可升级**的：它们不改变玩法机制，只补面板（防御/闪避/暴击/
 * 攻击/知识/回复），所以"等级"就是纯数值缩放，不会把构筑搅乱。
 * 三条转化链（A/B/C）和机制型通用宝物仍然是单件、拿一次就满 ——
 * 那些东西的价值在于"连锁"，叠一层数值没有意义。
 *
 * 数值写在这里、文案由数值生成（项目硬性约定：不手写数值文案）。
 * 1 级 ≈ v3.11 的原数值，5 级约 2~3 倍 —— 深层掉一件能立刻感觉到。
 * ------------------------------------------------------------------ */

export const LEVELED_RELICS = {
  ironBracer: {
    name: '铁鳞护腕',
    stat: 'defFlat',
    values: [3, 4, 6, 8, 10],
    text: (v) => `防御 +${v}（每点减 1% 受到的伤害）`,
  },
  swiftBoots: {
    name: '疾风靴',
    stat: 'dodgeFlat',
    values: [4, 5, 7, 9, 12],
    text: (v) => `闪避 +${v}%`,
  },
  fangPendant: {
    name: '锐牙坠',
    stat: 'critFlat',
    values: [4, 5, 7, 9, 12],
    text: (v) => `暴击 +${v}%`,
  },
  powerGauntlet: {
    name: '巨力护腕',
    stat: 'atkFlat',
    values: [6, 8, 11, 14, 18],
    text: (v) => `攻击 +${v}`,
  },
  scholarNotes: {
    name: '学者手记',
    stat: 'knowledgeFlat',
    values: [3, 3, 4, 5, 7],
    text: (v) => `知识 +${v}（每点让印记多叠 1%）`,
  },
  mendingCharm: {
    name: '愈合护符',
    stat: 'recoveryFlat',
    values: [2, 3, 4, 5, 7],
    text: (v) => `战斗胜利后回复 ${v} 点生命`,
  },
  /**
   * v3.39 新增两件（用户：「增加两个基础宝物有5种不同等级，一个是加幸运，
   * 1级的＋2幸运，5级的可以增加10幸运，另外一个增加生命的宝物，1级的+5，
   * 每级+5，一直到5级的可以+25，水晶材料消耗都是3个」）：
   *   - 幸运：每级 +2，5 级 +10 —— 幸运抬宝物掉率（luckRelicBonus，上限 40），
   *     不改战斗数值，属于"越打越富"的线。
   *   - 生命：每级 +5，5 级 +25 —— 走 hpFlat（applyRelicStats 已支持：
   *     上限涨多少、当前血量跟着涨多少，不会"上限变高血条变稀"）。
   * 宝库价跟其他带等级件同口径：**等级 = 水晶数**（1~5 级 = 1~5 水晶），
   * 见 shop.js 的 leveledRelicPrice。
   */
  cloverCharm: {
    name: '四叶坠',
    stat: 'luckFlat',
    values: [2, 4, 6, 8, 10],
    text: (v) => `幸运 +${v}（幸运越高，越容易遇到宝物与稀有事件）`,
  },
  vitalHeart: {
    name: '血玉心坠',
    stat: 'hpFlat',
    values: [5, 10, 15, 20, 25],
    text: (v) => `生命上限 +${v}`,
  },
};

export const RELICS = {
  /* ---------------- 链 A · 叠甲永动 ---------------- */
  anvil: {
    name: '铁砧',
    chain: 'A',
    text: '回合开始时若你有护甲，获得 2 点能量',
    onTurnStart(b) {
      if (b.player.armor > 0) {
        b.player.energy += 2;
        b.notes.push('铁砧 +2 能量');
      }
    },
  },
  thornsVest: {
    name: '荆棘背心',
    chain: 'A',
    text: '战斗开始时获得 4 层荆棘（受击时反弹等量伤害）',
    /** v3.53：与牌面荆棘同口径 —— 给层数、吃知识，不再单独走「护甲 30%」 */
    onCombatStart(b) {
      gainThorns(b, 4);
    },
  },
  heavyWall: {
    name: '厚重壁垒',
    chain: 'A',
    text: '获得的护甲 +50%，但每回合开始时护甲 -20%',
    armorGain: 1.5,
    onTurnStart(b) {
      if (b.player.armor > 0) b.player.armor = Math.floor(b.player.armor * 0.8);
    },
  },

  /* ---------------- 链 B · 毒转盾 ---------------- */
  poisonGem: {
    name: '毒龙宝石',
    chain: 'B',
    text: '回合开始时，敌人每层毒为你提供 1 点护甲',
    onTurnStart(b) {
      if (b.enemy.poison > 0) {
        b.player.armor += b.enemy.poison;
        b.notes.push(`毒龙宝石 +${b.enemy.poison} 护甲`);
      }
    },
  },
  plantEssence: {
    name: '植物精华',
    chain: 'B',
    text: '你施加的中毒层数 +2',
    poisonBonus: 2,
  },
  woodDragonShield: {
    name: '木龙盾',
    chain: 'B',
    text: '回合结束时，若护甲 ≥ 15，将一半护甲转化为等量 ×1.5 的中毒',
    onTurnEnd(b) {
      if (b.player.armor >= 15) {
        const half = Math.floor(b.player.armor / 2);
        b.player.armor -= half;
        const add = Math.round(half * 1.5);
        b.enemy.poison += add;
        b.notes.push(`木龙盾 ${half} 护甲 → ${add} 中毒`);
      }
    },
  },

  /* ---------------- 链 C · 法术循环 ---------------- */
  energyHam: {
    name: '能量火腿',
    chain: 'C',
    text: '每消耗 10 点护甲，回复 3 点能量',
    onArmorSpent(b, spent) {
      const gain = Math.floor(spent / 10) * 3;
      if (gain > 0) {
        b.player.energy += gain;
        b.notes.push(`能量火腿 +${gain} 能量`);
      }
    },
  },
  /**
   * v3.62 星辉烛台：第一件**永久加能量上限**的宝物。
   * 出现权重压到 0.35（普通件是 1），加上全局硬顶 10 ——
   * 用户要求"大部分卡组最后不超过 10 能量"，它是拼图的普通一块。
   */
  starCandle: {
    name: '星辉烛台',
    chain: 'C',
    text: `能量上限 +1（最多堆到 ${ENERGY_CAP}）`,
    energyFlat: 1,
  },
  /**
   * v3.62 月苔圣杯：**种族专属**的唯一破顶件（青苔族）。
   * 青苔被动是"回合结束剩余能量转护甲"，能量对它有双重价值 ——
   * 别的种族连看到它的机会都没有（出池时过滤，见 relicAvailableFor）。
   * energyOvercap 让它突破 10 硬顶、最高 12。
   */
  moonChalice: {
    name: '月苔圣杯',
    chain: 'X',
    race: 'moss',
    text: `青苔族专属 · 能量上限 +2（可突破至 ${ENERGY_OVERCAP}）`,
    energyFlat: 2,
    energyOvercap: true,
  },
  expEye: {
    name: '实验之眼',
    chain: 'C',
    text: '每打出 3 张牌，抽 1 张',
    onCardPlayed(b) {
      /**
       * v3.50：这里以前自己也 `++` 了一次 —— 而 `playCard` 已经加过，于是带这件
       * （法师起手就带）时 cardsPlayed 永远是偶数，「法术循环」每张牌都回 1 能量。
       * 玩家看到的就是"能量对不上账"：0 费牌打完 +1、1 费牌不消耗、2 费牌只扣 1。
       * 宝物的钩子只**读**计数，不再改它。
       */
      if (b.cardsPlayed % 3 === 0) {
        b.pendingDraw += 1;
        b.notes.push('实验之眼 +1 抽牌');
      }
    },
  },
  moltenCore: {
    name: '熔火核心',
    chain: 'C',
    text: '攻击牌伤害 +30%，但获得的护甲 -50%',
    dmgBonus: 1.3,
    armorGain: 0.5,
  },

  /* ---------------- 通用 ---------------- */
  ironRing: {
    name: '铁环',
    chain: 'X',
    text: '最大生命 +18',
    hpFlat: 18,
  },
  whetstone: {
    name: '磨石',
    chain: 'X',
    text: '攻击 +10%',
    atkPct: 0.1,
  },
  herbPouch: {
    name: '药囊',
    chain: 'X',
    text: '每进入新一层，回复 6% 最大生命',
    floorHeal: 0.06,
  },
  quiver: {
    name: '箭袋',
    chain: 'X',
    text: '每回合开始额外抽 1 张牌',
    drawBonus: 1,
  },
  /**
   * v3.82：抽牌降到 5 之后，「多抽一张」的价值明显变高，
   * 所以再补一件同机制的通用宝物 —— 让"靠宝物堆抽牌"成为一条真的支线
   * （两件都拿到 = 每回合 7 张，逼近 8 格手牌上限）。
   */
  codex: {
    name: '谋略之卷',
    chain: 'X',
    text: '每回合开始额外抽 1 张牌',
    drawBonus: 1,
  },
  boneCharm: {
    name: '骨符',
    chain: 'X',
    text: '战斗开始时获得 8 点护甲',
    onCombatStart(b) {
      b.player.armor += 8;
    },
  },
  emberStone: {
    name: '余烬石',
    chain: 'X',
    text: '击杀敌人后回复 10% 最大生命',
    onEnemyKilled(b) {
      const heal = Math.round(b.player.maxHp * 0.1);
      b.player.hp = Math.min(b.player.maxHp, b.player.hp + heal);
      b.notes.push(`余烬石回复 ${heal}`);
    },
  },
  thornRing: {
    name: '荆棘指环',
    chain: 'X',
    text: '每回合开始时获得 3 点护甲',
    onTurnStart(b) {
      b.player.armor += 3;
    },
  },

  /* ---------------- 通用 · 基础属性（v3.11，v3.12 起 1~5 级） ----------------
   * 原来的 X 链全是"机制型"（抽牌、护甲、回血），**没有一件直接加面板**，
   * 而面板四项（防御/暴击/闪避/回复）在整局里只能靠升级那一点点。
   * 这一组把面板补上，并且带等级：见文件顶部的 LEVELED_RELICS。
   *
   * 上限由 leveling.js 的 DEF_CAP / CRIT_CAP / DODGE_CAP 在战斗内夹住。
   */
  ...Object.fromEntries(
    Object.entries(LEVELED_RELICS).map(([id, d]) => [id, {
      name: d.name,
      chain: 'X',
      /** 有 levels 就是"可升级"标记，别处一律用 relicAt() 取值 */
      levels: d.values,
      statKey: d.stat,
      describe: d.text,
      /** 1 级文案：图鉴、未指定等级的地方用它 */
      text: d.text(d.values[0]),
    }]),
  ),
};

/* ------------------------------------------------------------------ *
 * 等级存取（v3.12）
 *
 * 存档里宝物还是一条字符串，等级写成后缀（`ironBracer+3`），
 * 和卡片的 `strike+2` 是同一套写法 —— 好处是旧存档（纯 id）天然等价于 1 级，
 * 不需要给 RUN_SAVE_VERSION 加迁移分支。
 * ------------------------------------------------------------------ */

export const RELIC_MAX_LV = 5;

export function parseRelic(key) {
  const s = String(key ?? '');
  const i = s.lastIndexOf('+');
  if (i > 0) {
    const lv = Number(s.slice(i + 1));
    if (Number.isFinite(lv) && lv > 1) {
      return { id: s.slice(0, i), lv: Math.min(RELIC_MAX_LV, Math.round(lv)) };
    }
  }
  return { id: s, lv: 1 };
}

export function relicKey(id, lv = 1) {
  const L = Math.max(1, Math.min(RELIC_MAX_LV, Math.round(lv)));
  return L > 1 ? `${id}+${L}` : id;
}

/** 手上这件宝物现在是几级（0 = 没有） */
export function relicLvOf(keys = [], id) {
  let lv = 0;
  for (const k of keys) {
    const p = parseRelic(k);
    if (p.id === id) lv = Math.max(lv, p.lv);
  }
  return lv;
}

/** 已拥有的 id 集合 —— 判重看 id，不看等级 */
export function ownedRelicIds(keys = []) {
  return new Set(keys.map((k) => parseRelic(k).id));
}

/**
 * 取"某个等级的那件宝物"。
 *
 * 非等级宝物原样返回（里面的回调函数必须还是同一个对象）；
 * 等级宝物返回一份带上当前数值的拷贝，`applyRelicStats` 与 UI 都读它。
 */
export function relicAt(id, lv = 1) {
  const base = RELICS[id];
  if (!base) return null;
  if (!base.levels) return base;
  const L = Math.max(1, Math.min(RELIC_MAX_LV, Math.round(lv)));
  const v = base.levels[L - 1];
  return { ...base, lv: L, value: v, text: base.describe(v), [base.statKey]: v };
}

/**
 * 这一层掉落的宝物该是几级。
 *
 * 上限随层数抬（1 层 1 级、21 层起 5 级），再随机往回掉一级 ——
 * 目的是"越深越强"看得见，同时让同层的两件宝物有高下之分。
 */
export function relicLevelFor(floor = 1, rng = null) {
  const cap = Math.min(RELIC_MAX_LV, 1 + Math.floor((Math.max(1, floor) + 3) / 6));
  const drop = rng ? rng.int(2) : 0;
  return Math.max(1, cap - drop);
}

/**
 * 拿到这件宝物之后会是几级。UI 用它写"Lv.2 → Lv.3"，规则只有这一份。
 * @param {number} ownedLv 手上已有的等级（0 = 没有）
 */
export function nextRelicLv(ownedLv, lv = 1) {
  const want = Math.max(1, Math.min(RELIC_MAX_LV, Math.round(lv)));
  if (ownedLv <= 0) return want;
  /** 已拥有时至少 +1 级：抽到低等级的重复件不是"白拿"，而是"往前挪一格" */
  return Math.min(RELIC_MAX_LV, Math.max(want, ownedLv + 1));
}

/**
 * 把一件宝物给到持有者（run 或角色）。**重复获得 = 升级**，不会叠成两件。
 *
 * @param {{relics: string[], player?: object}} holder
 * @returns {null | {ok:boolean, id, lv, key, from, to, up, reason?}}
 */
export function grantRelic(holder, id, lv = 1) {
  const base = RELICS[id];
  if (!base || !holder?.relics) return null;
  const relics = holder.relics;
  const player = holder.player || null;
  const cur = relicLvOf(relics, id);

  if (!base.levels) {
    if (cur > 0) return { ok: false, id, lv: 1, reason: '这件宝物已经有了' };
    relics.push(id);
    if (player) applyRelicStats(player, base);
    return { ok: true, id, lv: 1, key: id, from: 0, to: 1, up: false };
  }

  const to = nextRelicLv(cur, lv);
  const key = relicKey(id, to);
  const at = relics.findIndex((k) => parseRelic(k).id === id);
  if (at >= 0) relics[at] = key;
  else relics.push(key);

  if (player) {
    const fromVal = cur ? base.levels[cur - 1] : 0;
    applyRelicStats(player, { [base.statKey]: base.levels[to - 1] - fromVal });
  }
  return { ok: true, id, lv: to, key, from: cur, to, up: cur > 0 };
}

export const ALL_RELIC_IDS = Object.keys(RELICS);

/**
 * 宝物出现权重（v3.62）。默认 1；压低的件就是"稀有货"。
 * 宝库货架和战后三选一都按这个权重掷，掷法走 rng.weighted。
 * 星辉烛台 / 月苔圣杯 0.35 —— 用户要求能量途径"概率不要太大"。
 */
export const RELIC_RARITY = {
  starCandle: 0.35,
  moonChalice: 0.35,
};

export function relicRarity(id) {
  return RELIC_RARITY[id] ?? 1;
}

/** 按 rarity 权重从候选里挑一件；空池返回 null */
export function pickRelicByRarity(rng, ids) {
  if (!ids?.length) return null;
  return rng.weighted(Object.fromEntries(ids.map((id) => [id, relicRarity(id)])));
}

/**
 * 种族专属件的出池门槛（v3.62）：没有 race 字段的全民可见；
 * 有 race 的只对该种族出池 —— 别的种族在宝库 / 三选一里根本刷不到它，
 * 不是"看到也买不了"，是压根不出现。
 */
export function relicAvailableFor(id, raceId) {
  const base = RELICS[id];
  return !base?.race || base.race === raceId;
}

/**
 * 把存档里的 key 数组解析成"当前等级的宝物对象"数组。
 * 纯 id（旧存档、种族宝物）等价于 1 级。
 */
export function resolveRelics(keys = []) {
  return keys
    .map((k) => {
      const { id, lv } = parseRelic(k);
      return relicAt(id, lv);
    })
    .filter(Boolean);
}

/**
 * 把「面板型宝物」的加成落进数值。
 *
 * **这是 v1.2 修的一个真 bug**：铁环写着「最大生命 +18」、磨石写着「攻击 +10%」，
 * 但 `hpFlat` / `atkPct` 这两个字段从来没被任何代码读过 —— 玩家选了以后
 * 只看到一行字，血量、攻击一点没变。卡面上的承诺必须由代码兑现。
 *
 * 为什么在"获得时"应用、而不是每次建 run 时重算：
 * 活着回来会把 run.player.maxHp 写回角色（宝物是永久资产），
 * 如果每次进塔再加一遍 +18，就会每进一次多 18 点，滚成天文数字。
 * 所以规则是「获得时加一次」—— 阵亡回滚到 initial，加的那次自然一起没了。
 */
export function applyRelicStats(player, relic) {
  if (!player || !relic) return;
  if (relic.hpFlat) {
    player.maxHp += relic.hpFlat;
    /** 上限涨了，当前血量跟着涨同样的量，否则等于是"上限变高、血条变稀" */
    player.hp = Math.min(player.maxHp, (player.hp || 0) + relic.hpFlat);
  }
  if (relic.atkPct) {
    player.atk = Math.round(player.atk * (1 + relic.atkPct));
  }
  if (relic.atkFlat) {
    player.atk += relic.atkFlat;
  }
  /**
   * 面板四项 + 知识（v3.11）：字段必须在这里落地，不能只写在宝物文案里 ——
   * v1.2 就是栽在"文案写了、代码没读"上。夹上限交给 combat（它本来就会夹）。
   */
  if (relic.defFlat) player.def = (player.def || 0) + relic.defFlat;
  if (relic.critFlat) player.crit = (player.crit || 0) + relic.critFlat;
  if (relic.dodgeFlat) player.dodge = (player.dodge || 0) + relic.dodgeFlat;
  if (relic.knowledgeFlat) player.knowledge = (player.knowledge || 0) + relic.knowledgeFlat;
  if (relic.recoveryFlat) player.recovery = (player.recovery || 0) + relic.recoveryFlat;
  /** v3.39：幸运（抬宝物掉率，luckRelicBonus 在 leveling.js，上限 40） */
  if (relic.luckFlat) player.luck = (player.luck || 0) + relic.luckFlat;
  /**
   * v3.62：能量上限。普通件夹在 ENERGY_CAP（10）；带 energyOvercap 的
   * 种族专属件（月苔圣杯）夹在 ENERGY_OVERCAP（12）。
   * 战斗中激活时 player 是 battle.player，它带 energyCap —— 一起抬，
   * 否则下回合 startTurn 又按旧 cap 回能，等于白拿。
   */
  if (relic.energyFlat) {
    const top = relic.energyOvercap ? ENERGY_OVERCAP : ENERGY_CAP;
    /**
     * 只有低于各自上限时才加 —— 青苔族破到 12 后再拿普通件（top=10）
     * 不许把 12 砍回 10；到顶的再拿同款也是白拿。
     */
    if ((player.energy || 0) < top) {
      player.energy = Math.min(top, (player.energy || 0) + relic.energyFlat);
    }
    if (player.energyCap != null && player.energyCap < top) {
      player.energyCap = Math.min(top, player.energyCap + relic.energyFlat);
    }
  }
}

/**
 * 机器人用的静态估值 —— 平衡模拟必须能判断"这件宝物值不值得拿"，
 * 否则会把链条件当垃圾丢掉，得出"宝物无用"的错误结论。
 */
export const RELIC_VALUE = {
  anvil: 9,
  thornsVest: 8,
  heavyWall: 7,
  poisonGem: 8,
  plantEssence: 7,
  woodDragonShield: 9,
  energyHam: 9,
  expEye: 8,
  moltenCore: 7,
  ironRing: 5,
  whetstone: 6,
  herbPouch: 6,
  quiver: 7,
  boneCharm: 4,
  emberStone: 6,
  thornRing: 6,
  /* v3.11 基础属性组：单项加成小，估值跟着压低；对法师来说知识更值钱 */
  ironBracer: 5,
  swiftBoots: 5,
  fangPendant: 6,
  powerGauntlet: 6,
  scholarNotes: 5,
  mendingCharm: 5,
  /* v3.39 新增两件：幸运不进战斗数值（bot 拿它几乎白给），生命直接换生存 */
  cloverCharm: 3,
  vitalHeart: 6,
  /* v3.62 能量件：稀有但强，估值给到链 C 一线水平；圣杯只对青苔有效 */
  starCandle: 8,
  moonChalice: 9,
};

/** 宝物的链归属，机器人用它判断链条是否成型 */
export function relicChain(id) {
  return RELICS[parseRelic(id).id]?.chain ?? 'X';
}

/** 机器人的估值也要看等级：5 级的护腕当然比 1 级值钱 */
export function relicValue(id, lv = 1) {
  const { id: real, lv: inner } = parseRelic(id);
  const base = RELIC_VALUE[real] ?? 5;
  const L = Math.max(inner, lv);
  return RELICS[real]?.levels ? base + (L - 1) * 2 : base;
}
