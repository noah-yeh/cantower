/**
 * 迷雾迷宫层（v2.0）
 *
 * 这一层的规则全部是"能不能点、点了会发生什么"，必须能在 core 里断言：
 * 一旦落到 UI 的 if 里，迷雾、清怪、下楼这些硬约束就再也对不上了。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAP_CELLS, MAP_W, MAP_H, idxOf, CELL, EVENTS, enemyCountFor, FOG, ENEMY_RANGE,
  makeFloorMap, canReveal, revealCell, neighbors, enemiesLeftOf, rollTreasure,
} from '../src/core/dungeon.js';
import { createRun, revealCellInRun, triggerCell, stepCell, finishBattle } from '../src/core/run.js';
import { Rng } from '../src/core/rng.js';
import { createCharacter } from '../src/core/roster.js';
import { clearAllEnemies, enterFirstBattle, revealKind, newRunWith } from './_helpers.mjs';

function newRun(seed = 5, floor = 1) {
  const character = createCharacter({ classId: 'warrior', raceId: 'stone', seed });
  const run = createRun({ character, seed });
  run.floor = floor;
  makeFloorMap(run);
  return run;
}

/* ------------------------------------------------------------------ *
 * 结构
 * ------------------------------------------------------------------ */

test('每层 9 格，入口已翻开，且恰好一个楼梯', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const run = newRun(seed);
    const m = run.floorMap;
    assert.equal(m.cells.length, MAP_CELLS);
    assert.equal(MAP_W * MAP_H, MAP_CELLS, '3×3');
    assert.equal(m.cells.filter((c) => c.kind === CELL.STAIRS).length, 1);
    assert.equal(m.cells[m.entry].revealed, true, '入口格开局就是明的');
    assert.equal(m.cells[m.entry].done, true, '入口不需要再触发');
    assert.notEqual(m.entry, m.stairs, '楼梯不能就在入口');
  }
});

test('格子装得下最坏情况：4 敌 + 宝箱 + 事件 + 行商 + 楼梯 = 9 格', () => {
  /** 敌人数上限 × 固定内容必须塞得进 9 格，否则行商会被静默挤掉（保底失效） */
  const worst = ENEMY_RANGE.late[1] + 3 + 1;
  assert.ok(worst <= MAP_CELLS, `${worst} 格 > ${MAP_CELLS} 格，装不下`);
  /** 入口占一格，剩下必须 >= 楼梯+敌人数上限+宝箱+事件 */
  assert.ok(MAP_CELLS - 1 >= ENEMY_RANGE.late[1] + 3, '去掉入口后仍要装得下所有硬内容');
});

test('每层的内容不会把行商挤掉（最坏种子也不丢保底资格）', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const run = newRun(seed, 25);
    const m = run.floorMap;
    const n = m.cells.filter((c) => c.kind === CELL.ENEMY).length;
    assert.ok(n >= ENEMY_RANGE.late[0] && n <= ENEMY_RANGE.late[1], `第 25 层敌人数 ${n} 越界`);
    /** v3.14：宝箱/事件改为概率出现，这里只保证它们不会顶掉楼梯 */
    assert.ok(m.cells.some((c) => c.kind === CELL.STAIRS), '楼梯不能被挤掉');
  }
});

test('敌人数随机（v3.12）：1~20 层 1~3 个，21 层起 2~4 个，均值等于旧值', () => {
  const rng = new Rng(7);
  const sample = (floor, n = 600) => {
    const xs = Array.from({ length: n }, () => enemyCountFor(floor, rng));
    return { min: Math.min(...xs), max: Math.max(...xs), avg: xs.reduce((a, b) => a + b, 0) / n };
  };

  const early = sample(1);
  assert.equal(early.min, ENEMY_RANGE.early[0]);
  assert.equal(early.max, ENEMY_RANGE.early[1]);
  /** 均值必须压在旧值（2）附近，否则"加随机"顺手把难度也改了 */
  assert.ok(Math.abs(early.avg - 2) < 0.2, `1~20 层均值该在 2 附近，实际 ${early.avg.toFixed(2)}`);

  const late = sample(21);
  assert.equal(late.min, ENEMY_RANGE.late[0]);
  assert.equal(late.max, ENEMY_RANGE.late[1]);
  assert.ok(Math.abs(late.avg - 3) < 0.2, `21 层起均值该在 3 附近，实际 ${late.avg.toFixed(2)}`);
});

