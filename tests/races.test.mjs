/**
 * 种族养成（v3.89）—— 解锁 / 等级 / 碎片 / 宝箱 / 迁移 / 掷点
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeta } from '../src/core/meta.js';
import {
  RACE_MAX_LEVEL, SHARDS_PER_LEVEL, SHARDS_TO_UNLOCK, RACE_START,
  raceState, raceBonus, unlockedRaces,
  canUnlock, unlockRace, canLevelUp, levelUpRace,
  shardPool, pickShardRace, grantShardBox, reviveRaceState,
} from '../src/core/races.js';
import { RACE_IDS, LIVES_MIN, LIVES_MAX, CLASS_IDS } from '../src/core/characters.js';
import { rollCharacter } from '../src/core/characters.js';
import { createCharacter } from '../src/core/roster.js';
import { Rng } from '../src/core/rng.js';

const meta = (over = {}) => {
  const m = createMeta(20261117);
  Object.assign(m, over);
  return m;
};

/* ---------------- 加成表 ---------------- */

test('raceBonus：0 级全 0，每级 +1 生命', () => {
  assert.deepEqual(raceBonus(0), { hp: 0, atk: 0, def: 0, crit: 0, dodge: 0, recovery: 0 });
  assert.equal(raceBonus(1).hp, 1);
  assert.equal(raceBonus(10).hp, 10);
});

test('raceBonus：每 5 级给 1 点面板，按 防御/暴击/闪避/恢复 轮', () => {
  const b5 = raceBonus(5);
  assert.equal(b5.def, 1);
  assert.equal(b5.crit, 0);
  const b10 = raceBonus(10);
  assert.equal(b10.def, 1);
  assert.equal(b10.crit, 1);
  const b30 = raceBonus(30);
  assert.deepEqual(
    [b30.def, b30.crit, b30.dodge, b30.recovery],
    [2, 2, 1, 1],
    '30 级面板 = 防御2 暴击2 闪避1 恢复1（共 6 点）',
  );
});

test('raceBonus：攻击只在 15 / 30 级给，满级共 +2', () => {
  assert.equal(raceBonus(14).atk, 0);
  assert.equal(raceBonus(15).atk, 1);
  assert.equal(raceBonus(29).atk, 1);
  assert.equal(raceBonus(30).atk, 2);
});

test('raceBonus：超上限夹住、负数当 0', () => {
  assert.equal(raceBonus(99).hp, RACE_MAX_LEVEL);
  assert.equal(raceBonus(-5).hp, 0);
});

/* ---------------- 初始状态 ---------------- */

test('新档只解锁石头人，等级碎片全 0', () => {
  const m = meta();
  assert.equal(unlockedRaces(m).length, 1);
  assert.equal(unlockedRaces(m)[0], RACE_START);
  for (const id of RACE_IDS) {
    assert.equal(raceState(m, id).level, 0);
    assert.equal(raceState(m, id).shards, 0);
  }
});

/* ---------------- 解锁 ---------------- */

test('解锁：碎片不够拒绝并给理由，够了扣 20 留余额', () => {
  const m = meta();
  m.races.moss.shards = SHARDS_TO_UNLOCK - 1;
  const no = canUnlock(m, 'moss');
  assert.equal(no.ok, false);
  assert.match(no.reason, /差 1 块/);

  m.races.moss.shards = SHARDS_TO_UNLOCK + 5;
  const yes = unlockRace(m, 'moss');
  assert.equal(yes.ok, true);
  assert.equal(m.races.moss.unlocked, true);
  assert.equal(m.races.moss.shards, 5, '解锁不清零，多出来的留着升级');
});

test('已解锁的种族再解锁直接拒绝', () => {
  const m = meta();
  assert.equal(canUnlock(m, RACE_START).ok, false);
});

/* ---------------- 升级 ---------------- */

test('升级：10 碎片一级，等级 +1，碎片扣掉', () => {
  const m = meta();
  m.races.stone = { unlocked: true, level: 0, shards: 25 };
  const res = levelUpRace(m, 'stone');
  assert.equal(res.ok, true);
  assert.equal(res.level, 1);
  assert.equal(m.races.stone.level, 1);
  assert.equal(m.races.stone.shards, 25 - SHARDS_PER_LEVEL);
});

test('满级不能再升', () => {
  const m = meta();
  m.races.stone = { unlocked: true, level: RACE_MAX_LEVEL, shards: 999 };
  assert.equal(canLevelUp(m, 'stone').ok, false);
  assert.equal(levelUpRace(m, 'stone').ok, false);
});

test('未解锁不能升级', () => {
  const m = meta();
  assert.equal(canLevelUp(m, 'moss').ok, false);
});

/* ---------------- 宝箱 ---------------- */

test('宝箱池：未解锁权重最高、满级不进池', () => {
  const m = meta();
  m.races.stone = { unlocked: true, level: RACE_MAX_LEVEL, shards: 0 };
  const pool = shardPool(m);
  const ids = pool.map((x) => x.raceId);
  assert.ok(!ids.includes('stone'), '满级石头人不进池');
  const weights = Object.fromEntries(pool.map((x) => [x.raceId, x.weight]));
  assert.equal(weights.moss, 3, '未解锁权重 3');
  for (const id of ['shade', 'ember']) assert.equal(weights[id], 3);
});

test('宝箱池：已解锁未满级权重 2', () => {
  const m = meta();
  m.races.stone = { unlocked: true, level: 5, shards: 0 };
  const pool = shardPool(m).filter((x) => x.raceId === 'stone');
  assert.equal(pool[0]?.weight, 2);
});

