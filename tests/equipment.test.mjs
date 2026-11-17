/**
 * 装备与庄园（v2.3）
 *
 * 这一套规则的价值全在"边界"上，所以测试只盯边界：
 *   - 强化第 N 级要 N 个星屑、总共 55 个、封顶 +10
 *   - 一个角色只能穿 2 件，别人的不能抢
 *   - 装备**不进角色的回滚快照**：人死了装备还在（这是用户最在意的一条）
 *   - 加成只进这一趟 run，活着回写不叠加（不减就会每趟 +2，滚成天文数字）
 *   - 庄园只收已转正的人，产量按真实时间算、库存封顶
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createMeta, bury, SAVE_VERSION } from '../src/core/meta.js';
import { createCharacter } from '../src/core/roster.js';
import {
  EQUIP_SLOTS, MAX_ENHANCE, equipStats, equipBonus, enhanceCost, totalEnhanceCost,
  addEquipment, equipItem, unequipItem, enhanceItem, itemsOf, equippedSnapshot,
  equipTitle, itemText, enhancePreview, EQUIP_IDS, EQUIP_DEFS,
  recycleValue, recycleItem, combineShards, SHARDS_PER_STARDUST,
  pickEquipDefId, EQUIP_RARITY,
} from '../src/core/equipment.js';
import {
  MANOR_INTERVAL_MS, MANOR_CAP, manorState, tickManor, collectManor,
  canConvertToManor, convertToManor,
} from '../src/core/manor.js';
import { createRun, writeBackToCharacter } from '../src/core/run.js';
import { simulateArena } from '../src/core/arena.js';
import { rollTreasure } from '../src/core/dungeon.js';
import { Rng } from '../src/core/rng.js';
import { loadMeta } from '../src/core/save.js';

const hero = (seed = 1, classId = 'warrior', raceId = 'stone') =>
  createCharacter({ classId, raceId, seed });

/* ------------------------------------------------------------------ *
 * 数值：初始要小，强化才是长期目标
 * ------------------------------------------------------------------ */

test('装备初始数值都很小，+10 才追得上一件宝物', () => {
  assert.equal(equipStats('ironSword', 0).atk, 2);
  assert.equal(equipStats('leatherArmor', 0).maxHp, 8);
  assert.equal(equipStats('woodShield', 0).def, 1);

  /** 每级只加一点点，+10 是这条线的天花板 */
  assert.equal(equipStats('ironSword', MAX_ENHANCE).atk, 12);
  assert.equal(equipStats('leatherArmor', MAX_ENHANCE).maxHp, 48);
  assert.equal(equipStats('boneDagger', MAX_ENHANCE).crit, 12);
});

test('每件装备的文案和数值来自同一份计算', () => {
  const item = { defId: 'ironSword', lv: 3 };
  assert.equal(equipTitle(item), '铁剑 +3');
  assert.equal(itemText(item), '攻击 +5');
  assert.equal(equipTitle({ defId: 'ironSword', lv: 0 }), '铁剑');

  const p = enhancePreview(item);
  assert.equal(p.cost, 4, '+3 → +4 要 4 个星屑');
  assert.equal(p.text, '攻击 +1');
  assert.equal(enhancePreview({ defId: 'ironSword', lv: MAX_ENHANCE }), null);
});

test('两件装备的加成会叠加', () => {
  const b = equipBonus([
    { defId: 'ironSword', lv: 0 },
    { defId: 'leatherArmor', lv: 2 },
  ]);
  assert.equal(b.atk, 2);
  assert.equal(b.maxHp, 16);
});

/* ------------------------------------------------------------------ *
 * 强化：第 N 级正好 N 个星屑
 * ------------------------------------------------------------------ */

test('强化第 N 级正好要 N 个星屑，+0 到 +10 一共 55 个', () => {
  assert.equal(enhanceCost(0), 1);
  assert.equal(enhanceCost(9), 10);
  assert.equal(totalEnhanceCost(), 55);

  const meta = createMeta(1);
  const it = addEquipment(meta, 'ironSword');
  meta.stardust = 3;

  assert.equal(enhanceItem(meta, it.id).ok, true); // +1 花 1
  assert.equal(it.lv, 1);
  assert.equal(meta.stardust, 2);

  assert.equal(enhanceItem(meta, it.id).ok, true); // +2 花 2
  assert.equal(it.lv, 2);
  assert.equal(meta.stardust, 0);

  const fail = enhanceItem(meta, it.id); // +3 要 3，没钱
  assert.equal(fail.ok, false);
  assert.match(fail.reason, /星屑不足/);
  assert.equal(it.lv, 2, '失败不能扣级');
});