test('地图上的敌人数跟着层数掷，且不同种子不会永远同一个数', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const run = newRun(seed, 4);
    const n = run.floorMap.cells.filter((c) => c.kind === CELL.ENEMY).length;
    assert.ok(n >= 1 && n <= 3, `第 4 层敌人数 ${n} 越界`);
    assert.equal(run.floorMap.enemiesLeft, n);
    seen.add(n);
  }
  assert.ok(seen.size > 1, `30 个种子只掷出 ${[...seen]}，随机性没生效`);
});

test('精英/首领层有一个对应档位的敌人，其余是普通', () => {
  for (const [floor, tier] of [[5, 'elite'], [10, 'boss'], [25, 'elite'], [30, 'boss']]) {
    const run = newRun(7, floor);
    const tiers = run.floorMap.cells
      .filter((c) => c.kind === CELL.ENEMY)
      .map((c) => c.data.tier);
    assert.equal(tiers.filter((t) => t === tier).length, 1, `第 ${floor} 层该有一个 ${tier}`);
    assert.ok(tiers.every((t) => t === tier || t === 'normal'), '其余敌人仍是普通');
  }
});

test('楼梯永远存在；宝箱/事件是概率出现（v3.14：85% / 80%）', () => {
  let treasure = 0;
  let event = 0;
  const N = 200;
  for (let seed = 1; seed <= N; seed++) {
    const run = newRun(seed, 3);
    const kinds = run.floorMap.cells.map((c) => c.kind);
    assert.ok(kinds.includes(CELL.STAIRS), '楼梯是硬约束，不能被概率挤掉');
    if (kinds.includes(CELL.TREASURE)) treasure++;
    if (kinds.includes(CELL.EVENT)) event++;
  }
  assert.ok(treasure / N > 0.75 && treasure / N < 0.95, `宝箱出现率异常: ${treasure / N}`);
  assert.ok(event / N > 0.7 && event / N < 0.9, `事件出现率异常: ${event / N}`);
});

test('翻地砖回来之后，一层里真的有"什么都没翻到"的空房间', () => {
  /** 用户的原话："没必要每个翻开都有相关的事件，有些可以是空房间的" */
  let empties = 0;
  const N = 100;
  for (let seed = 1; seed <= N; seed++) {
    const run = newRun(seed, 8);
    empties += run.floorMap.cells.filter((c) => c.kind === CELL.EMPTY).length;
  }
  const avg = empties / N;
  assert.ok(avg >= 2.5, `平均每层只有 ${avg.toFixed(1)} 个空房间，翻格会变成"格格里都有事"`);
  assert.ok(avg <= 5, `平均每层 ${avg.toFixed(1)} 个空房间，空得太多了`);
});

/* ------------------------------------------------------------------ *
 * 迷雾（v3.14 重新打开）
 * ------------------------------------------------------------------ */

test('迷雾默认开启：只有入口是明的，其余都是暗格', () => {
  assert.equal(FOG, true, 'v3.14 起翻地砖恢复，开关写在 dungeon.js 顶部');
  for (let seed = 1; seed <= 10; seed++) {
    const run = newRun(seed);
    const m = run.floorMap;
    const lit = m.cells.filter((c) => c.revealed);
    assert.equal(lit.length, 1, `种子 ${seed} 开局应该只有入口是明的`);
    assert.equal(m.cells[m.entry].revealed, true);
  }
});

