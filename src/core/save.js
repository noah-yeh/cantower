/**
 * 存档（v0.4：从"一局"扩展成"大厅 + 探险"三层）
 *
 * 存什么：
 *   meta  金币 / 名册 / 候选 / 幽灵库 / 墓地      —— 必须持久
 *   run   当前进行中的探险                         —— 必须持久，关掉浏览器要能续
 *
 * 不存什么：
 *   战斗中间态（battle 对象）。读档时从当前层开头重建这一场。
 *   代价是"读档会重打当前这一层"，换来的是存档小、规则改动不会炸老档。
 */

import { createMeta, SAVE_VERSION, RUN_SAVE_VERSION, tickRecruit, RECRUIT_CAP } from './meta.js';
import { reviveCharacter } from './roster.js';
import { makeFloorMap, unfog, FOG } from './dungeon.js';
import { resumeCellBattle } from './run.js';
import { MAX_FLOOR } from './enemies.js';
import { MAX_ENHANCE } from './equipment.js';
import { MANOR_CAP } from './manor.js';
import { reviveRaceState } from './races.js';

const META_KEY = 'ruin-spire/hall';
const RUN_KEY = 'ruin-spire/run';

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/* ---------------- 大厅 ---------------- */

export function defaultMeta() {
  return createMeta(Date.now() >>> 0);
}

export function loadMeta(now = Date.now()) {
  const s = storage();
  if (!s) return defaultMeta();
  try {
    const raw = s.getItem(META_KEY);
    if (!raw) return defaultMeta();
    const data = JSON.parse(raw);
    if (data.version === SAVE_VERSION) return reviveMeta(data, now);
    return migrateMeta(data, now);
  } catch {
    return defaultMeta();
  }
}

export function saveMeta(meta) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    /* 存满或隐私模式，忽略 */
  }
}

/**
 * 把云端拉下来的整包写进本地存档槽（v3.94）。
 *
 * 只做"覆盖 + 让调用方自己 loadMeta()"，不在这里 revive ——
 * 读档那套 `reviveMeta` 是唯一的真源，云端存档和本地存档必须走同一条恢复路径，
 * 否则同一个人换台设备回来，属性面板会出现只有云端档才有的差异。
 *
 * **高于当前版本的档一律拒收**：`migrateMeta` 遇到不认识的版本会重建默认档，
 * 拿一份未来版本的存档灌进去等于把玩家名册清空。宁可报错让玩家升级，
 * 也不要静默变成一份白档。返回 false 时调用方应当提示"请先更新游戏"。
 */
