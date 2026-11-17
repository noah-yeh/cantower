/**
 * 装备与强化（v2.3）
 *
 * 和卡牌 / 宝物最大的区别：**装备是账号资产，不是这一趟的战利品。**
 *
 * 塔里的东西（卡组、宝物、等级、局内金币、水晶材料）死在塔里就全部回滚 ——
 * 那是"赌注"。装备反着来：捡到的那一刻就离开角色，进 `meta.equipment` 装备库，
 * 阵亡回滚（roster.wipeOnDeath）碰不到它。这就是用户要的
 * 「冒险失败是可以把装备带出来的」。
 *
 * 三条硬规则：
 *   1. 每件装备基础数值都很小（攻击 +2、生命 +8 这一档），强化的收益才是大头
 *   2. 一个角色最多穿 2 件
 *   3. 强化上限 +10，第 N 级要 N 个星屑（1+2+…+10 = 55 个，见 manor.js）
 *
 * 数值只走"加法"不走百分比：装备是底座，不该和宝物 / 卡牌的乘区打架。
 */

/* ---------------- 规则常量 ---------------- */

/** 一个角色最多穿几件 */
export const EQUIP_SLOTS = 2;

/** 强化上限 */
export const MAX_ENHANCE = 10;

/** 强化到下一级要多少星屑：第 N 级正好 N 个（用户指定） */
export function enhanceCost(lv) {
  return Math.max(1, Math.min(MAX_ENHANCE, lv) + 1);
}

/* ---------------- 装备表 ---------------- */

/**
 * 六件白板装，覆盖四种面板属性 + 生命 + 攻击。
 *
 * `stats` 是 0 级数值，`per` 是每强化 1 级加多少。
 * 取这么小是刻意的：这一版装备是"长期存款"，不是"一穿就变强"。
 * +10 的收益（攻击 +12 / 生命 +48）已经接近一个满级角色的本体强度，
 * 而它要 55 个星屑 —— 也就是一座庄园不眠不休 18 小时的产出。
 */
export const EQUIP_DEFS = {
  ironSword: { name: '铁剑', slot: '兵器', rar: 'fine', stats: { atk: 2 }, per: { atk: 1 } },
  boneDagger: { name: '骨匕', slot: '兵器', rar: 'fine', stats: { crit: 2 }, per: { crit: 1 } },
  leatherArmor: { name: '皮甲', slot: '护具', rar: 'fine', stats: { maxHp: 8 }, per: { maxHp: 4 } },
  woodShield: { name: '木盾', slot: '护具', rar: 'common', stats: { def: 1 }, per: { def: 1 } },
  clothBoots: { name: '布靴', slot: '护具', rar: 'common', stats: { dodge: 1 }, per: { dodge: 1 } },
  boneNecklace: { name: '骨坠', slot: '饰物', rar: 'common', stats: { recovery: 1 }, per: { recovery: 1 } },
};

/**
 * 稀有度（v2.3c）：越好的装备越难出。
 *
 * 「精良」是能实打实改变战斗的（攻击是乘法基底、生命是容错、暴击是质变），
 * 「常见」是锦上添花的辅助属性。掉落权重 8/8/6 vs 26/26/26 ——
 * 一件精良 ≈ 三件常见，配合低掉落率（一局 1~3 件），出一件精良值得记一下。
 */
export const EQUIP_RARITY = {
  common: { label: '常见', cls: '' },
  fine: { label: '精良', cls: 'fine' },
};

/** 掉落权重：只在这张表里调稀有度，别在掉落点各写一份 */
const EQUIP_WEIGHTS = {};
for (const [id, def] of Object.entries(EQUIP_DEFS)) {
  EQUIP_WEIGHTS[id] = def.rar === 'fine' ? (id === 'boneDagger' ? 6 : 8) : 26;
}

/** 按稀有度权重随机一件装备的 defId（宝箱 / 战斗掉落共用） */
export function pickEquipDefId(rng) {
  return rng.weighted(EQUIP_WEIGHTS);
}

export const EQUIP_IDS = Object.keys(EQUIP_DEFS);

/** 属性键 → 面板名（顺序即展示顺序） */
export const EQUIP_STAT_LABEL = {
  maxHp: '生命',
  atk: '攻击',
  def: '防御',
  crit: '暴击',
  dodge: '闪避',
  recovery: '恢复',
};

/** 这几种按百分比显示 */
const PERCENT_STATS = new Set(['crit', 'dodge']);

const STAT_KEYS = Object.keys(EQUIP_STAT_LABEL);

export function equipDef(defId) {
  return EQUIP_DEFS[defId] || null;
}

export function equipName(item) {
  return EQUIP_DEFS[item?.defId]?.name ?? item?.defId ?? '未知装备';
}

/** 展示名：`铁剑 +3`（0 级不带加号） */
export function equipTitle(item) {
  const lv = item?.lv || 0;
  return `${equipName(item)}${lv > 0 ? ` +${lv}` : ''}`;
}

