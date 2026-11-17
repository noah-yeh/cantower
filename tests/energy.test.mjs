/**
 * 能量上限途径测试（v3.62）。
 *
 * 用户需求的三条硬约束，每条都有测试钉住：
 *   1. 能量上限的局内途径只有三类：两件宝物（星辉烛台 / 月苔圣杯）+ 一个稀有事件（星髓神龛）；
 *   2. 普通途径全部夹在 10 的硬顶 —— "大部分卡组最后都不会超过 10 个能量"；
 *   3. 唯一能破顶的是青苔族专属的月苔圣杯（+2，最高 12），
 *      且别的种族**在出池阶段就看不到它**，不是"看到也买不了"。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRun } from '../src/core/run.js';
import { triggerCell } from '../src/core/run.js';
import { writeBackToCharacter } from '../src/core/run.js';
import { buildReward } from '../src/core/run.js';
import { activateRelicInRun } from '../src/core/run.js';
import { createCharacter } from '../src/core/roster.js';
import { RELICS, applyRelicStats, relicAvailableFor, relicRarity } from '../src/core/relics.js';
import { ENERGY_CAP, ENERGY_OVERCAP } from '../src/core/leveling.js';
import { CELL } from '../src/core/dungeon.js';
import { Rng } from '../src/core/rng.js';
import { makeEnemy } from '../src/core/enemies.js';

/** 造一个已进图的角色 run（不进战斗） */
function makeRun({ classId = 'mage', raceId = 'moss', energy = 8, seed = 7 } = {}) {
  const ch = createCharacter({ classId, raceId, seed });
  ch.energy = energy;
  const run = createRun({ character: ch, seed });
  run.phase = 'map';
  return { run, ch };
}

/** 把某一格换成事件格并触发，返回触发结果 */
function fireShrine(run) {
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs' && c.kind !== CELL.EVENT);
  run.floorMap.cells[idx] = { kind: CELL.EVENT, revealed: true, done: false, data: { event: 'shrine' } };
  return triggerCell(run, idx);
}

test('星辉烛台：能量上限 +1，普通途径夹在 10', () => {
  const { run } = makeRun({ energy: 8 });
  const p = run.player;

  applyRelicStats(p, RELICS.starCandle);
  assert.equal(p.energy, 9, '8 → 9');

  p.energy = ENERGY_CAP;
  applyRelicStats(p, RELICS.starCandle);
  assert.equal(p.energy, ENERGY_CAP, '已到 10 再拿烛台不再涨（用户约束：大部分卡组 ≤10）');
});

test('月苔圣杯：青苔族专属，可破顶到 12，别的种族出池即过滤', () => {
  assert.equal(relicAvailableFor('moonChalice', 'moss'), true, '青苔族可见');
  for (const race of ['stone', 'shade', 'ember']) {
    assert.equal(relicAvailableFor('moonChalice', race), false, `${race} 不可见`);
  }
  assert.equal(relicAvailableFor('starCandle', 'stone'), true, '普通件全民可见');

  const { run } = makeRun({ raceId: 'moss', energy: ENERGY_CAP });
  applyRelicStats(run.player, RELICS.moonChalice);
  assert.equal(run.player.energy, ENERGY_OVERCAP, '10 → 12（唯一破顶途径）');
  applyRelicStats(run.player, RELICS.starCandle);
  assert.equal(run.player.energy, ENERGY_OVERCAP, '破顶后再拿普通件也不会超（上限已是 12）');
});

test('星髓神龛事件：能量 +1，满 10 时白来且直说', () => {
  const { run } = makeRun({ energy: 8 });
  const res = fireShrine(run);
  assert.match(res.text, /能量上限 \+1/);
  assert.equal(run.player.energy, 9);

  const { run: run2 } = makeRun({ energy: ENERGY_CAP });
  const res2 = fireShrine(run2);
  assert.match(res2.text, /已达上限/);
  assert.equal(run2.player.energy, ENERGY_CAP, '满顶不涨');
});

test('战斗中激活烛台：当前战斗的 energyCap 同步抬升，下回合按新上限回能', () => {
  const { run } = makeRun({ classId: 'warrior', raceId: 'stone', energy: 8 });
  /** 手动摆一场战斗：造敌人格 → triggerCell */
  const idx = run.floorMap.cells.findIndex((c) => !c.done && c.kind !== 'stairs');
  run.floorMap.cells[idx] = {
    kind: CELL.ENEMY, revealed: true, done: false,
    data: { tier: 'normal', enemy: makeEnemy(1, new Rng(3), 'normal') },
  };
  triggerCell(run, idx);
  assert.equal(run.phase, 'battle');
  assert.equal(run.battle.player.energyCap, 8);

  run.relicSlots.push('starCandle');
  run.materials = 10;
  const res = activateRelicInRun(run, 'starCandle', 3);
  assert.equal(res.ok, true);
  assert.equal(run.player.energy, 9, 'run 侧 +1');
  assert.equal(run.battle.player.energyCap, 9, 'battle 侧 cap 同步');
  assert.equal(run.battle.player.energy, 9, '当前能量也 +1（战斗中拿到就能多打）');
});

test('存活归来：能量上限写回角色；阵亡回滚回到招募掷点', () => {
  const { run, ch } = makeRun({ energy: 8 });
  run.player.energy = 11; // 青苔：神龛 + 烛台 + 圣杯的合理终点
  writeBackToCharacter(run, ch);
  assert.equal(ch.energy, 11, '写回 run.player.energy');
});

test('出池权重：三选一里普通件概率是能量件的 ~3 倍；非青苔族刷不到圣杯', () => {
  const { run: mossRun } = makeRun({ raceId: 'moss' });
  const { run: stoneRun } = makeRun({ raceId: 'stone', classId: 'warrior' });

  assert.equal(relicRarity('starCandle'), 0.35);
  assert.equal(relicRarity('anvil'), 1, '普通件权重 1');

  /** 800 次战后三选一：圣杯只给青苔族刷出，烛台两边都可能出现但都稀有 */
  let mossChalice = 0, stoneChalice = 0, candle = 0;
  for (let i = 0; i < 800; i++) {
    const mossOpts = buildReward(mossRun, 'boss').options;
    if (mossOpts.some((o) => o.kind === 'relic' && o.id === 'moonChalice')) mossChalice++;
    const stoneOpts = buildReward(stoneRun, 'boss').options;
    if (stoneOpts.some((o) => o.kind === 'relic' && o.id === 'moonChalice')) stoneChalice++;
    if (stoneOpts.some((o) => o.kind === 'relic' && o.id === 'starCandle')) candle++;
  }
  assert.equal(stoneChalice, 0, '石头人 800 层 boss 奖励零圣杯（出池过滤）');
  assert.ok(mossChalice > 0, '青苔族能刷到圣杯');
  assert.ok(candle > 0 && candle < 200, `烛台出现但稀有（实际 ${candle}/800）`);
});