export function writeCloudMeta(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const v = Number(payload.version);
  if (!Number.isFinite(v) || v > SAVE_VERSION) return false;
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(META_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** 当前本地存档的原始 JSON（云端上传用；不做 revive，原样发） */
export function rawMeta() {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(META_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * 读档后补齐字段，避免旧字段缺失导致崩溃。
 * 最后统一 tick 一次招募席位 —— 离线期间走的冷却，回来就该结算。
 */
function reviveMeta(data, now = Date.now()) {
  const base = createMeta(data.seed ?? 1);
  const meta = { ...base, ...data, version: SAVE_VERSION };

  meta.roster = (data.roster || []).map(reviveCharacter).filter(Boolean);
  /**
   * 候选人（v3.5：一次只出一个）。
   *
   * 旧档（v6 及以前）是 6 个席位的 `candidates` 数组 —— 把**第一个还站着的**接过来，
   * 剩下的直接丢：他们已经花了玩家的名额吗？没有，所以丢掉的代价只是"再点一次招募"。
   *
   * 候选还要强制写回 veteran=false：reviveCharacter 对缺字段的旧档默认按
   * "已转正"补，但候选永远是新人 —— 不覆盖的话旧档里招进来的人会直接免掉试用期。
   */
  const oldCandidate = Array.isArray(data.candidates)
    ? data.candidates.find((c) => c && c.id)
    : null;
  const rawCandidate = data.candidate && data.candidate.id ? data.candidate : oldCandidate;
  meta.candidate = rawCandidate ? reviveCharacter(rawCandidate) : null;
  if (meta.candidate) meta.candidate.veteran = false;
  delete meta.candidates;
  delete meta.slotReadyAt;

  /** 名额（v3.5）：旧档没有就按满额补 —— 该给玩家的别扣着 */
  meta.tickets = Math.max(0, Math.min(RECRUIT_CAP, Math.floor(Number(data.tickets ?? RECRUIT_CAP))));
  meta.ticketAt = Number.isFinite(Number(data.ticketAt)) ? Number(data.ticketAt) : 0;

  meta.ghosts = (data.ghosts || []).map(reviveCharacter).filter(Boolean);
  meta.graveyard = data.graveyard || [];
  meta.log = data.log || [];

  /**
   * 种族养成（v3.89）。
   *
   * 老档没有 `races` 字段，但玩家可能已经带着青苔族法师在爬塔 ——
   * 直接按新档锁掉会让他的角色变成"不存在的种族"。
   * 所以把**名册 / 墓地 / 当前候选 / 进行中的探险**里出现过的种族一律视为已解锁，
   * 这就是项目一贯的"能救就救"。
   *
   * 注意用 `data`（原始存档）而不是 `meta`：`meta.ghosts` 里混着平台预置的陪练幽灵，
   * 那批 NPC 四个种族都有，算进来等于一口气全解锁。
   *
   * **候选人也不算**：他是"还没雇的路人"，每次刷新都随机换种族，
   * 算进来会让玩家每次点招募就白解锁一个新种族（实测就是靠这个 bug 一天开满图鉴）。
   */
  const usedRaces = new Set();
  for (const c of data.roster || []) if (c?.raceId) usedRaces.add(c.raceId);
  for (const g of data.graveyard || []) if (g?.raceId) usedRaces.add(g.raceId);
  if (data.run?.raceId) usedRaces.add(data.run.raceId);
  meta.races = reviveRaceState(data.races, [...usedRaces]);


  /**
   * 竞技场段位（v3.35）：
   *  - 每日奖励账本：字段缺失或脏数据一律按"今天还没记"重建；
   *  - 初始转正角色：`data.starter` 缺失说明这是 v3.35 之前的老档 ——
   *    名册为空时兜底送一位 createMeta 捏好的测试角色，并打上 starter 标记防重复。
   *    名册非空的老档只补标记不送人：他们有自己的角色，白送反而污染名册。
   */
  const daily = data.arenaDaily;
  meta.arenaDaily = daily && daily.day && Array.isArray(daily.claimed)
    ? { day: String(daily.day), claimed: daily.claimed.map(String) }
    : { day: '', claimed: [] };
  if (!data.starter) {
    meta.starter = true;
    if (!meta.roster.length && base.roster[0]) {
      meta.roster = [base.roster[0]];
      if (!meta.activeCharId) meta.activeCharId = meta.roster[0].id;
    }
  }
  /**
   * 装备 / 星屑 / 庄园（v2.3）。
   *
   * 三个字段都要**逐项校验**而不是直接赋值：存档来自旧版本时它们是 undefined，
   * 而装备库里的一条脏数据（没有 defId）会让整个装备页崩掉。
   */
  meta.equipment = (Array.isArray(data.equipment) ? data.equipment : [])
    .filter((it) => it && it.defId)
    .map((it, i) => ({
      /** 老档没有 id 的装备给一个稳定 id，别用随机数（存档要可复现） */
      id: String(it.id || `eq_old_${i}`),
      defId: it.defId,
      lv: Math.max(0, Math.min(MAX_ENHANCE, Number(it.lv) || 0)),
      /** 穿戴者可能已经在旧档里被删了 —— 指向不存在的人则退回库里 */
      by: meta.roster.some((c) => c.id === it.by) ? it.by : null,
    }));
  meta.stardust = Math.max(0, Number(data.stardust) || 0);
  /** 星屑碎片（v2.3b）：回收装备得碎片，10 合 1 星屑。旧档没有就按 0 补 */
  meta.shards = Math.max(0, Math.floor(Number(data.shards) || 0));
  /** 命数之种（v3.90）：商城古币宝箱掉落，旧档没有就按 0 补 */
  meta.lifeSeeds = Math.max(0, Math.floor(Number(data.lifeSeeds) || 0));
  meta.manors = (Array.isArray(data.manors) ? data.manors : [])
    .filter((m) => m && m.id)
    .map((m) => ({
      id: String(m.id),
      charId: m.charId || null,
      name: String(m.name || '无名者'),
      classId: m.classId || null,
      raceId: m.raceId || null,
      level: Math.max(1, Number(m.level) || 1),
      /** 0 是合法时间戳，用 isFinite 判而不是 `||` */
      lastAt: Number.isFinite(Number(m.lastAt)) ? Number(m.lastAt) : now,
      stored: Math.max(0, Math.min(MANOR_CAP, Number(m.stored) || 0)),
    }));
  /**
   * 广告记账必须显式归一：旧档（v0.8 及以前）没有这个字段，
   * 而 `{...base, ...data}` 只保证有这个 key，不保证内容合法 ——
   * 万一存进来的是 `{}`，ads.adState 会拿 undefined 去算次数。
   *
   * v3.89：两个广告位各自计数，`boxUsed` 必须一起归一。
   * 这里曾经只搬 `used`，结果每次读档都把宝箱次数清零 —— 等于一天能开无限次箱。
   */
  meta.ads = data.ads && typeof data.ads === 'object'
    ? {
      day: String(data.ads.day || ''),
      used: Math.max(0, Number(data.ads.used) || 0),
      boxUsed: Math.max(0, Number(data.ads.boxUsed) || 0),
    }
    : base.ads;

  /**
   * 幽灵池：**预置幽灵随版本重建，玩家自己的历史快照保留**。
   *
   * 预置幽灵是"这个世界里的其他玩家"，数值来自 meta.growGhost 那条成长路径。
   * v1.4 把它们从"1~5 级白板"改成了"Lv10~21、走过真实升级/补牌/拿宝物"的角色，
   * 如果继续沿用旧档里那批 100 血的幽灵，一个 Lv17 的角色会看到三个送分的对手 ——
   * 竞技场就成了刷金币机。玩家自己的快照（名字带 ·旧影）不受影响。
   */
  const mine = meta.ghosts.filter((g) => !String(g.name || '').endsWith('·幽灵'));
  meta.ghosts = [...base.ghosts, ...mine];
  tickRecruit(meta, now);
  return meta;
}

/**
 * 旧档迁移。
 *
 * 原则：**能救就救**。只有 v0.3（根本没有大厅）那种结构不兼容的档才归档重置，
 * 其余版本缺的字段一律按默认值补 —— 玩家的金币、名册、墓地不该因为一次版本升级蒸发。
 */
function migrateMeta(old, now = Date.now()) {
  if (!old || typeof old !== 'object') return defaultMeta();

  // v4 → v5：招募从 3 个常驻候选改成 6 个带冷却的席位。
  // 结构是超集（3 个候选正好能放进前 3 个位），直接走 reviveMeta 补齐。
  if (old.version === 4) return reviveMeta(old, now);

  // v5 → v6：加了装备库 / 星屑 / 庄园。三个都是**新增**字段，旧档一律按空补齐，
  // 玩家已有的金币、名册、墓地原样保留 —— 这是"能救就救"原则。
  if (old.version === 5) return reviveMeta(old, now);

  // v6 → v7：招募从"6 个席位各自冷却"改成"名额池 + 一次一位"。
  // 席位数组是超集，reviveMeta 会把第一个候选接过来、名额按满额补。
  if (old.version === 6) return reviveMeta(old, now);

  // v7 → v8（v3.35）：竞技场段位 / 每日奖励 / 初始转正角色。
  // 三个都是新增字段，reviveMeta 按缺省补齐；名册为空的老档兜底送一位测试角色。
  if (old.version === 7) return reviveMeta(old, now);

  // v0.3 及更早：只有"一局"，没有大厅概念，归档后重开
  const meta = defaultMeta();
  if (old.runs || old.bestFloor || old.unlocked) {
    meta.legacy = {
      runs: old.runs ?? 0,
      wins: old.wins ?? 0,
      bestFloor: old.bestFloor ?? 0,
    };
  }
  return meta;
}

/* ---------------- 探险 ---------------- */

export function serializeRun(run) {
  return {
    /** 局内版本独立：大厅升版不该让塔里那趟探险读不出来 */
    version: RUN_SAVE_VERSION,
    seed: run.seed,
    rngState: run.rngState,
    characterId: run.characterId ?? null,
    classId: run.classId,
    raceId: run.raceId,
    characterName: run.characterName,
    player: { ...run.player },
    deck: run.deck.slice(),
    relics: run.relics.slice(),
    relicSlots: (run.relicSlots || []).slice(),
    materials: run.materials || 0,
    /**
     * 装备（v2.3）：`equipBonus` 必须存 —— 活着回来时要把这部分从属性里减掉
     * 再写回角色，否则每进一次塔就多叠一次装备加成。
     */
    equip: (run.equip || []).map((it) => ({ defId: it.defId, lv: it.lv || 0 })),
    equipBonus: { ...(run.equipBonus || {}) },
    /** v1.8 局内经济：金币、货架、上次开店的层数都要续上，否则读档等于白送一次商店 */
    gold: run.gold || 0,
    /** v3.13 两家店：kind 与刷新次数必须存 —— 否则读档后宝库变成行商、刷新价钱回到第一档 */
    shop: run.shop ? {
      kind: run.shop.kind || 'card',
      refreshes: run.shop.refreshes || 0,
      cards: (run.shop.cards || []).map((c) => ({ ...c })),
      relics: (run.shop.relics || []).map((r) => ({ ...r })),
    } : null,
    lastShopFloor: run.lastShopFloor ?? 1,
    lastRelicShopFloor: run.lastRelicShopFloor ?? 1,
    diffMul: run.diffMul ?? 1,
    perk: run.perk,
    racePerk: run.racePerk,
    floor: run.floor,
    phase: run.phase,
    /**
     * v2.0 迷宫层：整张地图都要存。
     *
     * 翻开了哪些格、哪些格已经清掉、当前在打哪一格 —— 少存一样，
     * 关掉页面再回来这一层就会重新洗牌（等于送一次重roll）。
     */
    floorMap: run.floorMap ? JSON.parse(JSON.stringify(run.floorMap)) : null,
    /**
     * v3.34 祭坛待选列表也要存：离开祭坛回地图（不弃单）之后关页面，
     * 重开时顶栏的「↑ 祭坛」入口靠它出现。
     */
    upgradeTargets: run.upgradeTargets ? run.upgradeTargets.slice() : null,
    lastCellNote: run.lastCellNote || '',
    /** v3.72 委托与额外天赋（run-only，见 talents.js）：不存的话关页面就丢 */
    quest: run.quest ? { ...run.quest } : null,
    /** v3.85 委托板：没回应的 offer 与已接受份数 —— 关页面回来还是那张纸 */
    questOffer: run.questOffer ? { ...run.questOffer } : null,
    questsTaken: run.questsTaken || 0,
    lastQuestId: run.lastQuestId ?? null,
    lastQuestNote: run.lastQuestNote || '',
    talents: (run.talents || []).slice(),
    stats: { ...run.stats },
  };
}

export function saveRun(run) {
  const s = storage();
  if (!s) return;
  try {
    if (!run || run.phase === 'dead' || run.phase === 'won') {
      s.removeItem(RUN_KEY);
      return;
    }
    s.setItem(RUN_KEY, JSON.stringify(serializeRun(run)));
  } catch {
    /* ignore */
  }
}

/**
 * 反序列化。战斗重开到当前层开头。
 * 数据不合法（版本不符、字段缺失）一律返回 null，不抛错。
 */
export function loadRun() {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(RUN_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.version !== RUN_SAVE_VERSION) return null;
    if (!d.classId || !d.raceId || !d.deck) return null;

    const run = {
      ...d,
      relicSlots: d.relicSlots || [],
      materials: d.materials || 0,
      equip: Array.isArray(d.equip) ? d.equip : [],
      equipBonus: d.equipBonus || null,
      gold: d.gold || 0,
      shop: d.shop || null,
      lastShopFloor: d.lastShopFloor ?? 1,
      lastRelicShopFloor: d.lastRelicShopFloor ?? 1,
      /** v3.85：旧档没有委托字段，统一补默认值（所有读点也有 || 兜底） */
      quest: d.quest || null,
      questOffer: d.questOffer || null,
      questsTaken: d.questsTaken || 0,
      talents: Array.isArray(d.talents) ? d.talents : [],
      battle: null,
      reward: null,
      history: [],
    };

    /**
     * v3.15 补丁：层数越过塔顶的坏档，读进来直接判通关。
     *
     * 塔只有 30 层，正常流程 advanceFloor 在 31 层就转 'won'；能存下
     * floor > 30 的只会是历史版本 bug 留下的档（局内存档版本号相同，
     * 旧 build 的坏档会被原样读进来）。玩家报告过"第 33 层还能一直
     * 点下一层"—— 指向的正是这种档。见到就越过地图判定为通关，
     * 不给"再下一层"的机会。
     */
    if (run.floor > MAX_FLOOR) {
      run.phase = 'won';
      run.battle = null;
      run.reward = null;
      return run;
    }

    /**
     * 停在商店里存档：直接还原货架。
     * 这条分支必须走在建战斗之前 —— 否则会凭空造一个敌人、白耗一段 rng，
     * 读档后玩家看到的还是战斗而不是商店。
     */
    if (d.phase === 'shop' && run.shop?.cards) {
      run.phase = 'shop';
      return run;
    }

    /**
     * v2.0 迷宫层。三条分支，都不再造敌人：
     *   map    → 原样回来（翻开的格、清掉的格都在存档里）
     *   battle → 用地图上的 activeCell 重开这一场（敌人满血重来，读档不能回血）
     *   reward → 存档不带奖励内容，只能退回地图（不能卡在空奖励页）
     */
    if (run.floorMap) {
      /** v3.12 关掉迷雾：旧档里没翻开的格要就地摊开，否则既翻不开也点不动 */
      if (!FOG) unfog(run.floorMap);
      if (d.phase === 'battle' && resumeCellBattle(run)) return run;
      /**
       * v3.37 付费祭坛：停在里面存档的，原样回坛 —— 状态就在卡组和金币里，
       * 没有快照要还；祭坛格不 done，就算落到地图上也随时能再点进去。
       */
      if (d.phase === 'remove' || d.phase === 'morph') {
        run.phase = d.phase;
        run.battle = null;
        run.reward = null;
        return run;
      }
      /**
       * v3.85 委托板：停在委托页存档的，原样回委托页 —— 接受/婉拒还在等玩家。
       * offer 丢了（坏档/旧档）就退回地图，格子已经 done，不会重复给。
       */
      if (d.phase === 'quest' && run.questOffer) {
        run.phase = 'quest';
        run.battle = null;
        run.reward = null;
        return run;
      }
      run.phase = 'map';
      run.battle = null;
      run.reward = null;
      return run;
    }

    /**
     * 老存档（v1.x 没有 floorMap）：楼层还在，就地为这一层生成一张地图。
     * 这是唯一需要"补生成"的地方 —— 宁可多一层随机，也不能让存档读不出来。
     */
    makeFloorMap(run);
    run.phase = 'map';
    run.battle = null;
    run.reward = null;
    return run;
  } catch {
    return null;
  }
}

export function clearRun() {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(RUN_KEY);
  } catch {
    /* ignore */
  }
}

export function hasRun() {
  const s = storage();
  if (!s) return false;
  try {
    return !!s.getItem(RUN_KEY);
  } catch {
    return false;
  }
}

export { SAVE_VERSION };