/** 某件装备在某个强化等级下的实际加成 */
export function equipStats(defId, lv = 0) {
  const def = EQUIP_DEFS[defId];
  const out = {};
  for (const k of STAT_KEYS) out[k] = 0;
  if (!def) return out;
  const l = Math.max(0, Math.min(MAX_ENHANCE, lv || 0));
  for (const k of STAT_KEYS) {
    out[k] = (def.stats?.[k] || 0) + (def.per?.[k] || 0) * l;
  }
  return out;
}

/** 多件装备的加成合计（传 item 数组，读 item.lv） */
export function equipBonus(items = []) {
  const out = {};
  for (const k of STAT_KEYS) out[k] = 0;
  for (const item of items) {
    if (!item) continue;
    const s = equipStats(item.defId, item.lv || 0);
    for (const k of STAT_KEYS) out[k] += s[k];
  }
  return out;
}

/** 有没有实际加成（全是 0 时 UI 不显示 +0） */
export function hasBonus(b) {
  return STAT_KEYS.some((k) => (b?.[k] || 0) > 0);
}

/** `攻击 +2 · 暴击 +1%` —— 空串表示没有加成 */
export function statsText(stats) {
  if (!stats) return '';
  return STAT_KEYS
    .filter((k) => (stats[k] || 0) > 0)
    .map((k) => `${EQUIP_STAT_LABEL[k]} +${stats[k]}${PERCENT_STATS.has(k) ? '%' : ''}`)
    .join(' · ');
}

/** 一件装备的当前加成文案 */
export function itemText(item) {
  return statsText(equipStats(item?.defId, item?.lv || 0)) || '无加成';
}

/**
 * 强化的预览：这一级花多少、下一级多给什么。UI 与测试共用 ——
 * 按钮上写"攻击 +1"和面板上的数值必须来自同一份计算，否则玩家会看到两套数。
 */
export function enhancePreview(item) {
  const lv = item?.lv || 0;
  if (lv >= MAX_ENHANCE) return null;
  const a = equipStats(item.defId, lv);
  const b = equipStats(item.defId, lv + 1);
  const diff = {};
  for (const k of STAT_KEYS) diff[k] = b[k] - a[k];
  return { cost: enhanceCost(lv), text: statsText(diff), next: b };
}

/* ---------------- 装备库（meta.equipment） ---------------- */

let seq = 0;
function nextItemId() {
  seq += 1;
  return `eq${Date.now().toString(36)}${seq.toString(36)}`;
}

/** 一件新装备（未穿戴） */
export function makeItem(defId, lv = 0) {
  return {
    id: nextItemId(),
    defId,
    lv: Math.max(0, Math.min(MAX_ENHANCE, lv)),
    /** 穿戴者角色 id；null = 躺在库里 */
    by: null,
  };
}

/**
 * 捡到一件装备 —— **入账号库，不进 run**。
 * 探险阵亡回滚碰不到 meta，所以拿到的就是拿到了。
 */
export function addEquipment(meta, defId, lv = 0) {
  if (!meta || !EQUIP_DEFS[defId]) return null;
  const item = makeItem(defId, lv);
  if (!Array.isArray(meta.equipment)) meta.equipment = [];
  meta.equipment.push(item);
  return item;
}

export function findItem(meta, itemId) {
  return (meta?.equipment || []).find((it) => it.id === itemId) || null;
}

/** 某个角色身上的装备（最多 EQUIP_SLOTS 件） */
export function itemsOf(meta, charId) {
  return (meta?.equipment || []).filter((it) => it && it.by === charId);
}

/** 角色身上装备的**快照**（存档/对战/建 run 都用这个，脱离 meta 也能算） */
export function equippedSnapshot(meta, charId) {
  return itemsOf(meta, charId).map((it) => ({ defId: it.defId, lv: it.lv || 0 }));
}

/** 角色身上装备提供的属性合计 */
export function bonusOf(meta, charId) {
  return equipBonus(itemsOf(meta, charId));
}

/** 库里还没被人穿的 */
export function idleItems(meta) {
  return (meta?.equipment || []).filter((it) => !it.by);
}

/**
 * 穿上一件。规则全在这里：
 *   ① 装备必须存在 ② 已经 2 件就不行 ③ 被别人穿着不行
 *
 * 换装是"先脱后穿"，不做自动替换 —— 自动脱别人的装备会让玩家看不懂
 * 到底是哪一件被换掉了。
 */