test('强化封顶 +10', () => {
  const meta = createMeta(1);
  const it = addEquipment(meta, 'ironSword', MAX_ENHANCE);
  meta.stardust = 999;
  const res = enhanceItem(meta, it.id);
  assert.equal(res.ok, false);
  assert.match(res.reason, /\+10/);
  assert.equal(meta.stardust, 999, '到顶了不该扣材料');
});

test('星屑是账号资产：强化不依赖任何角色', () => {
  const meta = createMeta(1);
  meta.roster = []; /** v3.35 起新档自带初始角色，这条要证的是"跟角色无关" */
  const it = addEquipment(meta, 'woodShield');
  meta.stardust = 1;
  assert.equal(enhanceItem(meta, it.id).ok, true);
  assert.equal(meta.roster.length, 0);
});

/* ------------------------------------------------------------------ *
 * 穿戴：最多 2 件
 * ------------------------------------------------------------------ */

test('穿满 2 件再穿：自动换位（优先同槽位），别人的装备不能抢', () => {
  const meta = createMeta(2);
  const a = hero(3);
  const b = hero(4, 'mage', 'moss');
  meta.roster.push(a, b);

  const x = addEquipment(meta, 'ironSword');
  const y = addEquipment(meta, 'leatherArmor');
  const z = addEquipment(meta, 'woodShield');

  assert.equal(equipItem(meta, a.id, x.id).ok, true);
  assert.equal(equipItem(meta, a.id, y.id).ok, true);
  assert.equal(itemsOf(meta, a.id).length, EQUIP_SLOTS);

  /**
   * v3.72：装备库页只展示仓库（没有「卸下」），穿满再穿 = 自动换位。
   * 木盾（护具）优先换下同槽位的皮甲，铁剑不动。
   */
  const third = equipItem(meta, a.id, z.id);
  assert.equal(third.ok, true);
  assert.equal(third.swapped.id, y.id);
  assert.equal(itemsOf(meta, a.id).length, EQUIP_SLOTS);
  assert.equal(y.by, null);
  assert.equal(z.by, a.id);

  assert.equal(unequipItem(meta, x.id).ok, true);
  assert.equal(equipItem(meta, b.id, x.id).ok, true);

  const steal = equipItem(meta, a.id, x.id);
  assert.equal(steal.ok, false);
  assert.match(steal.reason, /别的角色/);
  assert.equal(itemsOf(meta, b.id).length, 1);
});

test('已经穿着的人再点穿上：拒绝但不报错', () => {
  const meta = createMeta(2);
  const a = hero(5);
  meta.roster.push(a);
  const it = addEquipment(meta, 'ironSword');
  equipItem(meta, a.id, it.id);
  const again = equipItem(meta, a.id, it.id);
  assert.equal(again.ok, false);
  assert.match(again.reason, /已经穿/);
});

test('装备快照可以直接喂给 run / 竞技场', () => {
  const meta = createMeta(2);
  const a = hero(6);
  meta.roster.push(a);
  const it = addEquipment(meta, 'boneDagger', 4);
  equipItem(meta, a.id, it.id);

  const snap = equippedSnapshot(meta, a.id);
  assert.deepEqual(snap, [{ defId: 'boneDagger', lv: 4 }]);
});

/* ------------------------------------------------------------------ *
 * 最要紧的一条：人死了，装备还在
 * ------------------------------------------------------------------ */

test('角色消失时装备退回库里，不会被一起埋掉', () => {
  const meta = createMeta(3);
  meta.roster = []; /** v3.35 起新档自带初始角色，只留这一个测试对象 */
  const ch = hero(7);
  meta.roster.push(ch);
  const it = addEquipment(meta, 'ironSword');
  equipItem(meta, ch.id, it.id);

  bury(meta, ch);

  assert.equal(meta.equipment.length, 1, '装备数量不变');
  assert.equal(meta.equipment[0].by, null, '已经脱回库里');
  assert.equal(meta.roster.length, 0);
});

