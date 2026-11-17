/**
 * 商城（v3.90）—— 金币宝箱 / 装备宝箱 / 命数之种（规则层）
 *
 * 文件名用 mall 而不是 shop：shop.js 已经是**局内**的行商/宝库（v1.8），
 * 这里是**大厅**的商城，两码事不能混一个入口。
 *
 * 广告类的两个位（金币、碎片宝箱）在 ads.js / races.js，这里只管
 * **用金币买**的部分。分层原则不变：纯规则、零 DOM、不读 Date.now()，
 * 随机一律走调用方传入的 Rng，方便复现和测试。
 *
 * 经济口径（GAME_DESIGN 5.4.2）：一次通关（30 层）约 60 金。
 * 古币宝箱 50 金的单发收益刻意**低于**广告碎片宝箱 —— 金币线是补充，
 * 广告线才是种族养成的主产出，两条线不能倒挂。
 */

import { RACES } from './characters.js';
import { pickShardRace, shardPool } from './races.js';
import { pickEquipDefId, addEquipment, equipName } from './equipment.js';

/* ---------------- 古币宝箱 ---------------- */

export const GOLD_CHEST_COST = 50;
/** 每箱碎片量（3~6，含两端）：均值 4.5，不到广告箱（9）的一半 */
export const GOLD_CHEST_SHARDS_MIN = 3;
export const GOLD_CHEST_SHARDS_MAX = 6;
/** 命数之种掉率。小额惊喜，不是刷种子的入口 */
export const GOLD_CHEST_SEED_CHANCE = 0.1;

export function canOpenGoldChest(meta) {
  if ((meta.gold || 0) < GOLD_CHEST_COST) {
    return { ok: false, reason: `古币不足（需 ${GOLD_CHEST_COST}）` };
  }
  return { ok: true };
}

/**
 * 开一箱古币宝箱：扣 50 金 → 抽一族的碎片，再掷一次种子。
 *
 * 碎片抽法和广告宝箱同一套池（shardPool / pickShardRace）：
 * 未解锁 3 / 已解锁未满 2 / 满级不进池。全满级时碎片退化成 40 金
 * （和广告箱同口径），种子照掷 —— 满级玩家买箱子买的是种子。
 *
 * @returns {{ok:true, raceId:string|null, shards:number, refund:number, seed:boolean, name?:string}}
 */
export function openGoldChest(meta, rng) {
  const check = canOpenGoldChest(meta);
  if (!check.ok) return check;

  meta.gold -= GOLD_CHEST_COST;

  const pool = shardPool(meta);
  const raceId = pickShardRace(pool, rng);
  let shards = 0;
  let refund = 0;
  let name;

  if (raceId) {
    shards = GOLD_CHEST_SHARDS_MIN + Math.floor(rng.next() * (GOLD_CHEST_SHARDS_MAX - GOLD_CHEST_SHARDS_MIN + 1));
    meta.races[raceId].shards += shards;
    name = RACES[raceId]?.name || raceId;
  } else {
    /** 全种族满级：碎片没地方放，按广告箱的退化口径折成金币 */
    refund = 40;
    meta.gold += refund;
  }

  const seed = rng.chance(GOLD_CHEST_SEED_CHANCE);
  if (seed) meta.lifeSeeds = (meta.lifeSeeds || 0) + 1;

  return { ok: true, raceId, shards, refund, seed, name };
}

/* ---------------- 装备宝箱 ---------------- */

export const EQUIP_CHEST_COST = 80;

export function canOpenEquipChest(meta) {
  if ((meta.gold || 0) < EQUIP_CHEST_COST) {
    return { ok: false, reason: `古币不足（需 ${EQUIP_CHEST_COST}）` };
  }
  return { ok: true };
}

/**
 * 开一箱装备宝箱：扣 80 金 → 按全局稀有度权重随机一件，直接进账号装备库。
 * 装备库没有容量上限（v2.3 起），不用做满仓检查。
 */
export function openEquipChest(meta, rng) {
  const check = canOpenEquipChest(meta);
  if (!check.ok) return check;

  meta.gold -= EQUIP_CHEST_COST;
  const defId = pickEquipDefId(rng);
  const item = addEquipment(meta, defId);
  return { ok: true, item, name: equipName(item) };
}

/* ---------------- 命数之种 ---------------- */

/** 命数可以高出种族上限多少。防"买命"变成硬通货，但满命也能用 */
export const LIFE_SEED_CAP_OVER = 2;

export function seedCapOf(ch) {
  return (ch?.maxLives ?? 0) + LIFE_SEED_CAP_OVER;
}

export function canUseLifeSeed(meta, ch) {
  if (!ch) return { ok: false, reason: '找不到这个角色' };
  if (ch.status === 'dead') return { ok: false, reason: '他已经在墓地里了' };
  if (meta.run?.characterId === ch.id) return { ok: false, reason: '他正在塔里，出来再种' };
  if ((meta.lifeSeeds || 0) < 1) return { ok: false, reason: '没有命数之种（商城古币宝箱有概率掉）' };
  if (ch.lives >= seedCapOf(ch)) {
    return { ok: false, reason: `命数已到上限 ${seedCapOf(ch)}（种族 ${ch.maxLives} + 2）` };
  }
  return { ok: true, cap: seedCapOf(ch) };
}

/**
 * 种下一颗命数之种：+1 命数，封顶种族命数 +2。
 * 直接改 roster 里的角色本体（命数不在 initial 回滚快照里，阵亡回滚碰不到它）。
 */
export function useLifeSeed(meta, ch) {
  const check = canUseLifeSeed(meta, ch);
  if (!check.ok) return check;

  meta.lifeSeeds -= 1;
  ch.lives += 1;
  return { ok: true, lives: ch.lives, left: meta.lifeSeeds };
}
