/**
 * 商城（v3.90）—— 古币宝箱 / 装备宝箱 / 命数之种 / 存档迁移
 *
 * 广告类的两个位在 races.test.mjs / ads 相关测试里，这里只测金币线。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeta } from '../src/core/meta.js';
import { RACE_MAX_LEVEL, RACE_START } from '../src/core/races.js';
import { EQUIP_IDS } from '../src/core/equipment.js';
import {
  GOLD_CHEST_COST, GOLD_CHEST_SHARDS_MIN, GOLD_CHEST_SHARDS_MAX,
  EQUIP_CHEST_COST, LIFE_SEED_CAP_OVER,
  canOpenGoldChest, openGoldChest,
  canOpenEquipChest, openEquipChest,
  canUseLifeSeed, useLifeSeed, seedCapOf,
} from '../src/core/mall.js';
import { loadMeta } from '../src/core/save.js';
import { Rng } from '../src/core/rng.js';

const meta = (over = {}) => {
  const m = createMeta(20261117);
  Object.assign(m, over);
  return m;
};

/* ---------------- 古币宝箱 ---------------- */

test('古币宝箱：钱不够拒绝并报差多少，够就扣 50 金', () => {
  const m = meta({ gold: GOLD_CHEST_COST - 1 });
  const no = canOpenGoldChest(m);
  assert.equal(no.ok, false);
  assert.match(no.reason, /古币不足/);

  m.gold = GOLD_CHEST_COST;
  const got = openGoldChest(m, new Rng(7));
  assert.equal(got.ok, true);
  assert.equal(m.gold, 0, '扣掉全部 50 金');
});

test('古币宝箱：碎片 3~6 块进对应种族（可复现）', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const m = meta({ gold: 1000 });
    const got = openGoldChest(m, new Rng(seed));
    assert.equal(got.ok, true);
    assert.ok(got.raceId, `种子 ${seed} 应该抽到种族`);
    assert.ok(
      got.shards >= GOLD_CHEST_SHARDS_MIN && got.shards <= GOLD_CHEST_SHARDS_MAX,
      `碎片在区间内（${got.shards}）`,
    );
    assert.equal(m.races[got.raceId].shards, got.shards);
    const again = openGoldChest(meta({ gold: 1000 }), new Rng(seed));
    assert.equal(again.shards, got.shards, '同种子同结果');
  }
});

test('古币宝箱：种子掉率是 10%（2000 箱统计）', () => {
  const m = meta({ gold: 1e9 });
  let seeds = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const got = openGoldChest(m, new Rng(1000 + i));
    if (got.seed) seeds++;
  }
  assert.ok(seeds > N * 0.06 && seeds < N * 0.14, `掉率应该在 10% 附近（${seeds}/${N}）`);
  assert.equal(m.lifeSeeds, seeds, '掉的种子都进了 meta.lifeSeeds');
});

test('古币宝箱：全种族满级时碎片折 40 金，种子照掷', () => {
  const m = meta({ gold: 1000 });
  for (const id of Object.keys(m.races)) {
    m.races[id] = { unlocked: true, level: RACE_MAX_LEVEL, shards: 0 };
  }
  const before = m.gold;
  const got = openGoldChest(m, new Rng(7));
  assert.equal(got.ok, true);
  assert.equal(got.raceId, null);
  assert.equal(got.refund, 40);
  assert.equal(m.gold, before - GOLD_CHEST_COST + 40);
});

/* ---------------- 装备宝箱 ---------------- */

test('装备宝箱：钱不够拒绝，够就扣 80 金并进装备库', () => {
  const m = meta({ gold: EQUIP_CHEST_COST - 1 });
  assert.equal(canOpenEquipChest(m).ok, false);

  m.gold = EQUIP_CHEST_COST;
  const got = openEquipChest(m, new Rng(11));
  assert.equal(got.ok, true);
  assert.ok(EQUIP_IDS.includes(got.item.defId), '开出的是真实装备');
  assert.equal(m.equipment.length, 1);
  assert.equal(m.equipment[0].defId, got.item.defId);
  assert.equal(m.equipment[0].by, null, '新装备在库里，没人穿');
  assert.equal(m.gold, 0);
});

/* ---------------- 命数之种 ---------------- */

test('seedCapOf：种族命数 + 2', () => {
  assert.equal(seedCapOf({ maxLives: 7 }), 7 + LIFE_SEED_CAP_OVER);
  assert.equal(seedCapOf(null), LIFE_SEED_CAP_OVER);
});

test('命数之种：没种子、在塔里、已满顶都拒绝并给理由', () => {
  const m = meta({ lifeSeeds: 1 });
  const ch = m.roster[0];

  m.lifeSeeds = 0;
  assert.match(canUseLifeSeed(m, ch).reason, /没有命数之种/);
  m.lifeSeeds = 1;

  m.run = { characterId: ch.id, floor: 3 };
  assert.match(canUseLifeSeed(m, ch).reason, /正在塔里/);
  m.run = null;

  ch.lives = ch.maxLives + LIFE_SEED_CAP_OVER;
  assert.match(canUseLifeSeed(m, ch).reason, /上限/);
});

test('命数之种：+1 命数扣一颗种子，可以高出种族上限', () => {
  const m = meta({ lifeSeeds: 2 });
  const ch = m.roster[0];
  ch.lives = ch.maxLives; // 满命也能用 —— 封顶是 maxLives+2
  const res = useLifeSeed(m, ch);
  assert.equal(res.ok, true);
  assert.equal(ch.lives, ch.maxLives + 1);
  assert.equal(m.lifeSeeds, 1);
});

test('命数之种：死人不给种', () => {
  const m = meta({ lifeSeeds: 1 });
  assert.equal(canUseLifeSeed(m, null).ok, false);
  const dead = { status: 'dead', lives: 0, maxLives: 7 };
  assert.equal(canUseLifeSeed(m, dead).ok, false);
});

/* ---------------- 存档迁移 ---------------- */

test('reviveMeta：lifeSeeds 旧档没有按 0 补，有就保留', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    store.set('ruin-spire/hall', JSON.stringify({
      version: 8, seed: 5, gold: 500,
      roster: [], ghosts: [], graveyard: [], counter: 1, log: [],
    }));
    const none = loadMeta(1);
    assert.equal(none.lifeSeeds, 0, '旧档没有种子按 0 补');

    store.set('ruin-spire/hall', JSON.stringify({
      version: 8, seed: 5, gold: 500, lifeSeeds: 5,
      roster: [], ghosts: [], graveyard: [], counter: 1, log: [],
    }));
    const keep = loadMeta(1);
    assert.equal(keep.lifeSeeds, 5, '已有的种子保留');

    store.set('ruin-spire/hall', JSON.stringify({
      version: 8, seed: 5, gold: 500, lifeSeeds: -3.7,
      roster: [], ghosts: [], graveyard: [], counter: 1, log: [],
    }));
    const dirty = loadMeta(1);
    assert.equal(dirty.lifeSeeds, 0, '负数 / 小数夹成 0');
  } finally {
    delete globalThis.localStorage;
  }
});