test('转成庄园时装备也会脱下来', () => {
  const meta = createMeta(3);
  const ch = hero(8);
  meta.roster.push(ch);
  const it = addEquipment(meta, 'leatherArmor');
  equipItem(meta, ch.id, it.id);
  ch.veteran = true;

  assert.equal(convertToManor(meta, ch.id, 1000).ok, true);
  assert.equal(it.by, null);
});

/* ------------------------------------------------------------------ *
 * 加成只进这一趟
 * ------------------------------------------------------------------ */

test('装备加成进 run，但活着回写时会被减掉（不叠加）', () => {
  const ch = hero(9);
  const baseHp = ch.maxHp;
  const baseAtk = ch.atk;
  const eq = [{ defId: 'ironSword', lv: 0 }, { defId: 'leatherArmor', lv: 0 }];

  const run = createRun({ character: ch, seed: 11, equipment: eq });
  assert.equal(run.player.atk, baseAtk + 2);
  assert.equal(run.player.maxHp, baseHp + 8);
  assert.equal(run.player.hp, run.player.maxHp, '穿了加生命的装备，开局是满血');
  assert.equal(run.equip.length, 2);

  writeBackToCharacter(run, ch);
  assert.equal(ch.atk, baseAtk, '本体攻击不能被装备污染');
  assert.equal(ch.maxHp, baseHp, '本体生命不能被装备污染');

  /** 再进一次还是 +2，而不是 +4 */
  const run2 = createRun({ character: ch, seed: 12, equipment: eq });
  assert.equal(run2.player.atk, baseAtk + 2);
});

test('强化后的装备加成更高（+10 铁剑 = 攻击 +12）', () => {
  const ch = hero(10);
  const baseAtk = ch.atk;
  const run = createRun({ character: ch, seed: 13, equipment: [{ defId: 'ironSword', lv: MAX_ENHANCE }] });
  assert.equal(run.player.atk, baseAtk + 12);
});

test('竞技场镜像也吃装备加成（双方同一份规则）', () => {
  const ch = hero(11);
  const plain = simulateArena({ ...ch }, { ...ch }, 21);
  const geared = simulateArena({ ...ch, equipped: [{ defId: 'leatherArmor', lv: 0 }] }, { ...ch }, 21);
  assert.equal(geared.playerMaxHp, plain.playerMaxHp + 8);
});

test('宝箱掉装备时带合法的 defId', () => {
  const ch = hero(12);
  const run = createRun({ character: ch, seed: 14 });
  const rng = new Rng(77);
  let seen = 0;
  for (let i = 0; i < 400; i++) {
    const r = rollTreasure(run, rng);
    if (r.kind === 'equip') {
      seen++;
      assert.ok(EQUIP_IDS.includes(r.defId), `${r.defId} 应该是合法装备`);
      assert.ok(EQUIP_DEFS[r.defId].name);
    }
  }
  assert.ok(seen > 0, '400 次里应该掉出过装备');
});

/* ------------------------------------------------------------------ *
 * 庄园
 * ------------------------------------------------------------------ */

test('只有已转正的角色能退役成庄园', () => {
  const ch = hero(15);
  assert.equal(canConvertToManor(ch).ok, false);
  ch.veteran = true;
  assert.equal(canConvertToManor(ch).ok, true);
  ch.status = 'dead';
  assert.equal(canConvertToManor(ch).ok, false);
});

test('庄园按小时产星屑，库存封顶后停产', () => {
  const meta = createMeta(5);
  meta.roster = []; /** v3.35 起新档自带初始角色，别混进"人离开了名册"的断言 */
  const ch = hero(16);
  ch.veteran = true;
  meta.roster.push(ch);

  assert.equal(convertToManor(meta, ch.id, 1000).ok, true);
  assert.equal(meta.roster.length, 0, '人离开了名册');
  assert.equal(meta.manors.length, 1);
  const m = meta.manors[0];

  assert.equal(manorState(m, 1000).stored, 0);
  assert.equal(manorState(m, 1000 + MANOR_INTERVAL_MS - 1).stored, 0, '差一秒不产出');
  assert.equal(manorState(m, 1000 + MANOR_INTERVAL_MS).stored, 1);
  assert.equal(manorState(m, 1000 + 8 * MANOR_INTERVAL_MS).stored, MANOR_CAP, '最多存 3 个');
  assert.equal(manorState(m, 1000 + 8 * MANOR_INTERVAL_MS).full, true);
});