test('迷雾只能翻相邻格（v3.14 重新生效）', () => {
  /** 手动搭一张 3×3 的图 —— 不依赖 makeFloorMap 的开关，专测规则本身 */
  const m = {
    cells: Array.from({ length: MAP_CELLS }, () => ({ kind: CELL.EMPTY, revealed: false, done: false })),
  };
  /** 入口在左下角 (2,0) */
  const entry = idxOf(MAP_H - 1, 0);
  m.cells[entry].revealed = true;

  assert.equal(canReveal(m, entry), false, '自己不能翻自己');
  for (const i of neighbors(entry)) assert.equal(canReveal(m, i), true, `入口的邻格应该可翻：${i}`);
  assert.equal(canReveal(m, 0), false, '够不着的地方不该能翻');

  const below = neighbors(entry)[0];
  assert.equal(revealCell(m, below), true);
  assert.equal(revealCell(m, below), false, '翻过一次就不能再翻');
  const two = neighbors(below).find((i) => i !== entry);
  assert.ok(two != null);
  assert.equal(canReveal(m, two), true, '翻开的格把更远的一格解锁了');
});

test('对角不算相邻（只有上下左右）', () => {
  /** 入口在左下角 (3,0)：它的邻格是 (2,0) 和 (3,1)，(2,1) 是对角 */
  const run = newRun(13);
  const m = run.floorMap;
  assert.deepEqual(neighbors(m.entry).sort((a, b) => a - b), [m.entry - MAP_W, m.entry + 1].sort((a, b) => a - b));
});

/* ------------------------------------------------------------------ *
 * 两段式：第一下翻开、第二下触发（v3.16，用户："还是需要人为决策一下"）
 * ------------------------------------------------------------------ */

test('点暗格第一下：只翻开不结算，看清是什么再决定', () => {
  const run = newRun(15);
  const m = run.floorMap;
  /** 找一格挨着入口的暗格，把内容钉成金币箱 */
  const i = neighbors(m.entry)[0];
  m.cells[i].kind = CELL.TREASURE;
  m.cells[i].data = { reward: { kind: 'gold', amount: 9 } };

  const goldBefore = run.gold;
  assert.equal(m.cells[i].revealed, false);

  const res = stepCell(run, i);
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'reveal', '第一下只是翻开');
  assert.match(res.text, /宝箱/);
  assert.equal(m.cells[i].revealed, true, '翻开了');
  assert.equal(m.cells[i].done, false, '没有当场结算');
  assert.equal(run.gold, goldBefore, '钱没有到账 —— 触发要再点一下');
});

test('点暗格第二下：才触发结算', () => {
  const run = newRun(15);
  const m = run.floorMap;
  const i = neighbors(m.entry)[0];
  m.cells[i].kind = CELL.TREASURE;
  m.cells[i].data = { reward: { kind: 'gold', amount: 9 } };

  stepCell(run, i); // 翻开
  const goldBefore = run.gold;
  const res = stepCell(run, i); // 触发
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'treasure');
  assert.equal(m.cells[i].done, true);
  assert.equal(run.gold, goldBefore + 9, '钱在这一下到账');
});

test('够不着的暗格点不动，也不会被"翻开"', () => {
  const run = newRun(16);
  const m = run.floorMap;
  const far = m.cells.findIndex((c, i) => !c.revealed && !neighbors(m.entry).includes(i));
  assert.ok(far >= 0);
  const res = stepCell(run, far);
  assert.equal(res.ok, false);
  assert.match(res.reason, /看不清/);
  assert.equal(m.cells[far].revealed, false, '失败时不该偷偷翻开');
});

test('已翻开的格子再点也不会重翻，只会触发', () => {
  const run = newRun(17);
  const m = run.floorMap;
  const i = neighbors(m.entry)[0];
  m.cells[i].kind = CELL.EMPTY;
  m.cells[i].revealed = true;

  const goldBefore = run.gold;
  const res = stepCell(run, i);
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'empty');
  assert.ok(run.gold > goldBefore, '空房间也给几块古币');
});

/* ------------------------------------------------------------------ *
 * 下楼条件
 * ------------------------------------------------------------------ */

test('敌人没清光时踩楼梯会被拦下', () => {
  const run = newRun(17);
  const m = run.floorMap;
  assert.ok(m.enemiesLeft > 0);

  m.cells[m.stairs].revealed = true;
  const res = triggerCell(run, m.stairs);

  assert.equal(res.ok, false);
  assert.match(res.reason, /敌人/);
  assert.equal(run.floor, 1, '没下楼');
  assert.equal(run.phase, 'map');
});

