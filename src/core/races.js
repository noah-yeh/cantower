/**
 * 种族养成 —— 解锁 / 等级 / 碎片（账号级）
 *
 * v3.89：四个种族不再一开始全开。只开放**石头人**（7 命、开局带甲，容错最高），
 * 其余三个靠「看广告开宝箱」攒各自的碎片解锁；解锁之后能升到 30 级，
 * 等级会**抬高这个种族招募时的属性区间**。
 *
 * 为什么碎片按种族分开（用户定的）：收集感更强，每个种族有自己的一条养成线。
 * 代价是可能"一直出已经练满那个种族的碎片"，所以宝箱的抽取权重按状态分档：
 * 未解锁最高（帮你开图鉴）、已解锁未满级次之、满级直接不进池。
 *
 * 分层原则：本文件只管**规则与数值**，不碰 DOM、不读 `Date.now()`（时间由调用方传入）。
 */

import { RACE_IDS, RACES, raceBonus, RACE_MAX_LEVEL } from './characters.js';

/**
 * `raceBonus` 与 `RACE_MAX_LEVEL` 真实定义在 characters.js（掷点要用，避免循环依赖），
 * 这里再导出一遍，UI 只 import 本文件也能拿到。
 */
export { raceBonus, RACE_MAX_LEVEL };

/** 每级消耗碎片（用户指定） */
export const SHARDS_PER_LEVEL = 10;

/** 解锁一个种族需要多少碎片。定成 2 级的量：看几次广告就能开图鉴，不至于卡住新手 */
export const SHARDS_TO_UNLOCK = 20;

/** 开局就开放的种族（用户选石头人：7 命、开局带甲，新玩家不容易一局就被劝退） */
export const RACE_START = 'stone';

/** 广告宝箱：每天能开几次、每次给多少碎片 */
export const BOX_DAILY_LIMIT = 5;
export const BOX_SHARDS_MIN = 6;
export const BOX_SHARDS_MAX = 12;

/** 升到下一级还要几块碎片（满级返回 null） */
export function shardsToNext(level) {
  const lv = Math.max(0, Math.min(RACE_MAX_LEVEL, Math.floor(Number(level) || 0)));
  if (lv >= RACE_MAX_LEVEL) return null;
  return SHARDS_PER_LEVEL;
}

/**
 * 新档的种族状态：开局只解锁 RACE_START，其余 0 级 0 碎片。
 * 返回**全新的对象**，调用方可以随便改。
 */
export function defaultRaceState() {
  const out = {};
  for (const id of RACE_IDS) {
    out[id] = { unlocked: id === RACE_START, level: 0, shards: 0 };
  }
  return out;
}

/**
 * 读存档里的种族状态，缺字段一律按新档补。
 *
 * 老档（v3.88 之前）根本没有 `races` 字段 —— 但玩家可能已经带着青苔族法师在爬塔，
 * 直接锁掉会让他的角色凭空消失。所以迁移规则是：**名册里出现过的种族视为已解锁**。
 * 这符合项目一贯的"能救就救"。
 *
 * @param {object} raw     meta.races（可能是 undefined）
 * @param {string[]} used 名册/墓地/候选人里出现过的 raceId
 */
export function reviveRaceState(raw, used = []) {
  const base = defaultRaceState();
  const out = {};
  for (const id of RACE_IDS) {
    const src = raw && typeof raw === 'object' ? raw[id] : null;
    const level = Math.max(0, Math.min(RACE_MAX_LEVEL, Math.floor(Number(src?.level) || 0)));
    const shards = Math.max(0, Math.floor(Number(src?.shards) || 0));
    const unlocked = src?.unlocked === true || used.includes(id) || id === RACE_START;
    out[id] = { unlocked, level, shards };
  }
  return out;
}

/** 某个种族的状态（永远返回对象，不返回 undefined） */
export function raceState(meta, raceId) {
  return meta?.races?.[raceId] || { unlocked: false, level: 0, shards: 0 };
}

export function isUnlocked(meta, raceId) {
  return raceState(meta, raceId).unlocked === true;
}

/** 已解锁的种族 id 列表 —— 招募页只列这些 */
export function unlockedRaces(meta) {
  return RACE_IDS.filter((id) => isUnlocked(meta, id));
}