test('pickShardRace：单元素池永远出它', () => {
  const pool = [{ raceId: 'moss', weight: 1 }];
  for (let i = 0; i < 20; i++) {
    assert.equal(pickShardRace(pool, new Rng(i + 1)), 'moss');
  }
});

test('grantShardBox：发 6~12 块碎片进对应种族', () => {
  const m = meta();
  const got = grantShardBox(m, new Rng(7));
  assert.equal(got.ok, true);
  assert.ok(got.raceId, '应该抽到一个种族');
  assert.ok(got.shards >= 6 && got.shards <= 12, `碎片在区间内（${got.shards}）`);
  assert.equal(m.races[got.raceId].shards, got.shards);
});

test('grantShardBox：全满级退化成金币，广告不白看', () => {
  const m = meta();
  for (const id of RACE_IDS) {
    m.races[id] = { unlocked: true, level: RACE_MAX_LEVEL, shards: 0 };
  }
  const goldBefore = m.gold;
  const got = grantShardBox(m, new Rng(7));
  assert.equal(got.ok, true);
  assert.equal(got.raceId, null);
  assert.equal(got.gold, 40);
  assert.equal(m.gold, goldBefore + 40);
});

/* ---------------- 迁移 ---------------- */

test('reviveRaceState：老档没字段时只解锁开局种族', () => {
  const st = reviveRaceState(undefined, []);
  assert.equal(st[RACE_START].unlocked, true);
  for (const id of RACE_IDS) {
    if (id !== RACE_START) assert.equal(st[id].unlocked, false);
  }
});

test('reviveRaceState：名册/墓地/探险里出现过的种族自动解锁', () => {
  const st = reviveRaceState(undefined, ['moss', 'shade']);
  assert.equal(st.moss.unlocked, true);
  assert.equal(st.shade.unlocked, true);
  assert.equal(st.ember.unlocked, false);
});

test('reviveRaceState：已有数据原样保留（能救就救）', () => {
  const st = reviveRaceState({
    stone: { unlocked: true, level: 12, shards: 34 },
    moss: { unlocked: true, level: 3, shards: 7 },
    shade: { unlocked: false, level: 0, shards: 1 },
    ember: { unlocked: true, level: 40, shards: -5 },
  }, []);
  assert.equal(st.stone.level, 12);
  assert.equal(st.stone.shards, 34);
  assert.equal(st.moss.unlocked, true);
  assert.equal(st.shade.unlocked, false);
  assert.equal(st.ember.level, RACE_MAX_LEVEL, '超上限夹住');
  assert.equal(st.ember.shards, 0, '负数碎片按 0');
});

/* ---------------- 掷点 ---------------- */

test('rollCharacter：raceLevel 不传时行为与旧版一致（旧种子不变）', () => {
  const a = rollCharacter('warrior', 'stone', new Rng(42));
  const b = rollCharacter('warrior', 'stone', new Rng(42), 0);
  assert.equal(a.maxHp, b.maxHp);
  assert.equal(a.atk, b.atk);
  assert.equal(a.def, b.def);
});

test('rollCharacter：30 级加成 = 基础区间整体上移', () => {
  const lo = rollCharacter('warrior', 'stone', new Rng(42), 0);
  const hi = rollCharacter('warrior', 'stone', new Rng(42), 30);
  assert.equal(hi.maxHp, lo.maxHp + 30, '生命上下限整体 +30');
  assert.equal(hi.atk, lo.atk + 2, '攻击 +2');
  assert.equal(hi.def, lo.def + 2, '面板按 PANEL_STEPS 分配');
  assert.equal(hi.crit, lo.crit + 2);
  assert.equal(hi.dodge, lo.dodge + 1);
  assert.equal(hi.recovery, lo.recovery + 1);
  assert.equal(hi.energy, lo.energy, '能量不加');
});

test('rollCharacter：种子与 raceLevel 都相同时结果可复现', () => {
  const a = rollCharacter('mage', 'ember', new Rng(9), 7);
  const b = rollCharacter('mage', 'ember', new Rng(9), 7);
  assert.deepEqual([a.maxHp, a.atk, a.def, a.crit], [b.maxHp, b.atk, b.def, b.crit]);
});

/* ---------------- 命数随机（v3.93） ---------------- */

test('命数：招募时掷 5~8，和种族无关', () => {
  const seen = new Set();
  for (const raceId of RACE_IDS) {
    const vals = [];
    for (let seed = 1; seed <= 40; seed++) {
      const ch = createCharacter({ classId: CLASS_IDS[seed % CLASS_IDS.length], raceId, seed });
      assert.ok(ch.lives >= LIVES_MIN && ch.lives <= LIVES_MAX,
        `${raceId} seed ${seed} 命数 ${ch.lives} 超出 ${LIVES_MIN}~${LIVES_MAX}`);
      assert.equal(ch.maxLives, ch.lives, '满命数 = 初始命数');
      vals.push(ch.lives);
      seen.add(ch.lives);
    }
    /** 每个种族内部都得掷出不同命数 —— 否则等于还是"种族决定命数" */
    assert.ok(new Set(vals).size >= 2, `${raceId} 40 次招募命数全一样（${vals[0]}），没在随机`);
  }
  /** 5~8 四个值都该出现（160 次抽样，缺一个就说明区间写错了） */
  assert.deepEqual([...seen].sort(), [LIVES_MIN, LIVES_MIN + 1, LIVES_MIN + 2, LIVES_MAX]);
});

test('命数：同种子可复现（存读档不会洗掉命数）', () => {
  const a = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 424242 });
  const b = createCharacter({ classId: 'warrior', raceId: 'stone', seed: 424242 });
  assert.equal(a.lives, b.lives);
  assert.deepEqual(a.deck, b.deck, '命数的掷点位置不该把卡组洗掉');
});