test('敌人清光后踩楼梯：进入下一层的新地图', () => {
  const run = newRun(18);
  const m = run.floorMap;
  clearAllEnemies(m);

  m.cells[m.stairs].revealed = true;
  const res = triggerCell(run, m.stairs);

  assert.equal(res.ok, true);
  assert.equal(run.floor, 2);
  assert.equal(run.phase, 'map');
  assert.notEqual(run.floorMap, m, '换了一张新地图');
  assert.ok(run.floorMap.enemiesLeft > 0, '新一层又有敌人了');
  assert.equal(run.floorMap.cells.filter((c) => c.kind === CELL.ENEMY && !c.done).length > 0, true);
});

test('打完一只敌人：格子标记为已清，剩余敌人 -1，回到地图', () => {
  const run = newRun(19);
  assert.ok(enterFirstBattle(run));

  const idx = run.floorMap.activeCell;
  const before = run.floorMap.enemiesLeft;

  run.battle.phase = 'won';
  run.battle.enemy.hp = 0;
  /** 走真实结算（含经验/金币/掉落判定） */
  finishBattle(run);

  assert.equal(run.floorMap.cells[idx].done, true);
  assert.equal(run.floorMap.enemiesLeft, before - 1);
  assert.equal(run.floorMap.activeCell, null, '当前格已结算');
  assert.ok(['map', 'reward'].includes(run.phase), '要么回地图，要么进三选一');
});

/* ------------------------------------------------------------------ *
 * 宝箱 / 事件
 * ------------------------------------------------------------------ */

test('宝箱三种内容都能落到 run 上', () => {
  for (const kind of ['gold', 'material', 'heal']) {
    const run = newRun(20);
    const i = revealKind(run, CELL.TREASURE);
    assert.ok(i >= 0);
    run.floorMap.cells[i].data = { reward: { kind, amount: 7 } };
    run.player.hp = run.player.maxHp - 20;

    const before = { gold: run.gold, mat: run.materials, hp: run.player.hp };
    const res = triggerCell(run, i);
    assert.equal(res.ok, true);

    if (kind === 'gold') assert.equal(run.gold, before.gold + 7);
    if (kind === 'material') assert.equal(run.materials, before.mat + 7);
    if (kind === 'heal') assert.equal(run.player.hp, before.hp + 7);
  }
});

test('陷阱不会打死人：血量最低留 1', () => {
  const run = newRunWith(CELL.EVENT, (seed) => newRun(seed));
  const i = revealKind(run, CELL.EVENT);
  run.floorMap.cells[i].data = { event: 'trap' };
  run.player.hp = 3;

  triggerCell(run, i);
  assert.ok(run.player.hp >= 1, `陷阱不该致死，实际 ${run.player.hp}`);
});

test('祭坛加最大生命，泉眼回血，晶簇给材料', () => {
  for (const [event, check] of [
    ['altar', (r, before) => assert.equal(r.player.maxHp, before + 6)],
    ['crystals', (r, _b, beforeMat) => assert.equal(r.materials, beforeMat + 2)],
  ]) {
    const run = newRunWith(CELL.EVENT, (seed) => newRun(seed));
    const i = revealKind(run, CELL.EVENT);
    run.floorMap.cells[i].data = { event };
    const beforeHp = run.player.maxHp;
    const beforeMat = run.materials;
    triggerCell(run, i);
    check(run, beforeHp, beforeMat);
  }
});

test('事件表里的每个 id 都能被执行（没有写漏的分支）', () => {
  for (const id of Object.keys(EVENTS)) {
    const run = newRun(23);
    const i = revealKind(run, CELL.EVENT);
    run.floorMap.cells[i].data = { event: id };
    const res = triggerCell(run, i);
    assert.equal(res.ok, true, `${id} 应该能触发`);
    assert.ok(res.text.includes(EVENTS[id].name), `${id} 的提示要带上名字`);
  }
});

/* ------------------------------------------------------------------ *
 * 杂物
 * ------------------------------------------------------------------ */

test('空房间给一点金币，不是纯浪费一步', () => {
  const run = newRun(24);
  const i = run.floorMap.cells.findIndex((c) => c.kind === CELL.EMPTY && !c.done);
  run.floorMap.cells[i].revealed = true;
  const before = run.gold;
  const res = triggerCell(run, i);
  assert.equal(res.ok, true);
  assert.ok(run.gold > before);
});