/**
 * 能不能解锁。返回 `{ ok, cost, have, reason }`，UI 直接照着显示，不用自己算。
 */
export function canUnlock(meta, raceId) {
  const st = raceState(meta, raceId);
  if (st.unlocked) return { ok: false, reason: '已经解锁了' };
  if (!RACES[raceId]) return { ok: false, reason: '未知种族' };
  if (st.shards < SHARDS_TO_UNLOCK) {
    return {
      ok: false,
      cost: SHARDS_TO_UNLOCK,
      have: st.shards,
      reason: `还差 ${SHARDS_TO_UNLOCK - st.shards} 块碎片`,
    };
  }
  return { ok: true, cost: SHARDS_TO_UNLOCK, have: st.shards };
}

/** 解锁并扣碎片。碎片**不清零**，多出来的留作升级用 */
export function unlockRace(meta, raceId) {
  const check = canUnlock(meta, raceId);
  if (!check.ok) return check;
  const st = meta.races[raceId];
  st.shards -= SHARDS_TO_UNLOCK;
  st.unlocked = true;
  return { ok: true, raceId, left: st.shards };
}

/** 能不能升级 */
export function canLevelUp(meta, raceId) {
  const st = raceState(meta, raceId);
  if (!st.unlocked) return { ok: false, reason: '先解锁这个种族' };
  if (st.level >= RACE_MAX_LEVEL) return { ok: false, reason: '已经满级' };
  const cost = SHARDS_PER_LEVEL;
  if (st.shards < cost) {
    return { ok: false, cost, have: st.shards, reason: `还差 ${cost - st.shards} 块碎片` };
  }
  return { ok: true, cost, have: st.shards, next: st.level + 1 };
}

/** 升一级并扣碎片 */
export function levelUpRace(meta, raceId) {
  const check = canLevelUp(meta, raceId);
  if (!check.ok) return check;
  const st = meta.races[raceId];
  st.shards -= check.cost;
  st.level += 1;
  return { ok: true, raceId, level: st.level, left: st.shards };
}

/**
 * 宝箱能出谁的碎片：权重按"离解锁/满级还有多远"分档。
 *
 *   未解锁    权重 3  —— 帮玩家开图鉴，这是最想要的东西
 *   已解锁未满 权重 2  —— 有成长空间，出了不亏
 *   已满级    不进池 —— 出了等于白给，最招人烦的就是这个
 *
 * 全满级时返回空数组，由调用方转成金币奖励（别让广告白看）。
 */
export function shardPool(meta) {
  const pool = [];
  for (const id of RACE_IDS) {
    const st = raceState(meta, id);
    if (!st.unlocked) pool.push({ raceId: id, weight: 3 });
    else if (st.level < RACE_MAX_LEVEL) pool.push({ raceId: id, weight: 2 });
  }
  return pool;
}

/** 按权重抽一个种族。pool 为空时返回 null */
export function pickShardRace(pool, rng) {
  if (!pool || !pool.length) return null;
  const total = pool.reduce((s, x) => s + x.weight, 0);
  let r = rng.next() * total;
  for (const item of pool) {
    r -= item.weight;
    if (r <= 0) return item.raceId;
  }
  return pool[pool.length - 1].raceId;
}

/** 一次开箱的碎片量（6~12，含两端） */
export function rollShardAmount(rng) {
  const span = BOX_SHARDS_MAX - BOX_SHARDS_MIN + 1;
  return BOX_SHARDS_MIN + Math.floor(rng.next() * span);
}

/**
 * 直接把一箱碎片发进 meta（纯逻辑，不发请求、不播广告）。
 * 全种族满级时退化成金币，避免"广告看完了什么都没给"。
 *
 * @returns {{ok:true, raceId:string|null, shards:number, gold:number, left:number}}
 */
export function grantShardBox(meta, rng) {
  const pool = shardPool(meta);
  const raceId = pickShardRace(pool, rng);

  if (!raceId) {
    const gold = 40;
    meta.gold = (meta.gold || 0) + gold;
    return { ok: true, raceId: null, shards: 0, gold };
  }

  const shards = rollShardAmount(rng);
  const st = meta.races[raceId];
  st.shards += shards;
  return { ok: true, raceId, shards, gold: 0, name: RACES[raceId]?.name || raceId };
}