test('收取后从当下重新计时，空庄园收不了', () => {
  const meta = createMeta(5);
  const ch = hero(17);
  ch.veteran = true;
  meta.roster.push(ch);
  convertToManor(meta, ch.id, 0);

  assert.equal(collectManor(meta, 0, 0).ok, false, '还没产出');

  const t = 5 * MANOR_INTERVAL_MS;
  const got = collectManor(meta, 0, t);
  assert.equal(got.ok, true);
  assert.equal(got.amount, MANOR_CAP);
  assert.equal(meta.stardust, MANOR_CAP);
  assert.equal(manorState(meta.manors[0], t).stored, 0, '重置');
});

test('离线很久回来：封顶就是封顶，不溢出', () => {
  const meta = createMeta(5);
  const ch = hero(18);
  ch.veteran = true;
  meta.roster.push(ch);
  convertToManor(meta, ch.id, 0);

  tickManor(meta.manors[0], 100 * MANOR_INTERVAL_MS);
  assert.equal(meta.manors[0].stored, MANOR_CAP);
  assert.equal(meta.manors[0].lastAt, 100 * MANOR_INTERVAL_MS, '满了就把表钉在当下');
});

/* ------------------------------------------------------------------ *
 * 存档迁移
 * ------------------------------------------------------------------ */

test('存档 v5 → v6：金币保留，装备 / 星屑 / 庄园 补空', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    const ch = hero(19);
    store.set('ruin-spire/hall', JSON.stringify({
      version: 5, seed: 41, gold: 777, roster: [ch], candidates: [], ghosts: [], graveyard: [], log: [],
    }));

    const meta = loadMeta(8_000_000_000_000);
    assert.equal(meta.version, SAVE_VERSION);
    assert.equal(meta.gold, 777, '金币不能丢');
    assert.equal(meta.roster.length, 1, '名册不能丢');
    assert.deepEqual(meta.equipment, []);
    assert.equal(meta.stardust, 0);
    assert.deepEqual(meta.manors, []);
  } finally {
    delete globalThis.localStorage;
  }
});

/* ------------------------------------------------------------------ *
 * 碎片回收（v2.3b）：重复装备 → 碎片 → 星屑，星屑主渠道仍是庄园
 * ------------------------------------------------------------------ */

test('回收基础规则：闲置装备给 1 碎片，装备离开装备库', () => {
  const meta = createMeta(1);
  const item = addEquipment(meta, 'ironSword');
  const before = meta.equipment.length;

  const res = recycleItem(meta, item.id);
  assert.equal(res.ok, true);
  assert.equal(res.gain, 1);
  assert.equal(meta.shards, 1);
  assert.equal(meta.equipment.length, before - 1, '回收后要从库里移除');
});

test('穿着中的装备不能回收（先卸下，留一次反悔机会）', () => {
  const meta = createMeta(1);
  const ch = hero(3);
  meta.roster.push(ch);
  const item = addEquipment(meta, 'ironSword');
  equipItem(meta, ch.id, item.id);

  const res = recycleItem(meta, item.id);
  assert.equal(res.ok, false);
  assert.equal(meta.equipment.length, 1, '装备还在库里');
  assert.equal(meta.shards || 0, 0, '没拿到碎片');
});

test('回收值随强化等级涨，但只返一半：强化→回收永远亏本', () => {
  assert.equal(recycleValue({ defId: 'ironSword', lv: 0 }), 1);
  assert.equal(recycleValue({ defId: 'ironSword', lv: 1 }), 1);
  assert.equal(recycleValue({ defId: 'ironSword', lv: 2 }), 2);
  assert.equal(recycleValue({ defId: 'ironSword', lv: 10 }), 6, '+10 全程投 55 星屑，回收只给 6 碎片');

  const meta = createMeta(1);
  meta.stardust = 100;
  const item = addEquipment(meta, 'ironSword', 10);
  recycleItem(meta, item.id);
  // 强化 +10 花 55 星屑，回收拿 6 碎片（10:1 ≈ 0.6 星屑）——刷碎片不可能成立
  assert.ok(meta.shards < 55, '回收返还必须远低于强化投入');
});