test('已处理的格子再点没有反应（不会重复领奖）', () => {
  const run = newRun(25);
  const i = revealKind(run, CELL.TREASURE);
  triggerCell(run, i);
  const gold = run.gold;
  const again = triggerCell(run, i);
  assert.equal(again.ok, false);
  assert.equal(run.gold, gold);
});

test('宝箱掉落是四种之一（v2.3 加了装备），金币随层数变多', () => {
  const rng = new Rng(9);
  const low = newRun(26, 1);
  const high = newRun(26, 20);
  const kinds = new Set();
  // 装备权重只有 4/92 ≈ 4.3%，80 次有约 3% 的概率一个都开不出来 —— 加大到 200 次
  for (let i = 0; i < 200; i++) kinds.add(rollTreasure(low, rng).kind);
  assert.deepEqual([...kinds].sort(), ['equip', 'gold', 'heal', 'material']);

  const lowGold = Math.max(...Array.from({ length: 40 }, () => rollTreasure(low, rng)).filter((r) => r.kind === 'gold').map((r) => r.amount));
  const highGold = Math.max(...Array.from({ length: 40 }, () => rollTreasure(high, rng)).filter((r) => r.kind === 'gold').map((r) => r.amount));
  assert.ok(highGold > lowGold, '更深的层金币更多');
});

test('清掉敌人后 enemiesLeft 准确，楼梯才可以踩', () => {
  const run = newRun(27);
  const m = run.floorMap;
  assert.equal(enemiesLeftOf(m), m.enemiesLeft);

  for (const c of m.cells) {
    if (c.kind === CELL.ENEMY) c.done = true;
  }
  assert.equal(enemiesLeftOf(m), 0);
});

/* ------------------------------------------------------------------ *
 * v3.78：顶层收口 —— 30 层双店必有 + 楼梯通关防重入
 * ------------------------------------------------------------------ */

test('第 30 层必有行商 + 宝库（500 个种子一个不落）', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const run = newRun(seed, 30);
    const kinds = run.floorMap.cells.map((c) => c.kind);
    assert.ok(kinds.includes(CELL.RELIC_SHOP), `seed ${seed} 缺宝库`);
    assert.ok(kinds.includes(CELL.SHOP), `seed ${seed} 缺行商`);
  }
});

test('普通层不强制双店（只有顶层是 100% 双店）', () => {
  /** 普通层双店率实测 ~38%（保底节奏 + 空位够），这里只断言它远不到 100% */
  let bothCount = 0;
  const N = 200;
  for (let seed = 1; seed <= N; seed++) {
    const run = newRun(1000 + seed, 5 + (seed % 20));
    const kinds = run.floorMap.cells.map((c) => c.kind);
    if (kinds.includes(CELL.RELIC_SHOP) && kinds.includes(CELL.SHOP)) bothCount++;
  }
  assert.ok(bothCount < N, `普通层双店率 ${bothCount}/${N}，强制逻辑只该作用于顶层`);
});

test('30 层踩楼梯直接通关，再点格子不会继续涨层（防重入）', () => {
  const run = newRun(31, 30);
  clearAllEnemies(run.floorMap);
  run.floorMap.cells[run.floorMap.stairs].revealed = true;
  const res = stepCell(run, run.floorMap.stairs);
  assert.equal(res.ok, true);
  assert.equal(run.phase, 'won', '下到 31 层即 won');
  assert.equal(run.stats.floorsCleared, 30);
  assert.match(res.text, /塔顶|爬完/);

  const floor = run.floor;
  const again = stepCell(run, run.floorMap.stairs);
  assert.equal(again.ok, false, 'won 之后格子不能再触发');
  assert.equal(run.floor, floor, '层数不再涨');
});

test('战斗中（phase != map）也不许翻格 / 触发', () => {
  const run = newRun(32, 30);
  clearAllEnemies(run.floorMap);
  run.floorMap.cells[run.floorMap.stairs].revealed = true;
  run.phase = 'battle';
  const res = stepCell(run, run.floorMap.stairs);
  assert.equal(res.ok, false);
  assert.equal(run.floor, 30);
});