export function equipItem(meta, charId, itemId) {
  const item = findItem(meta, itemId);
  if (!item) return { ok: false, reason: '没有这件装备' };
  if (item.by === charId) return { ok: false, reason: '已经穿在身上了' };
  if (item.by) return { ok: false, reason: '这件正被别的角色穿着' };

  const ch = (meta.roster || []).find((c) => c.id === charId);
  if (!ch || ch.status === 'dead') return { ok: false, reason: '这个角色不能穿装备' };

  /**
   * v3.72：装备库页只展示仓库（没有「卸下」按钮），穿满 2 件时**自动换位** ——
   * 优先换下同槽位的穿着件，没有就换下第一件。穿 = 换，脱 = 穿另一件。
   */
  let swapped = null;
  const worn = itemsOf(meta, charId);
  if (worn.length >= EQUIP_SLOTS) {
    const slot = EQUIP_DEFS[item.defId]?.slot;
    swapped = worn.find((it) => it.id !== item.id && EQUIP_DEFS[it.defId]?.slot === slot) || worn[0];
    swapped.by = null;
  }

  item.by = charId;
  return { ok: true, item, swapped };
}

export function unequipItem(meta, itemId) {
  const item = findItem(meta, itemId);
  if (!item) return { ok: false, reason: '没有这件装备' };
  if (!item.by) return { ok: false, reason: '这件没被穿着' };
  item.by = null;
  return { ok: true, item };
}

/** 脱下某角色的全部装备（阵亡消失 / 转成庄园 / 清号时用，避免装备跟着蒸发） */
export function unequipAllOf(meta, charId) {
  const list = itemsOf(meta, charId);
  for (const it of list) it.by = null;
  return list.length;
}

/**
 * 花星屑强化一件装备。
 *
 * 材料**只在 meta 上**（`meta.stardust`），不放在角色身上 ——
 * 星屑是账号资产，角色死了也不该丢。
 * 强化不失败、不降级：这一版没有随机性，代价只有一个「够不够材料」。
 */
export function enhanceItem(meta, itemId) {
  const item = findItem(meta, itemId);
  if (!item) return { ok: false, reason: '没有这件装备' };
  const lv = item.lv || 0;
  if (lv >= MAX_ENHANCE) return { ok: false, reason: `已经 +${MAX_ENHANCE}，到顶了` };

  const cost = enhanceCost(lv);
  const have = meta.stardust || 0;
  if (have < cost) {
    return { ok: false, reason: `星屑不足（+${lv + 1} 需 ${cost}，现有 ${have}）` };
  }

  meta.stardust = have - cost;
  item.lv = lv + 1;
  return { ok: true, item, cost, lv: item.lv };
}

/** 从 +0 强化到 +10 一共要多少星屑（UI 说明与测试共用） */
export function totalEnhanceCost() {
  let s = 0;
  for (let lv = 0; lv < MAX_ENHANCE; lv++) s += enhanceCost(lv);
  return s;
}

/* ---------------- 碎片回收（v2.3b） ----------------
 *
 * 重复装备原本无处可用。直接回收成星屑会砸了庄园的饭碗，
 * 所以走间接路线：回收给**碎片**，攒够才合成 1 个星屑 ——
 * 星屑的主渠道永远只有庄园，重复装备只是个小零头。
 *
 * 合成比 10:1（v2.3c 定稿）：掉落率砍到一局 1~3 件之后，
 * 回收 ≈ 0.24✦/小时（肝）vs 庄园 0.25✦/小时（挂机、可叠）——
 * 回收是"活跃玩家顺手攒的零头"，庄园是主渠道，量级刚好错开。
 */

/** 多少碎片合成 1 个星屑（10:1，掉落率见 dungeon.js / run.js 的稀缺性设计） */
export const SHARDS_PER_STARDUST = 10;

/**
 * 一件装备回收值多少碎片：基础 1，强化每 2 级多返 1。
 * 只返一半是刻意的：+10 全程投了 55 星屑，回收只给 6 碎片（≈0.6 星屑），
 * 「强化→回收」永远亏本，碎片没法当刷星屑的漏洞。
 */
export function recycleValue(item) {
  const lv = Math.max(0, Math.min(MAX_ENHANCE, item?.lv || 0));
  return 1 + Math.floor(lv / 2);
}

/** 回收一件装备。穿着的不行 —— 先卸下，给玩家一次反悔的机会 */
export function recycleItem(meta, itemId) {
  const item = findItem(meta, itemId);
  if (!item) return { ok: false, reason: '没有这件装备' };
  if (item.by) return { ok: false, reason: '穿着的装备先卸下才能回收' };
  const list = meta.equipment || [];
  const idx = list.indexOf(item);
  if (idx < 0) return { ok: false, reason: '这件装备不在库里' };

  list.splice(idx, 1);
  const gain = recycleValue(item);
  meta.shards = (meta.shards || 0) + gain;
  return { ok: true, gain, shards: meta.shards };
}

/** 碎片合成星屑：SHARDS_PER_STARDUST → 1 */
export function combineShards(meta) {
  const have = meta.shards || 0;
  if (have < SHARDS_PER_STARDUST) {
    return { ok: false, reason: `碎片不足（${SHARDS_PER_STARDUST} 个合成 1 星屑，现有 ${have}）` };
  }
  meta.shards = have - SHARDS_PER_STARDUST;
  meta.stardust = (meta.stardust || 0) + 1;
  return { ok: true, stardust: meta.stardust, shards: meta.shards };
}