test('碎片合成星屑：攒够才合，多余保留（合成比见 SHARDS_PER_STARDUST）', () => {
  const K = SHARDS_PER_STARDUST;
  const meta = createMeta(1);
  meta.shards = K - 1;
  assert.equal(combineShards(meta).ok, false);
  assert.equal(meta.stardust, 0, '没合成成功星屑不变');

  meta.shards = K;
  const res = combineShards(meta);
  assert.equal(res.ok, true);
  assert.equal(meta.stardust, 1);
  assert.equal(meta.shards, 0);

  meta.shards = 2 * K - 2;
  combineShards(meta);
  assert.equal(meta.shards, K - 2, '只扣一份');
  assert.equal(meta.stardust, 2);
});

test('回收 + 合成走通整条链：碎片是星屑的零头', () => {
  const meta = createMeta(1);
  for (let i = 0; i < SHARDS_PER_STARDUST; i++) {
    const it = addEquipment(meta, i % 2 ? 'ironSword' : 'leatherArmor');
    assert.equal(recycleItem(meta, it.id).ok, true);
  }
  assert.equal(meta.shards, SHARDS_PER_STARDUST);
  assert.equal(combineShards(meta).ok, true);
  assert.equal(meta.stardust, 1);

  // 经济模拟（tools/equip-econ.mjs）：掉落率压到一局 1~3 件后，
  // 10:1 时回收 ≈ 0.24✦/小时（肝）vs 庄园 0.25✦/小时（挂机、可叠）——
  // 回收是活跃玩家的零头，庄园是主渠道
  assert.equal(SHARDS_PER_STARDUST, 10, '合成比不许悄悄改');
});

test('稀有度：精良装备明显比常见难出，且所有 defId 合法', () => {
  const rng = new Rng(77);
  const cnt = {};
  for (const id of EQUIP_IDS) cnt[id] = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const id = pickEquipDefId(rng);
    assert.ok(EQUIP_IDS.includes(id), `非法 defId: ${id}`);
    cnt[id] += 1;
  }

  const commonSum = cnt.woodShield + cnt.clothBoots + cnt.boneNecklace;
  const fineSum = cnt.ironSword + cnt.leatherArmor + cnt.boneDagger;
  // 权重 26*3 vs 8+8+6：精良总占比应约 22%
  assert.ok(commonSum / N > 0.7, `常见合计应 >70%，实际 ${(commonSum / N * 100).toFixed(0)}%`);
  assert.ok(fineSum / N < 0.3, `精良合计应 <30%，实际 ${(fineSum / N * 100).toFixed(0)}%`);
  // 单件精良 ≈ 单件常见的 1/3 左右
  assert.ok(cnt.ironSword < cnt.woodShield / 2, '铁剑应明显比木盾难出');
});

test('稀有度字段完整：每件装备都有 rar，且精良只有三件', () => {
  const fine = EQUIP_IDS.filter((id) => EQUIP_DEFS[id].rar === 'fine');
  const common = EQUIP_IDS.filter((id) => EQUIP_DEFS[id].rar === 'common');
  assert.equal(fine.length + common.length, EQUIP_IDS.length, '每件都要有稀有度');
  assert.deepEqual(fine.sort(), ['boneDagger', 'ironSword', 'leatherArmor']);
});

test('存档补 shards 字段：旧档按 0 起步，已有值原样保留', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    const ch = hero(19);
    // v2.3 旧档：没有 shards 字段
    store.set('ruin-spire/hall', JSON.stringify({
      version: 6, seed: 41, gold: 500, stardust: 3, roster: [ch],
      candidates: [], ghosts: [], graveyard: [], log: [],
    }));
    const meta = loadMeta(8_000_000_000_000);
    assert.equal(meta.stardust, 3);
    assert.equal(meta.shards, 0, '旧档碎片按 0 补');

    // 新档：有 shards 就原样保留
    meta.shards = 7;
    store.set('ruin-spire/hall', JSON.stringify(meta));
    const again = loadMeta(8_000_000_000_000);
    assert.equal(again.shards, 7);
  } finally {
    delete globalThis.localStorage;
  }
});
